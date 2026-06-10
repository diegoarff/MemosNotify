import { describe, expect, it } from "vitest";
import type { IncomingMemo } from "../core/reminders.ts";
import { createServer, normalizeMemo } from "./server.ts";

describe("normalizeMemo", () => {
  it("reads the nested `memo` shape", () => {
    const m = normalizeMemo({
      activityType: "memos.memo.created",
      creatorId: 3,
      memo: { name: "memos/1", uid: "abc", content: "#remind", tags: ["remind"] },
    });
    expect(m).toEqual({
      id: "abc",
      name: "memos/1",
      content: "#remind",
      tags: ["remind"],
      creatorId: 3,
    });
  });
  it("reads the flat shape and parses users/{id}", () => {
    const m = normalizeMemo({ type: "create", name: "memos/2", content: "hi", creator: "users/7" });
    expect(m?.creatorId).toBe(7);
    expect(m?.id).toBe("memos/2"); // no uid → falls back to the resource name
  });
  it("skips non-create activities", () => {
    expect(
      normalizeMemo({ activityType: "memos.memo.updated", memo: { name: "memos/1" } }),
    ).toBeNull();
  });
  it("skips activities that merely contain 'creat' but aren't the create event", () => {
    expect(
      normalizeMemo({ activityType: "memos.memo.created_reaction", memo: { name: "memos/1" } }),
    ).toBeNull();
    expect(
      normalizeMemo({ activityType: "memos.reaction.uncreate", memo: { name: "memos/1" } }),
    ).toBeNull();
  });
  it("skips memos with no identifier", () => {
    expect(normalizeMemo({ content: "x" })).toBeNull();
  });
});

describe("POST /memos-webhook", () => {
  const make = () => {
    const seen: IncomingMemo[] = [];
    const app = createServer({
      onMemoCreated: async (m) => {
        seen.push(m);
      },
    });
    return { app, seen };
  };
  const post = (app: ReturnType<typeof createServer>, body: string) =>
    app.request("/memos-webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

  it("accepts a valid creation and forwards the normalized memo", async () => {
    const { app, seen } = make();
    const res = await post(
      app,
      JSON.stringify({
        activityType: "memos.memo.created",
        memo: { uid: "abc", name: "memos/1", content: "#remind" },
      }),
    );
    expect(res.status).toBe(200);
    expect(seen[0]?.id).toBe("abc");
  });
  it("400s on malformed JSON", async () => {
    const { app } = make();
    expect((await post(app, "{not json")).status).toBe(400);
  });
  it("accepts but skips when there is nothing to schedule", async () => {
    const { app, seen } = make();
    const res = await post(app, JSON.stringify({}));
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(0);
  });
  it("serves the health check", async () => {
    const { app } = make();
    expect((await app.request("/health")).status).toBe(200);
  });
});
