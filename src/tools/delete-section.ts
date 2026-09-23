import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { describeSectionAt, untitledListRenumberNote } from "../resolvers/section.js";
import {
  isCustomSection,
  protectedSectionReason,
  requireUniqueSection,
  submitOp,
} from "./shared.js";

export const deleteSectionInputSchema = {
  trip_key: z
    .string()
    .min(1)
    .describe("The trip to delete the section from."),
  section: z
    .string()
    .min(1)
    .describe(
      "The section to delete, identified by its heading (e.g. 'Food & Drink'). Use wanderlog_get_trip to see available sections. Untitled lists are referenced as 'untitled list', or '2nd untitled list' when there are several, exactly as wanderlog_get_trip labels them.",
    ),
};

export const deleteSectionDescription = `
Deletes a custom section from a Wanderlog trip itinerary. The section and all blocks inside it
are permanently removed.

Only custom sections (created via wanderlog_add_section or the Wanderlog UI) can be deleted.
Day sections, the default "Places to visit" list, and system sections (hotels, flights, transit)
are protected and cannot be removed with this tool.

Returns a confirmation with the deleted section's heading.
If the heading matches more than one section, the tool fails without deleting either one.
`.trim();

type Args = {
  trip_key: string;
  section: string;
};

export async function deleteSection(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const result = await submitOp(ctx, args.trip_key, async (entry, submit) => {
      const trip = entry.snapshot;
      const { index, section } = requireUniqueSection(trip, args.section);
      if (!isCustomSection(trip, index)) {
        throw new WanderlogValidationError(protectedSectionReason(trip, index, "deleted"));
      }
      const sectionId = section.id;
      const ops: Json0Op[] = [{ p: ["itinerary", "sections", index], ld: section }];
      await submit(ops);
      if (entry.snapshot.itinerary.sections.some((candidate) => candidate.id === sectionId)) {
        throw new WanderlogError("Deleted section is still present", "stale_target");
      }
      return {
        label: describeSectionAt(trip, index),
        renumberNote: untitledListRenumberNote(trip, index),
        tripTitle: trip.title,
      };
    });
    const text = `Deleted ${result.label} from "${result.tripTitle}".${result.renumberNote}`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
