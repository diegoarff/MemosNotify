import type { Action, Config } from "../config/schema.ts";
import type { ReminderView } from "../notifiers/interface.ts";
import type { Reminder } from "../storage/interface.ts";
import { addDuration, DURATION_RE, durationTarget } from "./duration.ts";
import { contentHasTag, escapeRegExp } from "./text.ts";
import { parseAbsoluteDate } from "./time.ts";

/** A created memo, normalized from the (version-variable) Memos webhook payload. */
export interface IncomingMemo {
  id: string;
  name: string | null;
  content: string;
  tags: string[];
  creatorId: number | null;
}

export interface TriggerOutcome {
  nextRemindAt: number;
  recurrence: string | null; // duration string e.g. "1w"; null = one-shot
  excerpt: string | null;
}

/** Whole-tag match: `#remind` matches, `#reminder` does not. */
export function memoHasTag(memo: Pick<IncomingMemo, "content" | "tags">, tag: string): boolean {
  if (memo.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return true;
  return contentHasTag(memo.content, tag);
}

/** Extract the inline timing payload from `#tag(...)`, or null if there are no parens. */
export function extractInlineTiming(content: string, tag: string): string | null {
  const re = new RegExp(String.raw`#${escapeRegExp(tag)}\(([^)]*)\)`, "i");
  const match = re.exec(content);
  return match ? (match[1] ?? "") : null;
}

interface Timing {
  nextRemindAt: number;
  recurrence: string | null;
}

/** Parse the inside of `#tag(...)`: "3d" | "every 1w" | "2025-12-01[ 09:00]". */
export function parseInlineTiming(inner: string, now: number, tz: string): Timing | null {
  const text = inner.trim();

  const every = /^every\s+(.+)$/i.exec(text);
  if (every) {
    const dur = (every[1] ?? "").trim();
    if (!DURATION_RE.test(dur)) return null;
    return { nextRemindAt: durationTarget(now, dur), recurrence: dur };
  }

  if (DURATION_RE.test(text)) {
    return { nextRemindAt: durationTarget(now, text), recurrence: null };
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    try {
      return { nextRemindAt: parseAbsoluteDate(text, tz), recurrence: null };
    } catch {
      return null;
    }
  }

  return null;
}

function makeExcerpt(content: string): string | null {
  const cleaned = content.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > 140 ? `${cleaned.slice(0, 139)}…` : cleaned;
}

/** Decide whether (and when) a created memo schedules a reminder; null = no reminder. */
export function evaluateTriggers(
  config: Config,
  memo: IncomingMemo,
  now: number,
): TriggerOutcome | null {
  const { triggers } = config;
  const tz = config.schedule.timezone;

  // tagDelays keys double as trigger tags, else a `#remind1w` override could never match
  // (presentTags would only ever hold the tags listed in `triggers.tags`).
  const candidateTags = new Set(triggers.tags);
  for (const tag of Object.keys(triggers.tagDelays ?? {})) candidateTags.add(tag);

  const presentTags = [...candidateTags].filter((tag) => memoHasTag(memo, tag));
  if (triggers.mode === "opt-in" && presentTags.length === 0) return null;

  let timing: Timing | undefined;
  if (triggers.inlineTiming) {
    for (const tag of presentTags) {
      const inner = extractInlineTiming(memo.content, tag);
      if (inner === null) continue;
      const parsed = parseInlineTiming(inner, now, tz);
      if (parsed) {
        timing = parsed;
        break;
      }
    }
  }

  if (!timing) {
    const delay =
      presentTags.map((tag) => triggers.tagDelays?.[tag]).find(Boolean) ?? triggers.defaultDelay;
    timing = { nextRemindAt: addDuration(new Date(now), delay).getTime(), recurrence: null };
  }

  return { ...timing, excerpt: makeExcerpt(memo.content) };
}

// memoId holds the webhook's short uid, or the resource name as a fallback. {memoUid} yields a
// deep-link slug: the uid as-is, or the resource name's final segment ("memos/2" → "2").
function memoUidSlug(memoId: string): string {
  const slash = memoId.lastIndexOf("/");
  return slash >= 0 ? memoId.slice(slash + 1) : memoId;
}

export function interpolateTemplate(tpl: string, reminder: Reminder): string {
  return tpl
    .replaceAll("{reminderId}", String(reminder.id))
    .replaceAll("{memoId}", reminder.memoId)
    .replaceAll("{memoUid}", memoUidSlug(reminder.memoId))
    .replaceAll("{memoName}", reminder.memoName ?? "");
}

/** Turn a stored reminder + the configured action set into a channel-agnostic view. */
export function buildReminderView(reminder: Reminder, actions: Action[]): ReminderView {
  return {
    reminderId: reminder.id,
    excerpt: reminder.excerpt ?? "",
    actions: actions.map((a) => ({
      id: a.id,
      label: a.label,
      type: a.type,
      ...(a.type === "open_url" ? { url: interpolateTemplate(a.url, reminder) } : {}),
    })),
  };
}
