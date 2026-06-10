import { afterEach, describe, expect, it, vi } from "vitest";
import { Action } from "../config/schema.ts";
import type { MemosClient } from "../memos/client.ts";
import type { Reminder, ReminderStatus, Storage } from "../storage/interface.ts";
import { executeAction } from "./actions.ts";

function harness(reminder: Reminder) {
  const state = { nextRemindAt: reminder.nextRemindAt, status: reminder.status as ReminderStatus };
  const storage: Storage = {
    init: async () => {},
    existsForMemo: async () => false,
    insert: async () => 1,
    findDue: async () => [],
    get: async (id) => (id === reminder.id ? { ...reminder, ...state } : undefined),
    listActiveForTarget: async () => [],
    setNextRemindAt: async (_id, ts) => {
      state.nextRemindAt = ts;
    },
    setStatus: async (_id, s) => {
      state.status = s;
    },
    getMeta: async () => undefined,
    setMeta: async () => {},
  };
  return { storage, state };
}

const fakeMemos = () =>
  ({ archiveMemo: vi.fn(async () => {}), addTag: vi.fn(async () => {}) }) as unknown as MemosClient;

const reminder: Reminder = {
  id: 1,
  memoId: "uid1",
  memoName: "memos/1",
  excerpt: "x",
  chatTarget: "1",
  createdAt: 0,
  nextRemindAt: 1000,
  recurrence: null,
  status: "active",
};

describe("executeAction", () => {
  afterEach(() => {
    vi.unstubAllGlobals(); // restore fetch even if a test throws before its own cleanup
  });

  it("snooze pushes nextRemindAt by the duration", async () => {
    const { storage, state } = harness(reminder);
    const a = Action.parse({ id: "s", label: "10m", type: "snooze", duration: "10m" });
    await executeAction({ storage, actions: [a], timezone: "UTC" }, 1, "s", 5_000);
    expect(state.nextRemindAt).toBe(5_000 + 600_000);
  });

  it("snooze_until resolves the clock time in the context timezone", async () => {
    const { storage, state } = harness(reminder);
    const a = Action.parse({ id: "su", label: "07:00", type: "snooze_until", time: "07:00" });
    // now = 00:00 UTC (05:30 Kolkata); "07:00" local = 01:30 UTC. UTC would give a different ts.
    await executeAction(
      { storage, actions: [a], timezone: "Asia/Kolkata" },
      1,
      "su",
      Date.UTC(2026, 0, 1, 0, 0),
    );
    expect(state.nextRemindAt).toBe(Date.UTC(2026, 0, 1, 1, 30, 0));
  });

  it("ignore sets status ignored", async () => {
    const { storage, state } = harness(reminder);
    const a = Action.parse({ id: "i", label: "Ignore", type: "ignore" });
    await executeAction({ storage, actions: [a], timezone: "UTC" }, 1, "i");
    expect(state.status).toBe("ignored");
  });

  it("clear archives the memo when configured", async () => {
    const { storage, state } = harness(reminder);
    const a = Action.parse({ id: "c", label: "Clear", type: "clear", archiveMemo: true });
    const memos = fakeMemos();
    await executeAction({ storage, actions: [a], timezone: "UTC", memos }, 1, "c");
    expect(state.status).toBe("cleared");
    expect(memos.archiveMemo).toHaveBeenCalledWith("memos/1");
  });

  it("complete adds a tag, archives, and clears", async () => {
    const { storage, state } = harness(reminder);
    const a = Action.parse({
      id: "d",
      label: "Done",
      type: "complete",
      addTag: "done",
      archiveMemo: true,
    });
    const memos = fakeMemos();
    await executeAction({ storage, actions: [a], timezone: "UTC", memos }, 1, "d");
    expect(memos.addTag).toHaveBeenCalledWith("memos/1", "done");
    expect(memos.archiveMemo).toHaveBeenCalledWith("memos/1");
    expect(state.status).toBe("cleared");
  });

  it("webhook fires a templated request", async () => {
    const { storage } = harness(reminder);
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const a = Action.parse({
      id: "w",
      label: "Hook",
      type: "webhook",
      url: "https://e.test/{memoUid}",
      body: "id={reminderId}",
    });
    await executeAction({ storage, actions: [a], timezone: "UTC" }, 1, "w");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://e.test/uid1",
      expect.objectContaining({ method: "POST", body: "id=1" }),
    );
  });

  it("unknown action id is a no-op", async () => {
    const { storage, state } = harness(reminder);
    await executeAction({ storage, actions: [], timezone: "UTC" }, 1, "missing");
    expect(state.status).toBe("active");
  });
});
