import { describe, expect, it } from "vitest";
import { addDuration, durationTarget, parseDuration } from "./duration.ts";

describe("parseDuration", () => {
  it("parses fixed units to exact ms", () => {
    expect(parseDuration("30m")).toEqual({ kind: "fixed", ms: 1_800_000 });
    expect(parseDuration("2h")).toEqual({ kind: "fixed", ms: 7_200_000 });
    expect(parseDuration("1w")).toEqual({ kind: "fixed", ms: 604_800_000 });
  });
  it("parses calendar units symbolically", () => {
    expect(parseDuration("1mo")).toEqual({ kind: "calendar", unit: "mo", n: 1 });
    expect(parseDuration("2y")).toEqual({ kind: "calendar", unit: "y", n: 2 });
  });
  it("rejects nonsense", () => {
    expect(() => parseDuration("5x")).toThrow();
    expect(() => parseDuration("abc")).toThrow();
  });
});

describe("addDuration / durationTarget", () => {
  it("adds fixed durations exactly (epoch math)", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(addDuration(from, parseDuration("1h")).toISOString()).toBe("2026-01-01T01:00:00.000Z");
  });
  it("adds calendar months preserving the local day-of-month", () => {
    const from = new Date(2026, 0, 15, 12, 0, 0); // mid-month avoids TZ rollover flakiness
    const next = addDuration(from, parseDuration("1mo"));
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(15);
  });
  it("durationTarget returns epoch ms", () => {
    const base = Date.UTC(2026, 0, 1);
    expect(durationTarget(base, "1d")).toBe(base + 86_400_000);
  });
});
