import { isDeepStrictEqual } from "node:util";

type Attributes = Record<string, unknown>;

/** One run of a Quill document: text, or a one-unit embed such as an image. */
export type DeltaInsert = { insert: string | Attributes; attributes?: Attributes };

type ChangeOp = {
  insert?: string | Attributes;
  retain?: number;
  delete?: number;
  attributes?: Attributes;
};

/**
 * Applies a Quill change delta (retain / insert / delete) to a document delta.
 * Formatting attributes and embeds survive, so a cached note keeps its links
 * and images, and later edits size their deletes on the same units the server
 * counts.
 */
export function composeDelta(document: DeltaInsert[], change: ChangeOp[]): DeltaInsert[] {
  const remaining = [...document];
  const result: DeltaInsert[] = [];

  for (const op of change) {
    if (typeof op.retain === "number") {
      for (const run of takeUnits(remaining, op.retain)) {
        append(result, op.attributes ? withAttributes(run, op.attributes) : run);
      }
    } else if (op.insert !== undefined) {
      append(result, run(op.insert, op.attributes));
    } else if (typeof op.delete === "number") {
      takeUnits(remaining, op.delete);
    }
  }
  for (const rest of remaining) append(result, rest);
  return result;
}

export function readDeltaInserts(value: unknown): DeltaInsert[] {
  const ops = (value as { ops?: unknown } | undefined)?.ops;
  if (!Array.isArray(ops)) return [];
  return ops.filter(
    (op): op is DeltaInsert =>
      typeof op === "object" && op !== null && (op as DeltaInsert).insert !== undefined,
  );
}

function unitLength(run: DeltaInsert): number {
  return typeof run.insert === "string" ? run.insert.length : 1;
}

/** Removes `count` units from the front of `runs`, splitting a text run if needed. */
function takeUnits(runs: DeltaInsert[], count: number): DeltaInsert[] {
  const taken: DeltaInsert[] = [];
  let left = count;
  while (left > 0 && runs.length > 0) {
    const head = runs[0]!;
    const length = unitLength(head);
    if (length <= left) {
      taken.push(runs.shift()!);
      left -= length;
    } else {
      const text = head.insert as string;
      taken.push(run(text.slice(0, left), head.attributes));
      runs[0] = run(text.slice(left), head.attributes);
      left = 0;
    }
  }
  return taken;
}

/** Quill attribute semantics: a null value removes the attribute. */
function withAttributes(target: DeltaInsert, changes: Attributes): DeltaInsert {
  const merged: Attributes = { ...target.attributes };
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) delete merged[name];
    else merged[name] = value;
  }
  return run(target.insert, merged);
}

function run(insert: string | Attributes, attributes?: Attributes): DeltaInsert {
  return attributes && Object.keys(attributes).length > 0 ? { insert, attributes } : { insert };
}

/** Merges adjacent text runs with identical formatting, as Quill normalizes. */
function append(result: DeltaInsert[], next: DeltaInsert): void {
  if (typeof next.insert === "string" && next.insert.length === 0) return;
  const last = result.at(-1);
  if (
    last &&
    typeof last.insert === "string" &&
    typeof next.insert === "string" &&
    isDeepStrictEqual(last.attributes ?? {}, next.attributes ?? {})
  ) {
    result[result.length - 1] = run(last.insert + next.insert, last.attributes);
    return;
  }
  result.push(next);
}
