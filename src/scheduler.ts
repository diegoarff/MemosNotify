import { Cron } from "croner";
import { formatInTimeZone } from "date-fns-tz";
import type { Config } from "./config/schema.ts";
import { addDuration, durationTarget } from "./core/duration.ts";
import { buildReminderView } from "./core/reminders.ts";
import { isWithinQuietHours } from "./core/time.ts";
import type { Notifier } from "./notifiers/interface.ts";
import type { Reminder, Storage } from "./storage/interface.ts";

// A fired one-shot parks here (max valid Date ms) so findDue skips it, yet it stays active until resolved.
const NEVER = 8_640_000_000_000_000;

// Keyed per target so one chat's daily digest can't withhold another chat's due reminders; persisted
// so a restart can't re-fire a digest that already went out today (the date lives in storage).
const DIGEST_KEY_PREFIX = "digest_last_date:";

export function startScheduler(config: Config, storage: Storage, notifier: Notifier): Cron {
  const sched = config.schedule;
  const qh = sched.quietHours;
  const tz = sched.timezone;

  async function reschedule(r: Reminder, now: number): Promise<void> {
    if (r.recurrence) {
      // Anchor the next occurrence on the scheduled time, not `now`, so the cadence doesn't drift by
      // up to a checkInterval each cycle; skip past occurrences missed during downtime so a long
      // outage doesn't fire a burst of catch-up nudges.
      let next = durationTarget(r.nextRemindAt, r.recurrence);
      while (next <= now) next = durationTarget(next, r.recurrence);
      await storage.setNextRemindAt(r.id, next);
    } else if (sched.renudge === "off") {
      await storage.setNextRemindAt(r.id, NEVER);
    } else {
      await storage.setNextRemindAt(r.id, addDuration(new Date(now), sched.renudge).getTime());
    }
  }

  // Delete handled messages whose retention window has elapsed. Runs before the quiet-hours guard
  // (deleting is silent) and is isolated from delivery so a failing sweep never blocks reminders.
  async function sweepDeletions(now: number): Promise<void> {
    if (sched.deleteHandledAfter === "off" || !notifier.deleteMessage) return;
    const del = notifier.deleteMessage.bind(notifier);
    for (const d of await storage.dueDeletions(now)) {
      // Telegram refuses messages > 48h old; drop the row regardless so we never loop on a stuck one.
      await del(d.chatTarget, d.messageId).catch((err: unknown) =>
        console.error(`delete message ${d.messageId} failed:`, err),
      );
      await storage.removeDeletion(d.id);
    }
  }

  async function tick(now: number): Promise<void> {
    await sweepDeletions(now).catch((err: unknown) => console.error("deletion sweep failed:", err));
    if (qh?.enabled && isWithinQuietHours(now, qh)) return; // defer the whole tick during quiet hours

    const digest = sched.digest;
    const today = formatInTimeZone(now, tz, "yyyy-MM-dd");
    // Zero-padded "HH:mm" compares lexicographically, so the digest only opens at/after `at`.
    if (digest.enabled && formatInTimeZone(now, tz, "HH:mm") < digest.at) return;

    const due = await storage.findDue(now);
    if (due.length === 0) return;

    // Group by target so several reminders for one chat arrive as a single digest.
    const byTarget = new Map<string, Reminder[]>();
    for (const r of due) {
      const list = byTarget.get(r.chatTarget) ?? [];
      list.push(r);
      byTarget.set(r.chatTarget, list);
    }

    for (const [target, reminders] of byTarget) {
      const digestKey = DIGEST_KEY_PREFIX + target;
      if (digest.enabled && (await storage.getMeta(digestKey)) === today) continue;

      // Reschedule only what notify() actually delivered, so a mid-batch failure leaves the rest due next tick.
      const sent = new Set(
        await notifier.notify(
          target,
          reminders.map((r) => buildReminderView(r, config.actions)),
        ),
      );
      let allDelivered = true;
      for (const r of reminders) {
        if (!sent.has(r.id)) {
          allDelivered = false;
          continue;
        }
        await reschedule(r, now);
      }

      // Mark this target's digest done only after a full delivery, so a partial failure retries next tick.
      if (digest.enabled && allDelivered) await storage.setMeta(digestKey, today);
    }
  }

  // Returning the promise is what lets `protect` see the async tick in flight and skip overlapping
  // runs (otherwise it would double-send and double-reschedule). `timezone` keeps checkInterval
  // aligned to the configured zone rather than the host's.
  return new Cron(sched.checkInterval, { protect: true, timezone: tz }, () =>
    tick(Date.now()).catch((err: unknown) => console.error("scheduler tick failed:", err)),
  );
}
