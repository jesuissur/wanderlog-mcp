import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { applyOp, type Json0Op } from "../../src/ot/apply.ts";
import { movePlace } from "../../src/tools/move-place.ts";
import { isPlaceBlock, type TripPlan } from "../../src/types.ts";
import { checklistTrip } from "../fixtures/checklist-trip.ts";
import { customSectionsTrip } from "../fixtures/custom-sections-trip.ts";

function makeTrip(): TripPlan {
  const trip = structuredClone(checklistTrip);
  trip.itinerary.sections[0]!.heading = "Food";
  const source = trip.itinerary.sections[1]!.blocks[0]!;
  if (isPlaceBlock(source)) {
    source.text = { ops: [{ insert: "Keep this note\n" }] };
    source.startTime = "09:00";
    source.endTime = "10:30";
    source.imageKeys = ["photo-key"];
    source.hotel = {
      checkIn: "2026-06-01",
      checkOut: "2026-06-02",
      travelerNames: ["Ada"],
      confirmationNumber: "ABC123",
    };
  }
  trip.itinerary.sections[0]!.blocks.push({
    id: 50002,
    type: "place",
    place: { name: "Bakery Beta", place_id: "beta" },
  });
  return trip;
}

function makeFakeContext(
  trip = makeTrip(),
  submitError?: Error,
): {
  ctx: AppContext;
  snapshot: () => TripPlan;
  submittedOps: Json0Op[][];
  invalidations: () => number;
} {
  const submittedOps: Json0Op[][] = [];
  const entry = { snapshot: structuredClone(trip), version: 1, geos: [] };
  let invalidations = 0;
  const client = {
    isSubscribed: true,
    version: 1,
    async submit(ops: Json0Op[]) {
      submittedOps.push(ops);
      if (submitError) throw submitError;
      this.version += 1;
    },
  };
  const ctx = {
    pool: { get: () => client },
    tripCache: {
      getEntry: async () => entry,
      applyLocalOp: (_key: string, ops: Json0Op[], version: number) => {
        entry.snapshot = applyOp(entry.snapshot, ops);
        entry.version = version;
      },
      invalidate: () => {
        invalidations += 1;
      },
    },
  } as unknown as AppContext;
  return {
    ctx,
    snapshot: () => entry.snapshot,
    submittedOps,
    invalidations: () => invalidations,
  };
}

describe("movePlace", () => {
  it("moves the complete original block to a custom list at a requested position", async () => {
    const fake = makeFakeContext();
    const original = structuredClone(fake.snapshot().itinerary.sections[1]!.blocks[0]!);
    const result = await movePlace(fake.ctx, {
      trip_key: "T",
      place_ref: "La Sagrada Familia",
      target_section: "Food",
      position: 1,
    });
    expect(result.isError).toBeUndefined();
    expect(fake.snapshot().itinerary.sections[1]!.blocks).toHaveLength(0);
    const foodPlaces = fake.snapshot().itinerary.sections[0]!.blocks.filter(isPlaceBlock);
    expect(foodPlaces.map((block) => block.place.name)).toEqual([
      "La Sagrada Familia",
      "Bakery Beta",
    ]);
    expect(foodPlaces[0]).toEqual(original);
  });

  it("moves a place to a valid day and rejects unknown destinations", async () => {
    const valid = makeFakeContext();
    const moved = await movePlace(valid.ctx, {
      trip_key: "T",
      place_ref: "La Sagrada Familia",
      target_day: "day 2",
    });
    expect(moved.isError).toBeUndefined();
    expect(valid.snapshot().itinerary.sections[3]!.blocks[0]!.id).toBe(50001);

    for (const target of [
      { target_day: "day 9" },
      { target_section: "Does not exist" },
    ]) {
      const invalid = makeFakeContext();
      const result = await movePlace(invalid.ctx, {
        trip_key: "T",
        place_ref: "La Sagrada Familia",
        ...target,
      });
      expect(result.isError).toBe(true);
      expect(invalid.submittedOps).toHaveLength(0);
    }
  });

  it("fails safely for ambiguous places and duplicate destination headings", async () => {
    const duplicatePlaceTrip = makeTrip();
    const duplicatePlace = structuredClone(duplicatePlaceTrip.itinerary.sections[1]!.blocks[0]!);
    duplicatePlace.id = 50003;
    duplicatePlaceTrip.itinerary.sections[2]!.blocks.push(duplicatePlace);
    const ambiguousPlace = makeFakeContext(duplicatePlaceTrip);
    const placeResult = await movePlace(ambiguousPlace.ctx, {
      trip_key: "T",
      place_ref: "La Sagrada Familia",
      target_section: "Food",
    });
    expect(placeResult.isError).toBe(true);
    expect(placeResult.content[0]!.text).toContain("ambiguous");
    expect(ambiguousPlace.submittedOps).toHaveLength(0);

    const duplicateSectionTrip = makeTrip();
    duplicateSectionTrip.itinerary.sections.unshift({
      id: 99,
      type: "normal",
      mode: "placeList",
      heading: "Food",
      date: null,
      blocks: [],
    });
    const ambiguousSection = makeFakeContext(duplicateSectionTrip);
    const sectionResult = await movePlace(ambiguousSection.ctx, {
      trip_key: "T",
      place_ref: "La Sagrada Familia",
      target_section: "Food",
    });
    expect(sectionResult.isError).toBe(true);
    expect(sectionResult.content[0]!.text).toContain("ambiguous");
    expect(ambiguousSection.submittedOps).toHaveLength(0);
  });

  it("invalidates the cache and leaves the local snapshot unchanged on API failure", async () => {
    const fake = makeFakeContext(makeTrip(), new Error("API unavailable"));
    const before = structuredClone(fake.snapshot());
    const result = await movePlace(fake.ctx, {
      trip_key: "T",
      place_ref: "La Sagrada Familia",
      target_section: "Food",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("API unavailable");
    expect(fake.snapshot()).toEqual(before);
    expect(fake.invalidations()).toBe(1);
  });
});

describe("movePlace into untitled lists", () => {
  it("moves a place into an untitled list referenced by ordinal", async () => {
    const { ctx, snapshot } = makeFakeContext(structuredClone(customSectionsTrip));
    const result = await movePlace(ctx, {
      trip_key: "T",
      place_ref: "Schwartz's Deli on day 1",
      target_section: "2nd untitled list",
    });
    expect(result.isError).toBeUndefined();
    const lastUntitled = snapshot().itinerary.sections.find((s) => s.id === 8)!;
    expect(lastUntitled.blocks.map((b) => b.id)).toEqual([70002]);
  });

  it("suggests ordinal references when the untitled target is ambiguous", async () => {
    const { ctx, submittedOps } = makeFakeContext(structuredClone(customSectionsTrip));
    const result = await movePlace(ctx, {
      trip_key: "T",
      place_ref: "Schwartz's Deli on day 1",
      target_section: "untitled list",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('"2nd untitled list"');
    expect(submittedOps).toHaveLength(0);
  });

  it("names untitled lists in its confirmation the way get_trip labels them", async () => {
    const { ctx } = makeFakeContext(structuredClone(customSectionsTrip));
    const intoList = await movePlace(ctx, {
      trip_key: "T",
      place_ref: "Schwartz's Deli on day 1",
      target_section: "2nd untitled list",
    });
    expect(intoList.content[0]!.text).toContain("from day 2026-11-06 to the 2nd untitled list");
  });

  it("names the source untitled list when moving a place out of it", async () => {
    const trip = structuredClone(customSectionsTrip);
    const foodAndDrink = trip.itinerary.sections.find((s) => s.id === 6)!;
    trip.itinerary.sections.find((s) => s.id === 4)!.blocks = [];
    trip.itinerary.sections.find((s) => s.id === 8)!.blocks.push(...foodAndDrink.blocks.splice(0));
    const { ctx } = makeFakeContext(trip);
    const result = await movePlace(ctx, {
      trip_key: "T",
      place_ref: "Schwartz's Deli",
      target_section: "Excursions",
    });
    expect(result.content[0]!.text).toContain('from the 2nd untitled list to section "Excursions"');
  });
});
