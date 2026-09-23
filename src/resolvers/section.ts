import type { Section, TripPlan } from "../types.js";
import { ordinalLabel, parseOrdinal } from "./place-ref.js";

const UNTITLED_LIST = "untitled list";

export type SectionMatch = { index: number; section: Section };

export type SectionRefResult =
  | { kind: "unique"; match: SectionMatch }
  | { kind: "ambiguous"; candidates: SectionMatch[] }
  | { kind: "none" };

/**
 * Finds the "Places to visit" section (the default normal+placeList section
 * that is not a day plan). Older trips leave its heading empty.
 */
export function findPlacesToVisitSection(trip: TripPlan): SectionMatch | null {
  for (let i = 0; i < trip.itinerary.sections.length; i++) {
    const s = trip.itinerary.sections[i]!;
    if (isPlaceList(s) && (s.heading === "Places to visit" || s.heading === "")) {
      return { index: i, section: s };
    }
  }
  return null;
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
 * Resolves "untitled list", "2nd untitled list", "last untitled list".
 * Returns null when the ref is not an untitled-list reference or the trip has
 * no untitled lists, so a list literally titled "Untitled list" still resolves
 * by heading.
 */
export function resolveUntitledListRef(trip: TripPlan, ref: string): SectionRefResult | null {
  const normalized = ref.trim().toLowerCase();
  const ordinal = parseOrdinal(normalized);
  if ((ordinal ? ordinal.rest : normalized) !== UNTITLED_LIST) return null;

  const lists = findUntitledLists(trip);
  if (lists.length === 0) return null;

  if (!ordinal) {
    return lists.length === 1
      ? { kind: "unique", match: lists[0]! }
      : { kind: "ambiguous", candidates: lists };
  }
  const match = ordinal.position === "last" ? lists.at(-1) : lists[ordinal.position - 1];
  return match ? { kind: "unique", match } : { kind: "none" };
}

/**
 * Error for a section ref that matched several sections. Duplicate headings
 * need a rename (`retryHint`); untitled lists are disambiguated by ordinal.
 */
export function ambiguousSectionMessage(ref: string, count: number, retryHint: string): string {
  if (ref.trim().toLowerCase() === UNTITLED_LIST) {
    return `"${ref}" matches ${count} untitled lists. Pick one by trip order: "1st untitled list", "2nd untitled list", or "last untitled list" (wanderlog_get_trip shows each one's label).`;
  }
  return `Section reference "${ref}" is ambiguous: ${count} sections have that heading. ${retryHint}`;
}

/** Maps each untitled list's section index to the reference the section tools accept. */
export function untitledListLabels(trip: TripPlan): Map<number, string> {
  const lists = findUntitledLists(trip);
  if (lists.length === 1) return new Map([[lists[0]!.index, UNTITLED_LIST]]);
  return new Map(
    lists.map(({ index }, position) => [index, `${ordinalLabel(position + 1)} ${UNTITLED_LIST}`]),
  );
}
