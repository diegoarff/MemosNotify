import { Cron } from "croner";
import { z } from "zod";
import { DURATION_RE, parseDuration } from "../core/duration.ts";
import { isValidSnoozeUntil } from "../core/time.ts";

// This module is the single source of truth for config types: everything is derived
// via z.infer, so there are no hand-maintained interfaces to keep in sync.

const Duration = z
  .string()
  .regex(DURATION_RE, "use e.g. 30m, 12h, 3d, 2w, 1mo, 1y")
  .transform(parseDuration);

// Chat ids are often written unquoted in YAML, arriving as numbers; normalize to string.
const ChatId = z.union([z.string(), z.number()]).transform(String);

const TimeOfDay = z.string().regex(/^\d{2}:\d{2}$/, "use HH:MM, e.g. 08:00");

// croner throws on a malformed pattern; validate at load so a bad interval fails fast with a clear
// message instead of crashing the scheduler after the server and bot are already up.
const CronExpr = z.string().refine((expr) => {
  try {
    new Cron(expr).stop();
    return true;
  } catch {
    return false;
  }
}, "invalid cron expression");

const actionBase = {
  id: z.string().regex(/^[a-z0-9_-]{1,16}$/), // short id keeps callback_data under Telegram's 64 bytes
  label: z.string().min(1),
};

export const Action = z.discriminatedUnion("type", [
  z.object({ ...actionBase, type: z.literal("snooze"), duration: Duration }),
  z.object({
    ...actionBase,
    type: z.literal("snooze_until"),
    time: z.string().refine(isValidSnoozeUntil, "use HH:MM, next HH:MM, or tomorrow HH:MM"),
  }),
  z.object({ ...actionBase, type: z.literal("clear"), archiveMemo: z.boolean().default(false) }),
  z.object({ ...actionBase, type: z.literal("ignore") }),
  // z.url() rejects a schemeless value that Telegram would refuse, never rescheduling the reminder.
  z.object({ ...actionBase, type: z.literal("open_url"), url: z.url() }),
  z.object({
    ...actionBase,
    type: z.literal("webhook"),
    url: z.url(),
    method: z.enum(["GET", "POST"]).default("POST"),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
  }),
  z.object({
    ...actionBase,
    type: z.literal("complete"),
    addTag: z.string().optional(),
    archiveMemo: z.boolean().default(false),
  }),
]);
export type Action = z.infer<typeof Action>;

const NotifierConfig = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("telegram"),
    telegram: z.object({
      botToken: z.string().min(1),
      defaultChatId: ChatId,
      chatRouting: z.array(z.object({ memosCreatorId: z.number(), chatId: ChatId })).optional(),
    }),
  }),
]);

const TriggersConfig = z.object({
  mode: z.enum(["opt-in", "all"]).default("opt-in"),
  tags: z.array(z.string()).default(["remind"]),
  inlineTiming: z.boolean().default(true),
  defaultDelay: Duration,
  tagDelays: z.record(z.string(), Duration).optional(),
});

const ScheduleConfig = z
  .object({
    checkInterval: CronExpr.default("*/15 * * * *"),
    // IANA timezone for all date math: digest delivery, snooze_until, absolute dates, quiet hours.
    timezone: z.string().default("UTC"),
    renudge: z.union([z.literal("off"), Duration]).default("off"), // "off" = single shot
    digest: z
      .object({
        enabled: z.boolean().default(false),
        at: TimeOfDay.default("08:00"),
      })
      .prefault({}), // prefault (not default) runs {} through the schema so inner defaults apply (Zod 4)
    quietHours: z
      .object({
        enabled: z.boolean().default(false),
        timezone: z.string().optional(), // optional override for the quiet window only
        from: TimeOfDay,
        to: TimeOfDay,
      })
      .optional(),
  })
  .transform((s) => ({
    ...s,
    // Quiet hours inherit the schedule-wide timezone unless they explicitly override it.
    quietHours: s.quietHours
      ? { ...s.quietHours, timezone: s.quietHours.timezone ?? s.timezone }
      : undefined,
  }));

const MemosConfig = z.object({
  baseUrl: z.url(),
  token: z.string().min(1),
});

const StorageConfig = z.object({
  driver: z.enum(["sqlite", "postgres"]).default("sqlite"),
  url: z.string().min(1),
});

export const Config = z
  .object({
    notifier: NotifierConfig,
    triggers: TriggersConfig,
    schedule: ScheduleConfig,
    actions: z.array(Action).min(1).max(8), // cap keeps the inline keyboard usable
    memos: MemosConfig.optional(),
    storage: StorageConfig,
    // .int().min(1) rejects the 0 that z.coerce.number() would otherwise produce from "" / null.
    server: z
      .object({ port: z.coerce.number().int().min(1).max(65535).default(3000) })
      .prefault({}),
  })
  .superRefine((cfg, ctx) => {
    // archiveMemo/addTag drive the Memos API; without a `memos` block they'd silently no-op while the
    // reminder is still marked done, so reject that at load rather than letting the two sides diverge.
    const needsMemos = cfg.actions.some(
      (a) =>
        (a.type === "clear" && a.archiveMemo) ||
        (a.type === "complete" && (a.archiveMemo || a.addTag !== undefined)),
    );
    if (needsMemos && !cfg.memos) {
      ctx.addIssue({
        code: "custom",
        message: "actions use archiveMemo/addTag but no `memos` connection is configured",
      });
    }
  });
export type Config = z.infer<typeof Config>;
