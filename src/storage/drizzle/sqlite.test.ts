import { describe, expect, it } from "vitest";
import { SqliteStorage } from "./sqlite.ts";

describe("SqliteStorage (in-memory libSQL)", () => {
  it("runs migrations and round-trips a reminder through its lifecycle", async () => {
    const s = new SqliteStorage(":memory:");
    await s.init();

    expect(await s.existsForMemo("uid1")).toBe(false);

    const id = await s.insert({
      memoId: "uid1",
      memoName: "memos/1",
      excerpt: "buy milk",
      chatTarget: "123",
      createdAt: 1_000,
      nextRemindAt: 2_000,
      recurrence: null,
      status: "active",
    });
    expect(id).toBeGreaterThan(0);
    expect(await s.existsForMemo("uid1")).toBe(true);

    // findDue is inclusive of `now` and excludes the future
    expect(await s.findDue(1_999)).toHaveLength(0);
    expect(await s.findDue(2_000)).toHaveLength(1);

    const got = await s.get(id);
    expect(got?.excerpt).toBe("buy milk");
    expect(got?.memoName).toBe("memos/1");

    await s.setNextRemindAt(id, 9_999);
    expect((await s.get(id))?.nextRemindAt).toBe(9_999);

    expect(await s.listActiveForTarget("123")).toHaveLength(1);

    // resolving the reminder removes it from active queries + dedupe
    await s.setStatus(id, "cleared");
    expect(await s.listActiveForTarget("123")).toHaveLength(0);
    expect(await s.existsForMemo("uid1")).toBe(false);
    expect(await s.findDue(9_999)).toHaveLength(0);
  });

  it("dedupes a concurrent active reminder for the same memo via the unique index", async () => {
    const s = new SqliteStorage(":memory:");
    await s.init();
    const base = {
      memoName: null,
      excerpt: "x",
      chatTarget: "1",
      createdAt: 0,
      nextRemindAt: 0,
      recurrence: null,
      status: "active" as const,
    };

    const id1 = await s.insert({ memoId: "dup", ...base });
    const id2 = await s.insert({ memoId: "dup", ...base }); // collides on the active-memo index
    expect(id2).toBe(id1); // no duplicate row; the surviving id is returned

    // Once resolved, the memo can be reminded again (partial index only covers active rows).
    await s.setStatus(id1, "cleared");
    const id3 = await s.insert({ memoId: "dup", ...base });
    expect(id3).not.toBe(id1);
  });

  it("queues, returns, and clears pending message deletions by their due time", async () => {
    const s = new SqliteStorage(":memory:");
    await s.init();

    expect(await s.dueDeletions(Number.MAX_SAFE_INTEGER)).toHaveLength(0);

    await s.enqueueDeletion("chat-a", 10, 5_000);
    await s.enqueueDeletion("chat-a", 11, 9_000);

    // dueDeletions is inclusive of `now` and excludes the not-yet-due
    expect(await s.dueDeletions(4_999)).toHaveLength(0);
    const dueAt5k = await s.dueDeletions(5_000);
    expect(dueAt5k).toHaveLength(1);
    expect(dueAt5k[0]).toMatchObject({ chatTarget: "chat-a", messageId: 10 });

    // removing a row drops it from later sweeps; the other remains until its time
    await s.removeDeletion(dueAt5k[0]!.id);
    expect(await s.dueDeletions(5_000)).toHaveLength(0);
    expect(await s.dueDeletions(9_000)).toHaveLength(1);
  });

  it("persists meta values with upsert semantics", async () => {
    const s = new SqliteStorage(":memory:");
    await s.init();
    expect(await s.getMeta("digest_last_date")).toBeUndefined();
    await s.setMeta("digest_last_date", "2026-01-01");
    expect(await s.getMeta("digest_last_date")).toBe("2026-01-01");
    await s.setMeta("digest_last_date", "2026-01-02"); // overwrites, doesn't duplicate the key
    expect(await s.getMeta("digest_last_date")).toBe("2026-01-02");
  });
});
