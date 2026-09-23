import type { PlaceBlock, TripPlan } from "../../src/types.ts";

const schwartz: PlaceBlock = {
  id: 70001,
  type: "place",
  place: {
    name: "Schwartz's Deli",
    place_id: "ChIJschwartz",
    geometry: { location: { lat: 45.516, lng: -73.577 } },
    rating: 4.4,
  },
};

/**
 * Mirrors the section layout Wanderlog gives a fresh trip (Notes, "Places to
 * visit", then a native untitled list) plus custom lists added afterwards,
 * including an empty one and a second untitled one. `placeCount` is
 * deliberately stale, like the server-side counter observed on live trips.
 */
export const customSectionsTrip: TripPlan = {
  id: 88888888,
  key: "customsectionskey",
  title: "Trip to Montreal",
  userId: 3656632,
  privacy: "private",
  startDate: "2026-11-06",
  endDate: "2026-11-07",
  days: 2,
  placeCount: 0,
  schemaVersion: 2,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-02T00:00:00Z",
  itinerary: {
    sections: [
      { id: 1, type: "textOnly", mode: "placeList", heading: "Notes", date: null, blocks: [] },
      { id: 2, type: "normal", mode: "placeList", heading: "Places to visit", date: null, blocks: [] },
      { id: 3, type: "normal", mode: "placeList", heading: "", date: null, blocks: [] },
      {
        id: 4,
        type: "normal",
        mode: "dayPlan",
        heading: "",
        date: "2026-11-06",
        blocks: [{ ...schwartz, id: 70002 }],
      },
      { id: 5, type: "normal", mode: "dayPlan", heading: "", date: "2026-11-07", blocks: [] },
      { id: 6, type: "normal", mode: "placeList", heading: "Food & Drink", date: null, blocks: [schwartz] },
      { id: 7, type: "normal", mode: "placeList", heading: "Excursions", date: null, blocks: [] },
      { id: 8, type: "normal", mode: "placeList", heading: "", date: null, blocks: [] },
    ],
  },
};
