import { serve } from "@hono/node-server";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { IncomingMemo } from "../core/reminders.ts";

export interface WebhookDeps {
  onMemoCreated(memo: IncomingMemo): Promise<void>;
}

// The webhook body shifts across Memos releases: the memo may be nested under `memo` or be
// top-level, the activity key is `activityType` or `type`, and the creator is a number or a
// "users/{id}" string. So the schema is deliberately loose and normalizeMemo() does the work.
const memoFields = {
  name: z.string().optional(),
  uid: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  creator: z.string().optional(), // "users/1"
  creatorId: z.number().optional(),
};

export const MemosWebhook = z.object({
  activityType: z.string().optional(),
  type: z.string().optional(),
  ...memoFields,
  memo: z.object(memoFields).optional(),
});
export type MemosWebhook = z.infer<typeof MemosWebhook>;

function parseCreatorId(s: string | undefined): number | null {
  if (!s) return null;
  const m = /(\d+)$/.exec(s); // "users/1" → 1
  return m ? Number(m[1]) : null;
}

// Recognize a create activity: bare "create" or a ".create"/".created" suffix; anchored so
// "updated"/"recreated" don't match.
const CREATE_ACTIVITY = /(?:^|\.)creat(?:e|ed)$/i;

// Returns null to skip: a recognized non-create activity, and memos we can neither dedupe nor
// reference. A payload with no activity field at all is treated as a create — some Memos builds omit
// it, and the per-memo unique index stops a re-delivered create from scheduling the same memo twice.
export function normalizeMemo(p: MemosWebhook): IncomingMemo | null {
  const activity = p.activityType ?? p.type;
  if (activity && !CREATE_ACTIVITY.test(activity)) return null;

  const memo = p.memo ?? p;
  const id = memo.uid ?? memo.name ?? null; // prefer uid: stable dedupe key + deep link
  if (!id) return null;

  return {
    id,
    name: memo.name ?? null,
    content: memo.content ?? "",
    tags: memo.tags ?? [],
    creatorId: p.creatorId ?? memo.creatorId ?? parseCreatorId(memo.creator ?? p.creator),
  };
}

export function createServer(deps: WebhookDeps): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.post(
    "/memos-webhook",
    zValidator("json", MemosWebhook, (result, c) => {
      if (!result.success) return c.json({ error: "invalid payload" }, 400);
      return undefined;
    }),
    async (c) => {
      const memo = normalizeMemo(c.req.valid("json"));
      if (!memo) return c.json({ ok: true, skipped: true });
      await deps.onMemoCreated(memo);
      return c.json({ ok: true });
    },
  );

  return app;
}

export function startServer(app: Hono, port: number): ReturnType<typeof serve> {
  return serve({ fetch: app.fetch, port });
}
