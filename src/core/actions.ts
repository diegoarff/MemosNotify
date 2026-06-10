import type { Action } from "../config/schema.ts";
import type { MemosClient } from "../memos/client.ts";
import type { Reminder, Storage } from "../storage/interface.ts";
import { addDuration } from "./duration.ts";
import { interpolateTemplate } from "./reminders.ts";
import { parseSnoozeUntil } from "./time.ts";

export interface ActionContext {
  storage: Storage;
  actions: Action[];
  timezone: string;
  memos?: MemosClient | undefined;
}

// Unknown ids and missing reminders are no-ops so a double-tapped button is idempotent.
export async function executeAction(
  ctx: ActionContext,
  reminderId: number,
  actionId: string,
  now: number = Date.now(),
): Promise<void> {
  const action = ctx.actions.find((a) => a.id === actionId);
  if (!action) return;

  const reminder = await ctx.storage.get(reminderId);
  if (!reminder) return;

  switch (action.type) {
    case "snooze": {
      const ts = addDuration(new Date(now), action.duration).getTime();
      await ctx.storage.setNextRemindAt(reminderId, ts);
      return;
    }
    case "snooze_until": {
      const ts = parseSnoozeUntil(now, action.time, ctx.timezone);
      await ctx.storage.setNextRemindAt(reminderId, ts);
      return;
    }
    case "clear": {
      // Archive (remote) before committing the cleared status, so a failed Memos call leaves both
      // sides retryable. Fall back to memoId (always present) when the resource name wasn't captured.
      if (action.archiveMemo) {
        await ctx.memos?.archiveMemo(reminder.memoName ?? reminder.memoId);
      }
      await ctx.storage.setStatus(reminderId, "cleared");
      return;
    }
    case "ignore": {
      await ctx.storage.setStatus(reminderId, "ignored");
      return;
    }
    case "open_url": {
      // Rendered as a URL button: the tap opens a link client-side, never round-tripping a callback.
      return;
    }
    case "webhook": {
      await fireWebhook(action, reminder);
      return;
    }
    case "complete": {
      // Side-effects before terminal status; addTag is idempotent so a retry after a later failure is
      // safe. Fall back to memoId (always present) when the resource name wasn't captured.
      const memoRef = reminder.memoName ?? reminder.memoId;
      if (action.addTag) await ctx.memos?.addTag(memoRef, action.addTag);
      if (action.archiveMemo) await ctx.memos?.archiveMemo(memoRef);
      await ctx.storage.setStatus(reminderId, "cleared");
      return;
    }
  }
}

type WebhookAction = Extract<Action, { type: "webhook" }>;

async function fireWebhook(action: WebhookAction, reminder: Reminder): Promise<void> {
  const url = interpolateTemplate(action.url, reminder);
  const init: RequestInit = { method: action.method };
  if (action.method === "POST" && action.body !== undefined) {
    init.body = interpolateTemplate(action.body, reminder);
    // Default the body to JSON (the common webhook case) so it isn't sent as text/plain, while
    // letting configured headers override the content type.
    init.headers = { "content-type": "application/json", ...action.headers };
  } else if (action.headers) {
    init.headers = action.headers;
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`webhook ${action.method} ${url} → ${res.status} ${res.statusText}`);
  }
}
