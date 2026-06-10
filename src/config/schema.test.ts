import { describe, expect, it } from "vitest";
import { Config } from "./schema.ts";

// Minimal valid config; tests override `schedule.deleteHandledAfter` on top of it.
function baseConfig(deleteHandledAfter?: string): Record<string, unknown> {
  return {
    notifier: { type: "telegram", telegram: { botToken: "t", defaultChatId: "1" } },
    triggers: { defaultDelay: "7d" },
    actions: [{ id: "mute", label: "Mute", type: "ignore" }],
    storage: { url: "file:test.db" },
    schedule: deleteHandledAfter === undefined ? {} : { deleteHandledAfter },
  };
}

describe("schedule.deleteHandledAfter", () => {
  it("defaults to off when omitted", () => {
    const parsed = Config.parse(baseConfig());
    expect(parsed.schedule.deleteHandledAfter).toBe("off");
  });

  it("accepts off and durations from 0 up to 24h", () => {
    for (const v of ["off", "0s", "30s", "90m", "12h", "24h", "1440m", "1d", "86400s"]) {
      expect(Config.safeParse(baseConfig(v)).success, v).toBe(true);
    }
  });

  it("rejects durations longer than 24h", () => {
    for (const v of ["25h", "2d", "1w", "1mo", "1y", "1441m", "86401s"]) {
      expect(Config.safeParse(baseConfig(v)).success, v).toBe(false);
    }
  });
});
