import { describe, expect, it } from "vitest";
import type { ReminderView } from "./interface.ts";
import {
  buildKeyboard,
  buildMessageText,
  formatCallbackData,
  parseCallbackData,
} from "./telegram.ts";

describe("callback data", () => {
  it("round-trips reminderId + actionId", () => {
    expect(formatCallbackData(42, "snooze")).toBe("42:snooze");
    expect(parseCallbackData("42:snooze")).toEqual({ reminderId: 42, actionId: "snooze" });
  });
  it("rejects malformed data", () => {
    expect(parseCallbackData("nocolon")).toBeNull();
    expect(parseCallbackData("x:y")).toBeNull(); // non-numeric id
    expect(parseCallbackData("5:")).toBeNull(); // empty action
  });
});

describe("buildMessageText", () => {
  it("uses the excerpt", () => {
    expect(buildMessageText({ reminderId: 1, excerpt: "buy milk", actions: [] })).toBe(
      "🔔 buy milk",
    );
  });
  it("falls back when the excerpt is blank", () => {
    expect(buildMessageText({ reminderId: 1, excerpt: "   ", actions: [] })).toBe(
      "🔔 (no preview)",
    );
  });
});

describe("buildKeyboard", () => {
  const view: ReminderView = {
    reminderId: 9,
    excerpt: "x",
    actions: [
      { id: "s", label: "Snooze", type: "snooze" },
      { id: "o", label: "Open", type: "open_url", url: "https://x" },
    ],
  };
  it("maps open_url to link buttons and the rest to callbacks", () => {
    const flat = buildKeyboard(view).inline_keyboard.flat();
    expect(flat[0]).toEqual({ text: "Snooze", callback_data: "9:s" });
    expect(flat[1]).toEqual({ text: "Open", url: "https://x" });
  });
  it("drops open_url buttons whose url didn't resolve (no dead 'success' button)", () => {
    const flat = buildKeyboard({
      reminderId: 9,
      excerpt: "x",
      actions: [
        { id: "s", label: "Snooze", type: "snooze" },
        { id: "o", label: "Open", type: "open_url" }, // url unset → omit entirely
      ],
    }).inline_keyboard.flat();
    expect(flat).toEqual([{ text: "Snooze", callback_data: "9:s" }]);
  });
});
