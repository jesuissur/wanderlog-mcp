import type { DeltaInsert } from "../ot/rich-text.js";

/**
 * Only web links become clickable; anything else stays as literal text. The
 * URL may hold one level of balanced parentheses, as Wikipedia links do.
 */
const MARKDOWN_LINK = /\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/g;

/**
 * Quill runs for a note, with Markdown links `[label](https://…)` turned into
 * link-formatted text so they are clickable in Wanderlog.
 */
export function noteToDeltaInserts(note: string): DeltaInsert[] {
  const runs: DeltaInsert[] = [];
  let cursor = 0;
  for (const match of note.matchAll(MARKDOWN_LINK)) {
    if (match.index > cursor) runs.push({ insert: note.slice(cursor, match.index) });
    runs.push({ insert: match[1]!, attributes: { link: match[2]! } });
    cursor = match.index + match[0].length;
  }
  if (cursor < note.length) runs.push({ insert: note.slice(cursor) });
  return runs;
}

/** A Quill document holding the note, ending with the newline Quill requires. */
export function noteDelta(note: string): { ops: DeltaInsert[] } {
  return { ops: withTrailingNewline(noteToDeltaInserts(note)) };
}

/** The note as Wanderlog displays it: link labels without the Markdown syntax. */
export function noteDisplayText(note: string): string {
  return note.replace(MARKDOWN_LINK, "$1");
}

export function withTrailingNewline(runs: DeltaInsert[]): DeltaInsert[] {
  const last = runs.at(-1);
  if (last && typeof last.insert === "string" && !last.attributes) {
    return [...runs.slice(0, -1), { insert: `${last.insert}\n` }];
  }
  return [...runs, { insert: "\n" }];
}
