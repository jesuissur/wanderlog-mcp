import type { Section, TripPlan } from "../types.js";
import { ordinalLabel, parseOrdinal } from "./place-ref.js";

const PLACES_TO_VISIT = "Places to visit";
const DEFAULT_LIST_ALIASES = new Set(["places", "places to visit"]);
const UNTITLED_LIST = "untitled list";

export type SectionMatch = { index: number; section: Section };

export type SectionRefResult =
  | { kind: "unique"; match: SectionMatch }
  | { kind: "ambiguous"; candidates: SectionMatch[] }
  | { kind: "none" };

type UntitledListRef = { normalized: string; position: number | "last" | null };

/**
 * The trip's default place list: the first place list headed "Places to
 * visit", or, when no list carries that heading, the first untitled one.
 */
export function findPlacesToVisitSection(trip: TripPlan): SectionMatch | null {
  return (
    findFirstPlaceList(trip, (heading) => heading === PLACES_TO_VISIT) ??
    findFirstPlaceList(trip, (heading) => heading === "")
  );
}

function findFirstPlaceList(
  trip: TripPlan,
  headingMatches: (heading: string) => boolean,
): SectionMatch | null {
  const index = trip.itinerary.sections.findIndex(
    (section) => isPlaceList(section) && headingMatches(section.heading),
  );
  return index === -1 ? null : { index, section: trip.itinerary.sections[index]! };
}

export function isPlaceList(section: Section): boolean {
  return section.type === "normal" && section.mode === "placeList";
}

/**
 * Untitled place lists other than the default one, in trip order. Every fresh
 * Wanderlog trip ships one, and headings can't target them, so they are
 * referenced as "untitled list", "2nd untitled list", "last untitled list".
 */
export function findUntitledLists(trip: TripPlan): SectionMatch[] {
  const defaultIndex = findPlacesToVisitSection(trip)?.index;
  return trip.itinerary.sections
    .map((section, index) => ({ index, section }))
    .filter(({ index, section }) => index !== defaultIndex && isUntitledPlaceList(section));
}

function isUntitledPlaceList(section: Section): boolean {
  return isPlaceList(section) && section.heading.trim() === "";
}

/**
 * Resolves a natural-language section reference. Resolution order:
 *   1. "places to visit" / "places" → the default place list
 *   2. "untitled list" / "2nd untitled list" → untitled lists in trip order
 *   3. Case-insensitive heading match across all sections
 * Every match is returned rather than the first, so mutation tools can refuse
 * an ambiguous target instead of silently changing the wrong section.
 */
export function resolveSectionRef(trip: TripPlan, ref: string): SectionRefResult {
  const normalized = ref.trim().toLowerCase();
  if (DEFAULT_LIST_ALIASES.has(normalized)) {
    const found = findPlacesToVisitSection(trip);
    return found ? { kind: "unique", match: found } : { kind: "none" };
  }
  return resolveUntitledListRef(trip, ref) ?? resolveByHeading(findSectionsHeaded(trip, normalized));
}

/**
 * Resolves "untitled list", "2nd untitled list", "last untitled list", with or
 * without the parentheses wanderlog_get_trip prints around them. Returns null
 * when the ref is not an untitled-list ref or the trip has no untitled lists,
 * leaving it to heading resolution. A list literally headed like the ref makes
 * the result ambiguous, since picking either one could hit the wrong list.
 */
export function resolveUntitledListRef(trip: TripPlan, ref: string): SectionRefResult | null {
  const parsed = parseUntitledListRef(ref);
  if (!parsed) return null;

  const lists = findUntitledLists(trip);
  if (lists.length === 0) return null;

  const literallyHeaded = findSectionsHeaded(trip, parsed.normalized);
  if (literallyHeaded.length > 0) {
    return { kind: "ambiguous", candidates: [...lists, ...literallyHeaded] };
  }
  if (parsed.position === null) return resolveByHeading(lists);

  const match = parsed.position === "last" ? lists.at(-1) : lists[parsed.position - 1];
  return match ? { kind: "unique", match } : { kind: "none" };
}

function parseUntitledListRef(ref: string): UntitledListRef | null {
  const normalized = stripLabelParentheses(ref.trim().toLowerCase());
  const ordinal = parseOrdinal(normalized);
  if ((ordinal ? ordinal.rest : normalized) !== UNTITLED_LIST) return null;
  return { normalized, position: ordinal?.position ?? null };
}

function stripLabelParentheses(ref: string): string {
  return /^\((.*)\)$/.exec(ref)?.[1]?.trim() ?? ref;
}

function findSectionsHeaded(trip: TripPlan, normalizedHeading: string): SectionMatch[] {
  return trip.itinerary.sections
    .map((section, index) => ({ index, section }))
    .filter(({ section }) => section.heading.trim().toLowerCase() === normalizedHeading);
}

function resolveByHeading(candidates: SectionMatch[]): SectionRefResult {
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "unique", match: candidates[0]! };
  return { kind: "ambiguous", candidates };
}

/**
 * Headings the resolver reads as aliases for the default list or an untitled
 * list. A list named with one could never be targeted by its heading.
 */
export function isReservedSectionHeading(heading: string): boolean {
  const normalized = heading.trim().toLowerCase();
  return DEFAULT_LIST_ALIASES.has(normalized) || parseUntitledListRef(normalized) !== null;
}

export function reservedSectionHeadingMessage(heading: string): string {
  return `"${heading}" is reserved: the section tools read it as a reference to the default list or an untitled list. Choose another heading.`;
}

/** True when an undated section other than `exceptSectionId` already uses the heading. */
export function hasUndatedSectionHeaded(
  trip: TripPlan,
  heading: string,
  exceptSectionId?: number,
): boolean {
  const normalized = heading.trim().toLowerCase();
  return trip.itinerary.sections.some(
    (section) =>
      section.id !== exceptSectionId &&
      section.mode !== "dayPlan" &&
      section.heading.trim().toLowerCase() === normalized,
  );
}

/**
 * Error for a section ref that matched several sections. Untitled lists are
 * disambiguated by ordinal; anything involving a real heading needs a rename
 * (`retryHint`), because no reference can tell same-named lists apart.
 */
export function ambiguousSectionMessage(
  ref: string,
  candidates: SectionMatch[],
  retryHint: string,
): string {
  if (isUntitledListRefToUntitledListsOnly(ref, candidates)) {
    return `"${ref}" matches ${candidates.length} untitled lists. Pick one by trip order: "1st untitled list", "2nd untitled list", or "last untitled list" (wanderlog_get_trip shows each one's label).`;
  }
  return `Section reference "${ref}" is ambiguous: ${candidates.length} sections have that heading. ${retryHint}`;
}

function isUntitledListRefToUntitledListsOnly(ref: string, candidates: SectionMatch[]): boolean {
  return (
    parseUntitledListRef(ref) !== null &&
    candidates.every(({ section }) => section.heading.trim() === "")
  );
}

/** Names a section in tool confirmations and errors with the labels wanderlog_get_trip shows. */
export function describeSectionAt(trip: TripPlan, index: number): string {
  const section = trip.itinerary.sections[index]!;
  if (section.mode === "dayPlan" && section.date) return `day ${section.date}`;
  if (findPlacesToVisitSection(trip)?.index === index) return `section "${PLACES_TO_VISIT}"`;
  const untitledLabel = untitledListLabels(trip).get(index);
  if (untitledLabel) return `the ${untitledLabel}`;
  return `section "${section.heading || "(untitled)"}"`;
}

/**
 * Ordinal references are recomputed from each call's snapshot, so deleting or
 * renaming one untitled list shifts the ordinals of the ones after it.
 */
export function untitledListRenumberNote(trip: TripPlan, index: number): string {
  if (!untitledListLabels(trip).has(index)) return "";
  return " Untitled lists are renumbered after this change; call wanderlog_get_trip before targeting another one.";
}

/** Maps each untitled list's section index to the reference the section tools accept. */
export function untitledListLabels(trip: TripPlan): Map<number, string> {
  const lists = findUntitledLists(trip);
  if (lists.length === 1) return new Map([[lists[0]!.index, UNTITLED_LIST]]);
  return new Map(
    lists.map(({ index }, position) => [index, `${ordinalLabel(position + 1)} ${UNTITLED_LIST}`]),
  );
}
