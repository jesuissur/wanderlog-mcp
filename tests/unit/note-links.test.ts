import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { applyOp, type Json0Op } from "../../src/ot/apply.ts";
import { addNote } from "../../src/tools/add-note.ts";
import { addPlace } from "../../src/tools/add-place.ts";
import { annotatePlace } from "../../src/tools/annotate-place.ts";
import { noteDisplayText, noteToDeltaInserts } from "../../src/tools/note-text.ts";
import type { PlaceBlock, TripPlan } from "../../src/types.ts";
import { customSectionsTrip } from "../fixtures/custom-sections-trip.ts";

const BOOKING = "https://www.booking.com/hotel/vn/silk-river.html";

function makeFakeContext() {
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
      searchPlacesAutocomplete: async () => [{ place_id: "ChIJsilk", description: "Silk River" }],
      getPlaceDetails: async () => ({ name: "Silk River Hoi An Retreat", place_id: "ChIJsilk" }),
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
  const snapshot = (): TripPlan => entry.snapshot;
  return { ctx, submittedOps, snapshot };
}

function linkedRuns(ops: Json0Op[][]) {
  return ops
    .flat()
    .flatMap((op) => [op.o, (op.li as PlaceBlock | undefined)?.text?.ops])
    .flat()
    .filter((run) => (run as { attributes?: { link?: string } } | undefined)?.attributes?.link);
}

describe("Markdown links in notes", () => {
  it("turns [text](https://…) into a linked run and keeps the text around it", () => {
    expect(noteToDeltaInserts(`Book on [Booking](${BOOKING}) now`)).toEqual([
      { insert: "Book on " },
      { insert: "Booking", attributes: { link: BOOKING } },
      { insert: " now" },
    ]);
  });

  it("keeps balanced parentheses inside the URL, as in Wikipedia links", () => {
    const wiki = "https://en.wikipedia.org/wiki/Temple_(Hue)";
    expect(noteToDeltaInserts(`See [Temple](${wiki}) now`)).toEqual([
      { insert: "See " },
      { insert: "Temple", attributes: { link: wiki } },
      { insert: " now" },
    ]);
  });

  it("leaves text without links, and non-http links, as plain text", () => {
    expect(noteToDeltaInserts("No link here")).toEqual([{ insert: "No link here" }]);
    expect(noteToDeltaInserts("[x](javascript:alert(1))")).toEqual([
      { insert: "[x](javascript:alert(1))" },
    ]);
  });

  it("reports the note as Wanderlog displays it, without the Markdown", () => {
    expect(noteDisplayText(`Book on [Booking](${BOOKING}) now`)).toBe("Book on Booking now");
  });

  it("annotate_place stores a clickable link and replaces the previous note", async () => {
    const { ctx, snapshot } = makeFakeContext();
    const place = "Schwartz's Deli on day 1";
    await annotatePlace(ctx, { trip_key: "T", place, note: "Old note" });
    const result = await annotatePlace(ctx, { trip_key: "T", place, note: `Best price on [Booking](${BOOKING})` });

    expect(result.isError).toBeFalsy();
    const block = snapshot().itinerary.sections.find((s) => s.id === 4)!.blocks[0] as PlaceBlock;
    expect(block.text?.ops).toEqual([
      { insert: "Best price on " },
      { insert: "Booking", attributes: { link: BOOKING } },
      { insert: "\n" },
    ]);
  });

  it("add_place leaves the note without an extra blank line", async () => {
    const { ctx, snapshot } = makeFakeContext();
    await addPlace(ctx, { trip_key: "T", place: "Silk River", section: "Excursions", note: "Pool, 2 rooms" });
    const block = snapshot().itinerary.sections.find((s) => s.id === 7)!.blocks.at(-1) as PlaceBlock;
    expect(block.text?.ops).toEqual([{ insert: "Pool, 2 rooms\n" }]);
  });

  it("add_note leaves the note without an extra blank line", async () => {
    const { ctx, snapshot } = makeFakeContext();
    await addNote(ctx, { trip_key: "T", text: "Taxi 20 min", section: "Excursions" });
    const block = snapshot().itinerary.sections.find((s) => s.id === 7)!.blocks.at(-1) as { text?: unknown };
    expect(block.text).toEqual({ ops: [{ insert: "Taxi 20 min\n" }] });
  });

  it("add_place and add_note send the link as a rich-text attribute", async () => {
    const { ctx, submittedOps } = makeFakeContext();
    await addPlace(ctx, { trip_key: "T", place: "Silk River", section: "Excursions", note: `[Booking](${BOOKING})` });
    await addNote(ctx, { trip_key: "T", text: `Compare on [Booking](${BOOKING})`, section: "Excursions" });
    expect(linkedRuns(submittedOps)).toHaveLength(2);
  });
});
