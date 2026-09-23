import { describe, expect, it } from "vitest";
import { formatBlockLine, formatTrip, formatTripList } from "../../src/formatters/trip-summary.ts";
import type { Block, TripPlan, TripPlanSummary } from "../../src/types.ts";
import { customSectionsTrip } from "../fixtures/custom-sections-trip.ts";
import { queenstownTrip } from "../fixtures/queenstown-trip.ts";
import { resolveDay } from "../../src/resolvers/day.ts";

describe("formatTripList", () => {
  const trips: TripPlanSummary[] = [
    {
      id: 1,
      key: "abc",
      title: "Trip to Queenstown",
      startDate: "2026-05-03",
      endDate: "2026-05-08",
      placeCount: 2,
    },
  ];

  it("concise format includes title, dates, place count, and key", () => {
    const out = formatTripList(trips, "concise");
    expect(out).toContain("Trip to Queenstown");
    expect(out).toContain("2026-05-03");
    expect(out).toContain("2026-05-08");
    expect(out).toContain("2 places");
    expect(out).toContain("abc");
  });

  it("empty list is handled", () => {
    expect(formatTripList([], "concise")).toBe("No trips found in this account.");
  });

  it("detailed format includes key on its own line", () => {
    const out = formatTripList(trips, "detailed");
    expect(out).toContain("Key:      abc");
  });

  it("detailed format includes numeric id and forwarding email", () => {
    const out = formatTripList(trips, "detailed");
    expect(out).toContain("ID:       1");
    expect(out).toContain("Email:    trip+1@wanderlog.com");
  });
});

describe("formatTrip", () => {
  it("concise format mentions both places", () => {
    const out = formatTrip(queenstownTrip, "concise");
    expect(out).toContain("Queenstown Gardens");
    expect(out).toContain("Rendezvous Heritage Hotel Queenstown");
  });

  it("concise format shows all 6 days", () => {
    const out = formatTrip(queenstownTrip, "concise");
    expect(out).toContain("May 3");
    expect(out).toContain("May 4");
    expect(out).toContain("May 5");
    expect(out).toContain("May 6");
    expect(out).toContain("May 7");
    expect(out).toContain("May 8");
  });

  it("concise format includes hotel check-in window", () => {
    const out = formatTrip(queenstownTrip, "concise");
    expect(out).toContain("2026-05-03");
    expect(out).toContain("2026-05-06");
  });

  it("concise format stays under 1000 chars for this small trip", () => {
    const out = formatTrip(queenstownTrip, "concise");
    expect(out.length).toBeLessThan(1000);
  });

  it("detailed format includes phone, address, rating details", () => {
    const out = formatTrip(queenstownTrip, "detailed");
    expect(out).toContain("+64 3 450 1500");
    expect(out).toContain("Fernhill");
    expect(out).toContain("1566 reviews");
  });

  it("detailed format includes numeric id and forwarding email", () => {
    const out = formatTrip(queenstownTrip, "detailed");
    expect(out).toContain("ID: 18313259");
    expect(out).toContain("Forwarding email: trip+18313259@wanderlog.com");
  });

  it("day filter returns only that day's content", () => {
    const day = resolveDay(queenstownTrip, "day 2");
    const out = formatTrip(queenstownTrip, "concise", day);
    expect(out).toContain("May 4");
    expect(out).not.toContain("May 5");
    expect(out).not.toContain("Queenstown Gardens");
  });

  it("day filter on empty day shows friendly placeholder", () => {
    const day = resolveDay(queenstownTrip, "day 3");
    const out = formatTrip(queenstownTrip, "concise", day);
    expect(out).toContain("no plans");
  });
});

const mkTransit = (type: string) =>
  ({
    id: 1,
    type,
    carrier: "Acme Line",
    depart: { place: { name: "Port A", place_id: "a" }, date: "2026-11-08", time: "09:00" },
    arrive: { place: { name: "Port B", place_id: "b" }, date: "2026-11-08", time: "10:00" },
    confirmationNumber: "CN1",
  }) as unknown as Block;

describe("transit block formatting", () => {
  it("renders ferry, bus, train with an icon and route", () => {
    for (const [type, icon] of [
      ["ferry", "⛴"],
      ["bus", "🚌"],
      ["train", "🚆"],
    ] as const) {
      const line = formatBlockLine(mkTransit(type), "concise")!;
      expect(line).toContain(icon);
      expect(line).toContain("Acme Line");
      expect(line).toContain("Port A");
      expect(line).toContain("Port B");
    }
  });

  it("renders a rentalCar with pickup/dropoff", () => {
    const rental = {
      id: 2,
      type: "rentalCar",
      pickUp: { date: "2026-11-01", time: "10:00", place: { name: "Europcar CUN", place_id: "c" } },
      dropOff: {
        date: "2026-11-08",
        time: "13:00",
        place: { name: "Europcar PDC", place_id: "d" },
      },
      confirmationNumber: "R9",
    } as unknown as Block;
    const line = formatBlockLine(rental, "detailed")!;
    expect(line).toContain("🚗");
    expect(line).toContain("Europcar CUN");
    expect(line).toContain("Europcar PDC");
    expect(line).toContain("R9");
  });
});

describe("custom section visibility", () => {
  const withoutUntitledExtras = (): TripPlan => {
    const trip = structuredClone(customSectionsTrip);
    trip.itinerary.sections = trip.itinerary.sections.filter((s) => s.id !== 8);
    return trip;
  };

  it("lists an empty custom list so the agent can target it", () => {
    const out = formatTrip(customSectionsTrip, "concise");
    expect(out).toContain("📌 Excursions\n  (empty)");
  });

  it("lists the empty default place list", () => {
    const out = formatTrip(customSectionsTrip, "concise");
    expect(out).toContain("📌 Places to visit\n  (empty)");
  });

  it("labels several untitled lists with the ordinal references the section tools accept", () => {
    const out = formatTrip(customSectionsTrip, "concise");
    expect(out).toContain("📌 (1st untitled list)");
    expect(out).toContain("📌 (2nd untitled list)");
  });

  it("labels a lone untitled list without an ordinal", () => {
    const out = formatTrip(withoutUntitledExtras(), "concise");
    expect(out).toContain("📌 (untitled list)");
    expect(out).not.toContain("1st untitled list");
  });

  it("never labels an untitled list as 'Places', which the tools alias to the default list", () => {
    const out = formatTrip(customSectionsTrip, "concise");
    expect(out).not.toMatch(/📌 Places$/m);
  });

  it("keeps an untitled default place list labelled as the default, not as an untitled list", () => {
    const trip = withoutUntitledExtras();
    trip.itinerary.sections = trip.itinerary.sections.filter((s) => s.id !== 2);
    const out = formatTrip(trip, "concise");
    expect(out).toContain("📌 Places to visit\n  (empty)");
    expect(out).not.toContain("untitled list");
  });

  it("counts distinct places from the blocks instead of the stale server counter", () => {
    const out = formatTrip(customSectionsTrip, "concise");
    expect(out.split("\n")[0]).toContain("· 1 places");
  });
});
