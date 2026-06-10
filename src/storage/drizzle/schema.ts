import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const reminders = sqliteTable(
  "reminders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memoId: text("memo_id").notNull(),
    memoName: text("memo_name"),
    excerpt: text("excerpt"),
    chatTarget: text("chat_target").notNull(),
    createdAt: integer("created_at").notNull(),
    nextRemindAt: integer("next_remind_at").notNull(),
    recurrence: text("recurrence"),
    status: text("status", { enum: ["active", "cleared", "ignored"] })
      .notNull()
      .default("active"),
  },
  (t) => [
    // Enforce one active reminder per memo id at the DB level, closing the check-then-insert race.
    // Partial (active only) so a cleared/ignored memo can be reminded again later.
    uniqueIndex("reminders_active_memo_id")
      .on(t.memoId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export type ReminderRow = typeof reminders.$inferSelect;
export type NewReminderRow = typeof reminders.$inferInsert;

// Small key/value store for scheduler state that must survive restarts (e.g. the last digest date).
export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Handled chat messages queued for deletion. Decoupled from `reminders`: one reminder can produce
// many messages over its life (recurrence, re-nudge, post-snooze), and each is deleted on its own
// clock once acted on. The scheduler sweeps rows whose `delete_after` has passed.
export const pendingDeletions = sqliteTable(
  "pending_deletions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chatTarget: text("chat_target").notNull(),
    messageId: integer("message_id").notNull(),
    deleteAfter: integer("delete_after").notNull(),
  },
  (t) => [index("pending_deletions_delete_after").on(t.deleteAfter)],
);
