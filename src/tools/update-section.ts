import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import {
  describeSectionAt,
  hasUndatedSectionHeaded,
  isReservedSectionHeading,
  reservedSectionHeadingMessage,
  untitledListRenumberNote,
} from "../resolvers/section.js";
import {
  isCustomSection,
  protectedSectionReason,
  requireUniqueSection,
  submitOp,
} from "./shared.js";

export const updateSectionInputSchema = {
  trip_key: z
    .string()
    .min(1)
    .describe("The trip containing the section to update."),
  section: z
    .string()
    .min(1)
    .describe(
      "The section to update, identified by its current heading (e.g. 'Food & Drink', 'Places to visit'). Use wanderlog_get_trip to see available sections. Untitled lists are referenced as 'untitled list', or '2nd untitled list' when there are several, exactly as wanderlog_get_trip labels them.",
    ),
  heading: z
    .string()
    .describe(
      "New heading for the section. Must be unique among undated sections, so an empty heading is rejected on any trip that already has an untitled list (every new trip does).",
    ),
};

export const updateSectionDescription = `
Renames the heading of a custom section in a Wanderlog trip.

Identify the section by its current heading. Use wanderlog_get_trip to see all sections and
their current headings if you are unsure.

Returns a confirmation showing the old and new heading.
The current heading must identify exactly one section and the new heading must not duplicate
another undated section.
`.trim();

type Args = {
  trip_key: string;
  section: string;
  heading: string;
};

export async function updateSection(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const newHeading = args.heading;
    const result = await submitOp(ctx, args.trip_key, async (entry, submit) => {
      const trip = entry.snapshot;
      const { index, section } = requireUniqueSection(trip, args.section);
      if (!isCustomSection(trip, index)) {
        throw new WanderlogValidationError(protectedSectionReason(trip, index, "renamed"));
      }
      const oldHeading = section.heading;
      if (oldHeading === newHeading) {
        return {
          response: {
            content: [
              {
                type: "text" as const,
                text: `Section heading is already "${newHeading || "(untitled)"}" — no change made.`,
              },
            ],
          },
        };
      }
      if (isReservedSectionHeading(newHeading)) {
        throw new WanderlogValidationError(reservedSectionHeadingMessage(newHeading));
      }
      if (hasUndatedSectionHeaded(trip, newHeading, section.id)) {
        throw new WanderlogValidationError(
          `A different section named "${newHeading || "(untitled)"}" already exists. Choose a unique heading so future mutations can target it safely.`,
        );
      }
      const ops: Json0Op[] = [
        {
          p: ["itinerary", "sections", index, "heading"],
          od: oldHeading,
          oi: newHeading,
        },
      ];
      await submit(ops);
      return {
        oldLabel: describeSectionAt(trip, index),
        renumberNote: untitledListRenumberNote(trip, index),
        tripTitle: trip.title,
      };
    });
    if ("response" in result && result.response) return result.response;

    const newLabel = newHeading || "(untitled)";
    const text = `Renamed ${result.oldLabel} → "${newLabel}" in "${result.tripTitle}".${result.renumberNote}`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
