import { describe, expect, it } from "vitest";
import {
  isWithinQuietHours,
  parseAbsoluteDate,
  parseSnoozeUntil,
  type QuietHours,
} from "./time.ts";

const qh = (from: string, to: string, timezone = "UTC"): QuietHours => ({
  enabled: true,
  timezone,
  from,
  to,
});

describe("isWithinQuietHours", () => {
  const at = (h: number) => Date.UTC(2026, 0, 1, h, 0, 0);
  it("same-day window (end exclusive)", () => {
    expect(isWithinQuietHours(at(13), qh("12:00", "14:00"))).toBe(true);
    expect(isWithinQuietHours(at(11), qh("12:00", "14:00"))).toBe(false);
    expect(isWithinQuietHours(at(14), qh("12:00", "14:00"))).toBe(false);
  });
  it("window that wraps past midnight", () => {
    expect(isWithinQuietHours(at(23), qh("22:00", "07:00"))).toBe(true);
    expect(isWithinQuietHours(at(3), qh("22:00", "07:00"))).toBe(true);
    expect(isWithinQuietHours(at(8), qh("22:00", "07:00"))).toBe(false);
  });
  it("disabled is never within", () => {
    expect(isWithinQuietHours(at(23), { ...qh("22:00", "07:00"), enabled: false })).toBe(false);
  });
});

describe("parseSnoozeUntil (UTC)", () => {
  const now = Date.UTC(2026, 0, 1, 10, 0, 0); // 10:00 UTC
  it("HH:MM later today", () => {
    expect(parseSnoozeUntil(now, "14:30", "UTC")).toBe(Date.UTC(2026, 0, 1, 14, 30, 0));
  });
  it("HH:MM already passed rolls to tomorrow", () => {
    expect(parseSnoozeUntil(now, "08:00", "UTC")).toBe(Date.UTC(2026, 0, 2, 8, 0, 0));
  });
  it("tomorrow HH:MM", () => {
    expect(parseSnoozeUntil(now, "tomorrow 09:00", "UTC")).toBe(Date.UTC(2026, 0, 2, 9, 0, 0));
  });
  it("rejects unsupported grammar", () => {
    expect(() => parseSnoozeUntil(now, "later", "UTC")).toThrow();
  });
  it("rejects out-of-range clock times instead of rolling them over", () => {
    expect(() => parseSnoozeUntil(now, "25:00", "UTC")).toThrow(/hour/);
    expect(() => parseSnoozeUntil(now, "12:60", "UTC")).toThrow(/minute/);
    expect(() => parseSnoozeUntil(now, "tomorrow 24:00", "UTC")).toThrow();
  });
});

describe("parseAbsoluteDate (UTC)", () => {
  it("defaults to 09:00 when no time given", () => {
    expect(parseAbsoluteDate("2026-03-10", "UTC")).toBe(Date.UTC(2026, 2, 10, 9, 0, 0));
  });
  it("honors an explicit time", () => {
    expect(parseAbsoluteDate("2026-03-10 18:45", "UTC")).toBe(Date.UTC(2026, 2, 10, 18, 45, 0));
  });
  it("rejects out-of-range fields and impossible calendar days", () => {
    expect(() => parseAbsoluteDate("2026-13-01", "UTC")).toThrow(); // month 13
    expect(() => parseAbsoluteDate("2026-01-40", "UTC")).toThrow(); // day 40
    expect(() => parseAbsoluteDate("2026-02-30", "UTC")).toThrow(/calendar/); // Feb 30 would roll to March
    expect(() => parseAbsoluteDate("2026-03-10 25:00", "UTC")).toThrow(); // hour 25
  });
});

// The whole point of this module is timezone correctness; UTC barely exercises the
// fromZonedTime/toZonedTime conversion (it's near-identity). Asia/Kolkata is UTC+5:30
// with no DST, so a flipped or dropped conversion produces a wrong, deterministic answer.
describe("timezone handling (Asia/Kolkata, UTC+5:30)", () => {
  it("isWithinQuietHours interprets the window in the configured zone", () => {
    // 02:00 UTC = 07:30 Kolkata → inside 07:00–09:00 local (would be outside in UTC)
    expect(
      isWithinQuietHours(Date.UTC(2026, 0, 1, 2, 0), qh("07:00", "09:00", "Asia/Kolkata")),
    ).toBe(true);
    // 04:00 UTC = 09:30 Kolkata → past the (exclusive) 09:00 end
    expect(
      isWithinQuietHours(Date.UTC(2026, 0, 1, 4, 0), qh("07:00", "09:00", "Asia/Kolkata")),
    ).toBe(false);
  });
  it("parseSnoozeUntil resolves the clock time in the configured zone", () => {
    // now = 00:00 UTC (05:30 Kolkata); "07:00" local = 01:30 UTC, still ahead → today
    expect(parseSnoozeUntil(Date.UTC(2026, 0, 1, 0, 0), "07:00", "Asia/Kolkata")).toBe(
      Date.UTC(2026, 0, 1, 1, 30, 0),
    );
  });
  it("parseAbsoluteDate offsets the wall-clock time to UTC", () => {
    expect(parseAbsoluteDate("2026-03-10 09:00", "Asia/Kolkata")).toBe(
      Date.UTC(2026, 2, 10, 3, 30, 0),
    );
  });
});
