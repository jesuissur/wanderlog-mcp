import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { applyOp, type Json0Op } from "../../src/ot/apply.ts";
import {
  buildSectionObject,
  resolveSectionRef,
  type SectionMatch,
} from "../../src/tools/shared.ts";
import { addSection } from "../../src/tools/add-section.ts";
import { deleteSection } from "../../src/tools/delete-section.ts";
import { updateSection } from "../../src/tools/update-section.ts";
import { describeSectionAt } from "../../src/resolvers/section.ts";
import type { Section, TripPlan } from "../../src/types.ts";
import { checklistTrip } from "../fixtures/checklist-trip.ts";
import { customSectionsTrip } from "../fixtures/custom-sections-trip.ts";

/** The unique match, or null when the ref matches no section or several. */
function findSectionByRef(trip: TripPlan, ref: string): SectionMatch | null {
  const resolved = resolveSectionRef(trip, ref);
  return resolved.kind === "unique" ? resolved.match : null;
}

function sectionIdAt(trip: TripPlan, path: Json0Op["p"]): number {
  return trip.itinerary.sections[path[2] as number]!.id;
}

function fresh(trip: TripPlan): TripPlan {
  return structuredClone(trip);
}

function makeFakeContext(trip: TripPlan): {
  ctx: AppContext;
  submittedOps: Json0Op[][];
} {
  const submittedOps: Json0Op[][] = [];
  const entry = { snapshot: structuredClone(trip), version: 1, geos: [] };
  const ctx = {
    userId: 3656632,
    pool: {
      get: () => ({
        isSubscribed: true,
        version: 1,
        async submit(ops: Json0Op[]) {
          submittedOps.push(ops);
        },
      }),
    },
    tripCache: {
      getEntry: async () => entry,
      applyLocalOp: (_key: string, ops: Json0Op[], version: number) => {
        entry.snapshot = applyOp(entry.snapshot, ops);
        entry.version = version;
      },
      invalidate: () => {},
    },
  } as unknown as AppContext;
  return { ctx, submittedOps };
}

// ---------------------------------------------------------------------------
// buildSectionObject
// ---------------------------------------------------------------------------

describe("buildSectionObject", () => {
  it("produces the correct shape with a heading", () => {
    const s = buildSectionObject("Food & Drink");
    expect(s.type).toBe("normal");
    expect(s.mode).toBe("placeList");
    expect(s.heading).toBe("Food & Drink");
    expect(s.date).toBeNull();
    expect(s.blocks).toEqual([]);
    expect(s.text).toEqual({ ops: [{ insert: "\n" }] });
    expect(s.placeMarkerColor).toBe("#3498db");
    expect(s.placeMarkerIcon).toBe("map-marker");
    expect(typeof s.id).toBe("number");
    expect(s.id).toBeGreaterThanOrEqual(0);
    expect(s.id).toBeLessThan(1_000_000_000);
  });

  it("accepts an empty heading", () => {
    const s = buildSectionObject("");
    expect(s.heading).toBe("");
  });

  it("generates unique IDs across calls", () => {
    const ids = new Set(Array.from({ length: 50 }, () => buildSectionObject("X").id));
    expect(ids.size).toBeGreaterThan(45);
  });
});

// ---------------------------------------------------------------------------
// findSectionByRef
// ---------------------------------------------------------------------------

describe("findSectionByRef", () => {
  it("finds 'places to visit' alias", () => {
    const trip = fresh(checklistTrip);
    const result = findSectionByRef(trip, "places to visit");
    expect(result).not.toBeNull();
    expect(result!.section.heading).toBe("Places to visit");
  });

  it("finds 'places' alias (short form)", () => {
    const trip = fresh(checklistTrip);
    const result = findSectionByRef(trip, "places");
    expect(result).not.toBeNull();
    expect(result!.section.heading).toBe("Places to visit");
  });

  it("finds a section by its exact heading", () => {
    const trip = fresh(checklistTrip);
    const result = findSectionByRef(trip, "Notes");
    expect(result).not.toBeNull();
    expect(result!.section.heading).toBe("Notes");
    expect(result!.index).toBe(0);
  });

  it("matches heading case-insensitively", () => {
    const trip = fresh(checklistTrip);
    const result = findSectionByRef(trip, "notes");
    expect(result).not.toBeNull();
    expect(result!.index).toBe(0);
  });

  it("returns null for an unknown reference", () => {
    const trip = fresh(checklistTrip);
    expect(findSectionByRef(trip, "Nonexistent Section")).toBeNull();
  });

  it("returns null instead of choosing the first duplicate heading", () => {
    const trip = fresh(checklistTrip);
    trip.itinerary.sections.unshift({
      id: 99,
      type: "textOnly",
      mode: "placeList",
      heading: "Notes",
      date: null,
      blocks: [],
    });
    expect(findSectionByRef(trip, "Notes")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applyOp round-trip: section list insert (li)
// ---------------------------------------------------------------------------

describe("applyOp – section li", () => {
  it("inserts a new section at the end", () => {
    const doc = fresh(checklistTrip);
    const section = buildSectionObject("Day Trips");
    const insertIndex = doc.itinerary.sections.length;
    const ops: Json0Op[] = [
      { p: ["itinerary", "sections", insertIndex], li: section },
    ];
    const next = applyOp(doc, ops);
    expect(next.itinerary.sections).toHaveLength(insertIndex + 1);
    const inserted = next.itinerary.sections[insertIndex]! as Section;
    expect(inserted.heading).toBe("Day Trips");
    expect(inserted.type).toBe("normal");
    expect(inserted.mode).toBe("placeList");
    expect(inserted.blocks).toEqual([]);
  });

  it("inserts a section at a mid-trip position", () => {
    const doc = fresh(checklistTrip);
    const section = buildSectionObject("Must-See");
    const ops: Json0Op[] = [
      { p: ["itinerary", "sections", 1], li: section },
    ];
    const next = applyOp(doc, ops);
    expect((next.itinerary.sections[1]! as Section).heading).toBe("Must-See");
    // Existing section at index 1 is shifted to index 2
    expect((next.itinerary.sections[2]! as Section).heading).toBe("Places to visit");
  });
});

// ---------------------------------------------------------------------------
// applyOp round-trip: section heading update (od + oi)
// ---------------------------------------------------------------------------

describe("applyOp – section heading od+oi", () => {
  it("updates a section heading in place", () => {
    const doc = fresh(checklistTrip);
    // Section at index 0 has heading "Notes"
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", 0, "heading"],
        od: "Notes",
        oi: "Trip Notes",
      },
    ];
    const next = applyOp(doc, ops);
    expect((next.itinerary.sections[0]! as Section).heading).toBe("Trip Notes");
    // Other fields on the section should be unchanged
    expect(next.itinerary.sections[0]!.id).toBe(doc.itinerary.sections[0]!.id);
  });

  it("clears a heading to empty string", () => {
    const doc = fresh(checklistTrip);
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", 0, "heading"],
        od: "Notes",
        oi: "",
      },
    ];
    const next = applyOp(doc, ops);
    expect((next.itinerary.sections[0]! as Section).heading).toBe("");
  });

  it("does not affect sibling sections", () => {
    const doc = fresh(checklistTrip);
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", 0, "heading"],
        od: "Notes",
        oi: "Renamed",
      },
    ];
    const next = applyOp(doc, ops);
    // Section at index 1 ("Places to visit") must be untouched
    expect((next.itinerary.sections[1]! as Section).heading).toBe(
      doc.itinerary.sections[1]!.heading,
    );
  });
});

// ---------------------------------------------------------------------------
// applyOp round-trip: section list delete (ld)
// ---------------------------------------------------------------------------

describe("applyOp – section ld", () => {
  it("removes a section and shifts remaining sections", () => {
    const doc = fresh(checklistTrip);
    const sectionCount = doc.itinerary.sections.length;
    // Delete the section at index 0 ("Notes")
    const target = doc.itinerary.sections[0]!;
    const ops: Json0Op[] = [
      { p: ["itinerary", "sections", 0], ld: target },
    ];
    const next = applyOp(doc, ops);
    expect(next.itinerary.sections).toHaveLength(sectionCount - 1);
    // Former index 1 ("Places to visit") is now at index 0
    expect((next.itinerary.sections[0]! as Section).heading).toBe("Places to visit");
  });

  it("throws when ld value does not match the existing section", () => {
    const doc = fresh(checklistTrip);
    const staleSection = { ...doc.itinerary.sections[0]!, heading: "Wrong heading" };
    const ops: Json0Op[] = [
      { p: ["itinerary", "sections", 0], ld: staleSection },
    ];
    expect(() => applyOp(doc, ops)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// updateSection guards — must refuse day/places-to-visit/system sections,
// mirroring deleteSection so it can't collide with rename_day or corrupt
// the day structure.
// ---------------------------------------------------------------------------

describe("updateSection guards", () => {
  it("refuses to rename a day (dayPlan) section and points at rename_day", async () => {
    const { ctx, submittedOps } = makeFakeContext(checklistTrip);
    const res = await updateSection(ctx, {
      trip_key: "T",
      section: "Arrival day",
      heading: "Renamed day",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("rename_day");
    expect(submittedOps).toHaveLength(0);
  });

  it("refuses to rename the 'Places to visit' default list", async () => {
    const { ctx, submittedOps } = makeFakeContext(checklistTrip);
    const res = await updateSection(ctx, {
      trip_key: "T",
      section: "Places to visit",
      heading: "My places",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("default place list");
    expect(submittedOps).toHaveLength(0);
  });

  it("allows renaming a genuine custom section", async () => {
    const { ctx, submittedOps } = makeFakeContext(checklistTrip);
    const res = await updateSection(ctx, {
      trip_key: "T",
      section: "Notes",
      heading: "Trip Notes",
    });
    expect(res.isError).toBeUndefined();
    expect(submittedOps).toHaveLength(1);
    expect(submittedOps[0]![0]!).toMatchObject({
      od: "Notes",
      oi: "Trip Notes",
    });
  });
});

describe("custom section lifecycle safety", () => {
  it("creates, renames, and deletes a uniquely named custom section", async () => {
    const { ctx } = makeFakeContext(checklistTrip);
    const added = await addSection(ctx, {
      trip_key: "T",
      heading: "Sights",
      after_section: "Notes",
    });
    expect(added.isError).toBeUndefined();

    const renamed = await updateSection(ctx, {
      trip_key: "T",
      section: "Sights",
      heading: "Must See",
    });
    expect(renamed.isError).toBeUndefined();

    const deleted = await deleteSection(ctx, {
      trip_key: "T",
      section: "Must See",
    });
    expect(deleted.isError).toBeUndefined();
  });

  it("rejects duplicate headings on create and rename", async () => {
    const { ctx, submittedOps } = makeFakeContext(checklistTrip);
    const added = await addSection(ctx, { trip_key: "T", heading: "notes" });
    expect(added.isError).toBe(true);

    const renamed = await updateSection(ctx, {
      trip_key: "T",
      section: "Notes",
      heading: "Places to visit",
    });
    expect(renamed.isError).toBe(true);
    expect(submittedOps).toHaveLength(0);
  });

  it("rejects ambiguous and day-section delete targets", async () => {
    const trip = fresh(checklistTrip);
    trip.itinerary.sections.unshift({
      id: 99,
      type: "textOnly",
      mode: "placeList",
      heading: "Notes",
      date: null,
      blocks: [],
    });
    const ambiguous = makeFakeContext(trip);
    const ambiguousResult = await deleteSection(ambiguous.ctx, {
      trip_key: "T",
      section: "Notes",
    });
    expect(ambiguousResult.isError).toBe(true);
    expect(ambiguousResult.content[0]!.text).toContain("ambiguous");
    expect(ambiguous.submittedOps).toHaveLength(0);

    const day = makeFakeContext(checklistTrip);
    const dayResult = await deleteSection(day.ctx, {
      trip_key: "T",
      section: "Arrival day",
    });
    expect(dayResult.isError).toBe(true);
    expect(day.submittedOps).toHaveLength(0);
  });
});

describe("untitled list references", () => {
  const UNTITLED_NATIVE = 2;
  const UNTITLED_ADDED = 7;

  const withOneUntitledList = (): TripPlan => {
    const trip = fresh(customSectionsTrip);
    trip.itinerary.sections = trip.itinerary.sections.filter((s) => s.id !== 8);
    return trip;
  };

  it("resolves 'untitled list' when the trip has exactly one", () => {
    const resolved = resolveSectionRef(withOneUntitledList(), "Untitled List");
    expect(resolved).toMatchObject({ kind: "unique", match: { index: UNTITLED_NATIVE } });
  });

  it("resolves ordinal references in trip order", () => {
    const trip = fresh(customSectionsTrip);
    expect(resolveSectionRef(trip, "1st untitled list")).toMatchObject({
      kind: "unique",
      match: { index: UNTITLED_NATIVE },
    });
    expect(resolveSectionRef(trip, "second untitled list")).toMatchObject({
      kind: "unique",
      match: { index: UNTITLED_ADDED },
    });
    expect(resolveSectionRef(trip, "last untitled list")).toMatchObject({
      kind: "unique",
      match: { index: UNTITLED_ADDED },
    });
  });

  it("reports a bare 'untitled list' as ambiguous when there are several", () => {
    const resolved = resolveSectionRef(fresh(customSectionsTrip), "untitled list");
    expect(resolved.kind).toBe("ambiguous");
  });

  it("returns none for an ordinal past the last untitled list", () => {
    expect(resolveSectionRef(fresh(customSectionsTrip), "3rd untitled list").kind).toBe("none");
  });

  it("never resolves the default place list as an untitled list", () => {
    const trip = fresh(customSectionsTrip);
    trip.itinerary.sections = trip.itinerary.sections.filter((s) => s.id !== 2);
    const resolved = resolveSectionRef(trip, "untitled list");
    expect(resolved).toMatchObject({ kind: "unique", match: { section: { id: 8 } } });
  });

  it("renames an untitled list by ordinal reference", async () => {
    const { ctx, submittedOps } = makeFakeContext(customSectionsTrip);
    const result = await updateSection(ctx, {
      trip_key: "T",
      section: "2nd untitled list",
      heading: "Rainy day",
    });
    expect(result.isError).toBeUndefined();
    expect(submittedOps).toEqual([
      [{ p: ["itinerary", "sections", UNTITLED_ADDED, "heading"], od: "", oi: "Rainy day" }],
    ]);
  });

  it("deletes an untitled list by ordinal reference", async () => {
    const { ctx, submittedOps } = makeFakeContext(customSectionsTrip);
    const result = await deleteSection(ctx, { trip_key: "T", section: "last untitled list" });
    expect(result.isError).toBeUndefined();
    expect(submittedOps[0]![0]).toMatchObject({
      p: ["itinerary", "sections", UNTITLED_ADDED],
      ld: { id: 8 },
    });
  });

  it("suggests ordinal references when 'untitled list' is ambiguous", async () => {
    const { ctx, submittedOps } = makeFakeContext(customSectionsTrip);
    const result = await deleteSection(ctx, { trip_key: "T", section: "untitled list" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('"1st untitled list"');
    expect(submittedOps).toHaveLength(0);
  });

  it("suggests ordinal references on an ambiguous rename or insertion point", async () => {
    const { ctx, submittedOps } = makeFakeContext(customSectionsTrip);
    const renamed = await updateSection(ctx, {
      trip_key: "T",
      section: "untitled list",
      heading: "Rainy day",
    });
    const added = await addSection(ctx, {
      trip_key: "T",
      heading: "Rainy day",
      after_section: "untitled list",
    });
    expect(renamed.content[0]!.text).toContain('"2nd untitled list"');
    expect(added.content[0]!.text).toContain('"2nd untitled list"');
    expect(submittedOps).toHaveLength(0);
  });

  it("inserts a new list after an untitled list referenced by ordinal", async () => {
    const { ctx, submittedOps } = makeFakeContext(customSectionsTrip);
    const result = await addSection(ctx, {
      trip_key: "T",
      heading: "Rainy day",
      after_section: "1st untitled list",
    });
    expect(result.isError).toBeUndefined();
    expect(submittedOps[0]![0]!.p).toEqual(["itinerary", "sections", UNTITLED_NATIVE + 1]);
  });

  it("names the untitled list in rename and delete confirmations", async () => {
    const renamed = await updateSection(makeFakeContext(customSectionsTrip).ctx, {
      trip_key: "T",
      section: "2nd untitled list",
      heading: "Rainy day",
    });
    expect(renamed.content[0]!.text).toContain('Renamed the 2nd untitled list → "Rainy day"');

    const deleted = await deleteSection(makeFakeContext(customSectionsTrip).ctx, {
      trip_key: "T",
      section: "1st untitled list",
    });
    expect(deleted.content[0]!.text).toContain("Deleted the 1st untitled list from");
  });
});

describe("section resolution hardening", () => {
  it("accepts an untitled-list label copied from get_trip with its parentheses", () => {
    const resolved = resolveSectionRef(fresh(customSectionsTrip), "(2nd untitled list)");
    expect(resolved).toMatchObject({ kind: "unique", match: { section: { id: 8 } } });
  });

  it("treats a list literally headed like an untitled-list ref as ambiguous instead of shadowing it", () => {
    const trip = fresh(customSectionsTrip);
    trip.itinerary.sections = trip.itinerary.sections.filter((s) => s.id !== 8);
    trip.itinerary.sections.find((s) => s.id === 7)!.heading = "Untitled list";
    expect(resolveSectionRef(trip, "untitled list").kind).toBe("ambiguous");
  });

  it("resolves a literal heading when the ordinal points past the last untitled list", () => {
    const trip = fresh(customSectionsTrip);
    trip.itinerary.sections.find((s) => s.id === 7)!.heading = "3rd untitled list";
    expect(resolveSectionRef(trip, "3rd untitled list")).toMatchObject({
      kind: "unique",
      match: { section: { id: 7 } },
    });
  });

  it("explains a heading collision instead of reporting duplicate headings", async () => {
    const trip = fresh(customSectionsTrip);
    trip.itinerary.sections.find((s) => s.id === 7)!.heading = "2nd untitled list";
    const { ctx, submittedOps } = makeFakeContext(trip);
    const result = await deleteSection(ctx, { trip_key: "T", section: "2nd untitled list" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('a list headed "2nd untitled list"');
    expect(result.content[0]!.text).not.toContain("sections have that heading");
    expect(submittedOps).toHaveLength(0);
  });

  it("prefers the list headed 'Places to visit' over an untitled list placed before it", () => {
    const trip = fresh(customSectionsTrip);
    const [notes, placesToVisit, untitled, ...rest] = trip.itinerary.sections;
    trip.itinerary.sections = [notes!, untitled!, placesToVisit!, ...rest];
    expect(resolveSectionRef(trip, "places to visit")).toMatchObject({
      kind: "unique",
      match: { section: { id: 2 } },
    });
    expect(resolveSectionRef(trip, "1st untitled list")).toMatchObject({
      kind: "unique",
      match: { section: { id: 3 } },
    });
  });

  it.each(["Untitled list", "2nd untitled list", "last Untitled List"])(
    "refuses to create or rename a list to the reserved heading %s",
    async (heading) => {
      const { ctx, submittedOps } = makeFakeContext(customSectionsTrip);
      const added = await addSection(ctx, { trip_key: "T", heading });
      const renamed = await updateSection(ctx, { trip_key: "T", section: "Excursions", heading });
      expect(added.isError).toBe(true);
      expect(renamed.isError).toBe(true);
      expect(added.content[0]!.text).toContain("reserved");
      expect(submittedOps).toHaveLength(0);
    },
  );
});

describe("default list stored with an empty heading", () => {
  const withUntitledDefault = (): TripPlan => {
    const trip = fresh(customSectionsTrip);
    trip.itinerary.sections = trip.itinerary.sections.filter((s) => s.id !== 2);
    return trip;
  };

  it("is described as 'Places to visit', the label get_trip shows", () => {
    const trip = withUntitledDefault();
    const defaultIndex = trip.itinerary.sections.findIndex((s) => s.id === 3);
    expect(describeSectionAt(trip, defaultIndex)).toBe('section "Places to visit"');
  });

  it.each([
    ["rename", (ctx: AppContext) => updateSection(ctx, { trip_key: "T", section: "places", heading: "Spots" })],
    ["delete", (ctx: AppContext) => deleteSection(ctx, { trip_key: "T", section: "places" })],
  ])("names it as the default list when refusing to %s it", async (_action, call) => {
    const result = await call(makeFakeContext(withUntitledDefault()).ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("default place list");
    expect(result.content[0]!.text).not.toContain('"normal"');
    expect(result.content[0]!.text).not.toContain("system section");
  });
});

describe("duplicate headings targeted by trip order", () => {
  const withDuplicateHeadings = (): TripPlan => {
    const trip = fresh(customSectionsTrip);
    trip.itinerary.sections.find((s) => s.id === 6)!.heading = "Hotels possibles - Hanoi";
    trip.itinerary.sections.find((s) => s.id === 7)!.heading = "Hotels possibles - Hanoi";
    return trip;
  };

  it("resolves '2nd <heading>' to the second list with that heading", () => {
    expect(resolveSectionRef(withDuplicateHeadings(), "2nd Hotels possibles - Hanoi")).toMatchObject({
      kind: "unique",
      match: { section: { id: 7 } },
    });
    expect(resolveSectionRef(withDuplicateHeadings(), "first hotels possibles - hanoi")).toMatchObject({
      kind: "unique",
      match: { section: { id: 6 } },
    });
  });

  it("renames the second duplicate so the heading is unique again", async () => {
    const { ctx, submittedOps } = makeFakeContext(withDuplicateHeadings());
    const result = await updateSection(ctx, {
      trip_key: "T",
      section: "2nd Hotels possibles - Hanoi",
      heading: "Hotels possibles - Hoi An",
    });
    expect(result.isError).toBeUndefined();
    expect(submittedOps[0]![0]).toMatchObject({ od: "Hotels possibles - Hanoi", oi: "Hotels possibles - Hoi An" });
    expect(sectionIdAt(customSectionsTrip, submittedOps[0]![0]!.p)).toBe(7);
  });

  it("suggests the ordinal forms when a heading is ambiguous", async () => {
    const { ctx } = makeFakeContext(withDuplicateHeadings());
    const result = await deleteSection(ctx, { trip_key: "T", section: "Hotels possibles - Hanoi" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('"2nd Hotels possibles - Hanoi"');
  });

  it("still prefers an exact heading that happens to start with an ordinal", () => {
    const trip = fresh(customSectionsTrip);
    trip.itinerary.sections.find((s) => s.id === 7)!.heading = "2nd floor rooms";
    expect(resolveSectionRef(trip, "2nd floor rooms")).toMatchObject({
      kind: "unique",
      match: { section: { id: 7 } },
    });
  });
});

describe("untitled list renumbering warning", () => {
  it.each([
    ["delete", (ctx: AppContext) => deleteSection(ctx, { trip_key: "T", section: "1st untitled list" })],
    [
      "rename",
      (ctx: AppContext) =>
        updateSection(ctx, { trip_key: "T", section: "1st untitled list", heading: "Rainy day" }),
    ],
  ])("warns that untitled lists renumber after a %s of one", async (_action, call) => {
    const result = await call(makeFakeContext(customSectionsTrip).ctx);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("renumbered");
  });

  it("does not warn when the changed list has a heading", async () => {
    const result = await deleteSection(makeFakeContext(customSectionsTrip).ctx, {
      trip_key: "T",
      section: "Excursions",
    });
    expect(result.content[0]!.text).not.toContain("renumbered");
  });
});
