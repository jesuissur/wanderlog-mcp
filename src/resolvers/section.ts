import type { Section, TripPlan } from "../types.js";
import { ordinalLabel } from "./place-ref.js";

const UNTITLED_LIST = "untitled list";

export type SectionMatch = { index: number; section: Section };

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
  return trip.itinerary.sections.flatMap((section, index) =>
    index !== defaultIndex && isPlaceList(section) && section.heading.trim() === ""
      ? [{ index, section }]
      : [],
  );
}

/** Maps each untitled list's section index to the reference the section tools accept. */
export function untitledListLabels(trip: TripPlan): Map<number, string> {
  const lists = findUntitledLists(trip);
  if (lists.length === 1) return new Map([[lists[0]!.index, UNTITLED_LIST]]);
  return new Map(
    lists.map(({ index }, position) => [index, `${ordinalLabel(position + 1)} ${UNTITLED_LIST}`]),
  );
}
