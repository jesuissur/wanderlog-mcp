import { describe, expect, it } from "vitest";
import { applyOp, type Json0Op } from "../../src/ot/apply.ts";
import type { TripPlan } from "../../src/types.ts";

type DeltaOps = Array<{ insert: unknown; attributes?: Record<string, unknown> }>;

function tripWithNote(ops: DeltaOps): TripPlan {
  return {
    itinerary: {
      sections: [{ id: 1, type: "normal", mode: "placeList", heading: "", blocks: [{ id: 9, type: "place", text: { ops } }] }],
    },
  } as unknown as TripPlan;
}

function applyRichText(ops: DeltaOps, change: Array<Record<string, unknown>>): DeltaOps {
  const op: Json0Op = { p: ["itinerary", "sections", 0, "blocks", 0, "text"], t: "rich-text", o: change };
  const next = applyOp(tripWithNote(ops), [op]);
  return (next.itinerary.sections[0]!.blocks[0] as unknown as { text: { ops: DeltaOps } }).text.ops;
}

const LINKED_NOTE: DeltaOps = [
  { insert: "See " },
  { insert: "Booking", attributes: { link: "https://booking.com/x" } },
  { insert: "\n" },
];

describe("applyOp rich-text (cached Quill notes)", () => {
  it("keeps link attributes on text the op does not touch", () => {
    expect(applyRichText(LINKED_NOTE, [{ retain: 11 }, { insert: " now" }])).toEqual([
      { insert: "See " },
      { insert: "Booking", attributes: { link: "https://booking.com/x" } },
      { insert: " now\n" },
    ]);
  });

  it("stores the attributes of inserted text", () => {
    const change = [{ insert: "Agoda", attributes: { link: "https://agoda.com/y" } }, { insert: " deal" }];
    expect(applyRichText([{ insert: "\n" }], change)).toEqual([
      { insert: "Agoda", attributes: { link: "https://agoda.com/y" } },
      { insert: " deal\n" },
    ]);
  });

  it("counts an embedded image as one unit when retaining and deleting", () => {
    const withImage: DeltaOps = [{ insert: "a" }, { insert: { image: "k" } }, { insert: "b\n" }];
    expect(applyRichText(withImage, [{ retain: 2 }, { delete: 1 }])).toEqual([
      { insert: "a" },
      { insert: { image: "k" } },
      { insert: "\n" },
    ]);
  });

  it("deletes across a formatting boundary", () => {
    expect(applyRichText(LINKED_NOTE, [{ delete: 11 }, { insert: "Replaced" }])).toEqual([
      { insert: "Replaced\n" },
    ]);
  });

  it("applies attribute changes carried by a retain, with null removing one", () => {
    expect(applyRichText(LINKED_NOTE, [{ retain: 4 }, { retain: 7, attributes: { link: null, bold: true } }])).toEqual([
      { insert: "See " },
      { insert: "Booking", attributes: { bold: true } },
      { insert: "\n" },
    ]);
  });
});
