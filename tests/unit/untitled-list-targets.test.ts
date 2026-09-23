import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { applyOp, type Json0Op } from "../../src/ot/apply.ts";
import { addChecklist } from "../../src/tools/add-checklist.ts";
import { addNote } from "../../src/tools/add-note.ts";
import { addPlace } from "../../src/tools/add-place.ts";
import { customSectionsTrip } from "../fixtures/custom-sections-trip.ts";

const LAST_UNTITLED_LIST_ID = 8;

function makeFakeContext(): { ctx: AppContext; submittedOps: Json0Op[][] } {
  const submittedOps: Json0Op[][] = [];
  const entry = { snapshot: structuredClone(customSectionsTrip), version: 1, geos: [] };
  const client = {
    isSubscribed: true,
    version: 1,
    async submit(ops: Json0Op[]) {
      submittedOps.push(ops);
      this.version += 1;
    },
  };
  const ctx = {
    userId: 3656632,
    rest: {
      searchPlacesAutocomplete: async () => [{ place_id: "ChIJbiodome", description: "Biodôme" }],
      getPlaceDetails: async () => ({ name: "Biodôme", place_id: "ChIJbiodome" }),
      getPlacePhotos: async () => [],
    },
    pool: { get: () => client },
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

function sectionIdAt(path: Json0Op["p"]): number {
  const sectionIndex = path[2] as number;
  return customSectionsTrip.itinerary.sections[sectionIndex]!.id;
}

describe("block tools targeting untitled lists", () => {
  it("adds a place to an untitled list referenced by ordinal", async () => {
    const { ctx, submittedOps } = makeFakeContext();
    const result = await addPlace(ctx, {
      trip_key: "T",
      place: "Biodôme",
      section: "2nd untitled list",
    });
    expect(result.isError).toBeUndefined();
    expect(sectionIdAt(submittedOps[0]![0]!.p)).toBe(LAST_UNTITLED_LIST_ID);
  });

  it("adds a checklist to an untitled list referenced by ordinal", async () => {
    const { ctx, submittedOps } = makeFakeContext();
    const result = await addChecklist(ctx, {
      trip_key: "T",
      items: ["Umbrella"],
      section: "last untitled list",
    });
    expect(result.isError).toBeUndefined();
    expect(sectionIdAt(submittedOps[0]![0]!.p)).toBe(LAST_UNTITLED_LIST_ID);
  });

  it.each([
    ["add_place", (ctx: AppContext) => addPlace(ctx, { trip_key: "T", place: "Biodôme", section: "untitled list" })],
    ["add_note", (ctx: AppContext) => addNote(ctx, { trip_key: "T", text: "Bring cash", section: "untitled list" })],
    ["add_checklist", (ctx: AppContext) => addChecklist(ctx, { trip_key: "T", items: ["Umbrella"], section: "untitled list" })],
  ])("%s reports an ambiguous untitled list with the ordinal forms, not 'not found'", async (_tool, call) => {
    const { ctx, submittedOps } = makeFakeContext();
    const result = await call(ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('"2nd untitled list"');
    expect(submittedOps).toHaveLength(0);
  });
});
