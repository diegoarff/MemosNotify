import { addMilliseconds, addMonths, addYears } from "date-fns";

// Calendar units (mo/y) can't be fixed ms — they're resolved against a concrete date so
// "1mo" lands on the right calendar day. Fixed units (s/m/h/d/w) are exact offsets.
export type ParsedDuration =
  | { kind: "fixed"; ms: number }
  | { kind: "calendar"; unit: "mo" | "y"; n: number };

// 1–5 digits caps every unit well below the max representable Date, so the date math below can't
// overflow into NaN (which would surface as a libsql RangeError when the timestamp is stored).
export const DURATION_RE = /^(\d{1,5})(mo|[smhdwy])$/;

const FIXED_MS: Record<"s" | "m" | "h" | "d" | "w", number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

export function parseDuration(input: string): ParsedDuration {
  const match = DURATION_RE.exec(input);
  if (!match) {
    throw new Error(`invalid duration "${input}" (use e.g. 30m, 12h, 3d, 2w, 1mo, 1y)`);
  }
  const n = Number(match[1]);
  const unit = match[2] as "s" | "m" | "h" | "d" | "w" | "mo" | "y";
  if (unit === "mo" || unit === "y") return { kind: "calendar", unit, n };
  return { kind: "fixed", ms: n * FIXED_MS[unit] };
}

export function addDuration(from: Date, d: ParsedDuration): Date {
  if (d.kind === "fixed") return addMilliseconds(from, d.ms);
  return d.unit === "mo" ? addMonths(from, d.n) : addYears(from, d.n);
}

/** Timestamp `input` (e.g. "3d", "1mo") after `fromTs`. */
export function durationTarget(fromTs: number, input: string): number {
  return addDuration(new Date(fromTs), parseDuration(input)).getTime();
}
