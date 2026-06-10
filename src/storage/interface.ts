// Drizzle sits behind this interface — nothing else imports it — so a non-SQL backend stays possible.

export type ReminderStatus = "active" | "cleared" | "ignored";

export interface Reminder {
  id: number;
  memoId: string;
  memoName: string | null;
  excerpt: string | null;
  chatTarget: string; // resolved notifier target (e.g. Telegram chat id)
  createdAt: number;
  nextRemindAt: number;
  recurrence: string | null; // e.g. "1w"; null = one-shot
  status: ReminderStatus;
}

// A chat message queued for deletion once `deleteAfter` has passed (see `enqueueDeletion`).
export interface PendingDeletion {
  id: number;
  chatTarget: string;
  messageId: number;
}

export interface Storage {
  init(): Promise<void>; // run migrations
  existsForMemo(memoId: string): Promise<boolean>;
  insert(r: Omit<Reminder, "id">): Promise<number>;
  findDue(now: number): Promise<Reminder[]>;
  get(id: number): Promise<Reminder | undefined>;
  listActiveForTarget(chatTarget: string): Promise<Reminder[]>;
  setNextRemindAt(id: number, ts: number): Promise<void>;
  setStatus(id: number, status: ReminderStatus): Promise<void>;
  // Queue a handled message for later deletion; the scheduler removes it once `deleteAfter` passes.
  enqueueDeletion(chatTarget: string, messageId: number, deleteAfter: number): Promise<void>;
  dueDeletions(now: number): Promise<PendingDeletion[]>;
  removeDeletion(id: number): Promise<void>;
  // Durable key/value for scheduler state that must outlive a restart (e.g. the last digest date).
  getMeta(key: string): Promise<string | undefined>;
  setMeta(key: string, value: string): Promise<void>;
}
