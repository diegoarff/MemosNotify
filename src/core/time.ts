import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export interface QuietHours {
  enabled: boolean;
  timezone: string;
  from: string; // "HH:MM"
  to: string;
}

// date-fns-tz, since it trips people up: fromZonedTime(date|string, tz) reads the given wall-clock
// fields AS `tz` local time and returns the real UTC instant.

// Resolve a wall-clock instant without involving the host timezone: read the calendar date in `tz`,
// then apply the day-shift and target time via UTC fields (DST-immune) before reinterpreting those
// fields as `tz` wall time. A host-local `new Date(y, m, d, h, min)` would silently roll a time that
// lands in the host zone's spring-forward gap.
function wallClockToTs(now: number, tz: string, dayOffset: number, h: number, m: number): number {
  const ymd = formatInTimeZone(now, tz, "yyyy-MM-dd");
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  const wall = new Date(Date.UTC(year, month - 1, day + dayOffset, h, m));
  return fromZonedTime(wall.toISOString().slice(0, 19), tz).getTime();
}

export function isWithinQuietHours(now: number, qh: QuietHours): boolean {
  if (!qh.enabled) return false;
  // Zero-padded "HH:mm" compares lexicographically in clock order, so no minute math.
  const t = formatInTimeZone(now, qh.timezone, "HH:mm");
  return qh.from <= qh.to ? t >= qh.from && t < qh.to : t >= qh.from || t < qh.to;
}

// The \d regexes accept "25:00" or "2025-13-40"; JS Date would silently roll those over, so validate instead.
function assertClock(h: number, m: number, expr: string): void {
  if (h > 23 || m > 59) {
    throw new Error(`invalid time "${expr}" (hour must be 0–23, minute 0–59)`);
  }
}

const TOMORROW_RE = /^tomorrow\s+(\d{1,2}):(\d{2})$/;
const CLOCK_RE = /^(?:next\s+)?(\d{1,2}):(\d{2})$/;

// Grammar match only (dayOffset 1 for "tomorrow"); range-checking is left to the caller so the
// config validator and the runtime parser share one definition of the accepted forms.
function matchSnoozeClock(expr: string): { dayOffset: number; h: number; m: number } | null {
  const text = expr.trim().toLowerCase();
  const tomorrow = TOMORROW_RE.exec(text);
  const match = tomorrow ?? CLOCK_RE.exec(text);
  if (!match) return null;
  return { dayOffset: tomorrow ? 1 : 0, h: Number(match[1]), m: Number(match[2]) };
}

/** Whether `expr` is an accepted snooze_until time, so a bad value is rejected at config load. */
export function isValidSnoozeUntil(expr: string): boolean {
  const c = matchSnoozeClock(expr);
  return c !== null && c.h <= 23 && c.m <= 59;
}

/** "HH:MM" / "next HH:MM" → next occurrence; "tomorrow HH:MM" → that time tomorrow. */
export function parseSnoozeUntil(now: number, expr: string, tz: string): number {
  const clock = matchSnoozeClock(expr);
  if (!clock) {
    throw new Error(
      `unsupported snooze_until time "${expr}" (use HH:MM, next HH:MM, tomorrow HH:MM)`,
    );
  }
  assertClock(clock.h, clock.m, expr);
  if (clock.dayOffset === 1) return wallClockToTs(now, tz, 1, clock.h, clock.m);
  const today = wallClockToTs(now, tz, 0, clock.h, clock.m);
  return today > now ? today : wallClockToTs(now, tz, 1, clock.h, clock.m);
}

/** "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" in `tz` → epoch ms (time defaults to 09:00). */
export function parseAbsoluteDate(expr: string, tz: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(expr.trim());
  if (!match) throw new Error(`invalid date "${expr}" (use YYYY-MM-DD or YYYY-MM-DD HH:MM)`);
  const [, y, mo, d, h, m] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = h ? Number(h) : 9;
  const min = m ? Number(m) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || min > 59) {
    throw new Error(`invalid date "${expr}" (use YYYY-MM-DD or YYYY-MM-DD HH:MM)`);
  }
  // Build the instant from UTC fields so the host zone's DST can't shift it; setUTCFullYear pins
  // years < 100, which Date.UTC would otherwise map into the 1900s.
  const wall = new Date(Date.UTC(year, month - 1, day, hour, min));
  wall.setUTCFullYear(year);
  // Reject Feb 30 / Apr 31 and the like — they pass the range check but Date would roll them forward.
  if (wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day) {
    throw new Error(`invalid date "${expr}" (no such calendar day)`);
  }
  return fromZonedTime(wall.toISOString().slice(0, 19), tz).getTime();
}
