import { describe, expect, it } from "vitest";
import { Action, Config } from "../config/schema.ts";
import type { Reminder } from "../storage/interface.ts";
import {
  buildReminderView,
  evaluateTriggers,
  extractInlineTiming,
  type IncomingMemo,
  interpolateTemplate,
  memoHasTag,
  parseInlineTiming,
} from "./reminders.ts";

const memo = (over: Partial<IncomingMemo> = {}): IncomingMemo => ({
  id: "uid1",
  name: "memos/1",
  content: "",
  tags: [],
  creatorId: null,
  ...over,
});

describe("memoHasTag", () => {
  it("matches whole tags only", () => {
    expect(memoHasTag({ content: "buy milk #remind", tags: [] }, "remind")).toBe(true);
    expect(memoHasTag({ content: "a #reminder b", tags: [] }, "remind")).toBe(false);
    expect(memoHasTag({ content: "no inline tag", tags: ["remind"] }, "remind")).toBe(true);
  });
});

describe("inline timing", () => {
  it("extracts the parenthesized payload", () => {
    expect(extractInlineTiming("do it #remind(3d)", "remind")).toBe("3d");
    expect(extractInlineTiming("do it #remind", "remind")).toBeNull();
  });
  it("parses durations, recurrence, and absolute dates", () => {
    const now = Date.UTC(2026, 0, 1);
    expect(parseInlineTiming("3d", now, "UTC")).toEqual({
      nextRemindAt: now + 3 * 86_400_000,
      recurrence: null,
    });
    expect(parseInlineTiming("every 1w", now, "UTC")).toEqual({
      nextRemindAt: now + 604_800_000,
      recurrence: "1w",
    });
    expect(parseInlineTiming("2026-06-01", now, "UTC")?.recurrence).toBeNull();
    expect(parseInlineTiming("nonsense", now, "UTC")).toBeNull();
  });
});

function baseConfig(): Config {
  return Config.parse({
    notifier: { type: "telegram", telegram: { botToken: "x", defaultChatId: 1 } },
    triggers: { defaultDelay: "1h" },
    schedule: {},
    actions: [{ id: "done", label: "Done", type: "complete" }],
    storage: { url: ":memory:" },
  });
}

describe("evaluateTriggers", () => {
  it("ignores memos without a trigger tag in opt-in mode", () => {
    expect(evaluateTriggers(baseConfig(), memo({ content: "just a note" }), Date.now())).toBeNull();
  });
  it("uses the default delay when there is no inline timing", () => {
    const now = Date.UTC(2026, 0, 1);
    const out = evaluateTriggers(baseConfig(), memo({ content: "ping #remind" }), now);
    expect(out?.nextRemindAt).toBe(now + 3_600_000);
    expect(out?.recurrence).toBeNull();
  });
  it("honors inline timing over the default delay", () => {
    const now = Date.UTC(2026, 0, 1);
    const out = evaluateTriggers(baseConfig(), memo({ content: "ping #remind(every 1w)" }), now);
    expect(out?.recurrence).toBe("1w");
    expect(out?.nextRemindAt).toBe(now + 604_800_000);
  });
  it("applies a tagDelays override whose key isn't listed in `tags`", () => {
    const now = Date.UTC(2026, 0, 1);
    const config = Config.parse({
      notifier: { type: "telegram", telegram: { botToken: "x", defaultChatId: 1 } },
      triggers: { defaultDelay: "1h", tags: ["remind"], tagDelays: { remind1w: "1w" } },
      schedule: {},
      actions: [{ id: "done", label: "Done", type: "complete" }],
      storage: { url: ":memory:" },
    });
    const out = evaluateTriggers(config, memo({ content: "ship it #remind1w" }), now);
    expect(out?.nextRemindAt).toBe(now + 604_800_000); // the 1w override, not the 1h default
  });
});

describe("views", () => {
  const reminder: Reminder = {
    id: 7,
    memoId: "uid9",
    memoName: "memos/9",
    excerpt: "task",
    chatTarget: "1",
    createdAt: 0,
    nextRemindAt: 0,
    recurrence: null,
    status: "active",
  };
  it("interpolates templates", () => {
    expect(interpolateTemplate("/m/{memoUid}?r={reminderId}", reminder)).toBe("/m/uid9?r=7");
  });
  it("derives the {memoUid} deep-link slug from a fallback resource name", () => {
    // No real uid → memoId holds the resource name; {memoUid} must be the slug, not "memos/2".
    const fallback: Reminder = { ...reminder, memoId: "memos/2" };
    expect(interpolateTemplate("/m/{memoUid}", fallback)).toBe("/m/2");
    expect(interpolateTemplate("{memoId}", fallback)).toBe("memos/2"); // raw id unchanged
  });
  it("resolves open_url buttons and leaves callback ones bare", () => {
    const open = Action.parse({
      id: "o",
      label: "Open",
      type: "open_url",
      url: "https://x/m/{memoUid}",
    });
    const done = Action.parse({ id: "d", label: "Done", type: "complete" });
    const view = buildReminderView(reminder, [open, done]);
    expect(view.actions[0]).toEqual({
      id: "o",
      label: "Open",
      type: "open_url",
      url: "https://x/m/uid9",
    });
    expect(view.actions[1]).toEqual({ id: "d", label: "Done", type: "complete" });
  });
});
