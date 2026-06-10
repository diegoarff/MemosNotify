import { createClient, type Client } from "@libsql/client";
import { and, eq, lte } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { PendingDeletion, Reminder, ReminderStatus, Storage } from "../interface.ts";
import { meta, pendingDeletions, reminders } from "./schema.ts";

export class SqliteStorage implements Storage {
  private readonly client: Client;
  private readonly db: LibSQLDatabase<Record<string, never>>;

  constructor(
    url: string,
    private readonly migrationsFolder = "src/storage/drizzle/migrations",
  ) {
    this.client = createClient({ url });
    this.db = drizzle(this.client);
  }

  async init(): Promise<void> {
    await migrate(this.db, { migrationsFolder: this.migrationsFolder });
  }

  async existsForMemo(memoId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: reminders.id })
      .from(reminders)
      .where(and(eq(reminders.memoId, memoId), eq(reminders.status, "active")))
      .limit(1);
    return rows.length > 0;
  }

  async insert(r: Omit<Reminder, "id">): Promise<number> {
    // Closes the check-then-insert race via the unique index: a duplicate active row is dropped; return the survivor's id.
    const [row] = await this.db
      .insert(reminders)
      .values(r)
      .onConflictDoNothing()
      .returning({ id: reminders.id });
    if (row) return row.id;
    const [existing] = await this.db
      .select({ id: reminders.id })
      .from(reminders)
      .where(and(eq(reminders.memoId, r.memoId), eq(reminders.status, "active")))
      .limit(1);
    if (!existing) throw new Error("insert failed: no id returned");
    return existing.id;
  }

  async findDue(now: number): Promise<Reminder[]> {
    return this.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.status, "active"), lte(reminders.nextRemindAt, now)));
  }

  async get(id: number): Promise<Reminder | undefined> {
    const [row] = await this.db.select().from(reminders).where(eq(reminders.id, id)).limit(1);
    return row;
  }

  async listActiveForTarget(chatTarget: string): Promise<Reminder[]> {
    return this.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.chatTarget, chatTarget), eq(reminders.status, "active")));
  }

  async setNextRemindAt(id: number, ts: number): Promise<void> {
    await this.db.update(reminders).set({ nextRemindAt: ts }).where(eq(reminders.id, id));
  }

  async setStatus(id: number, status: ReminderStatus): Promise<void> {
    await this.db.update(reminders).set({ status }).where(eq(reminders.id, id));
  }

  async enqueueDeletion(chatTarget: string, messageId: number, deleteAfter: number): Promise<void> {
    await this.db.insert(pendingDeletions).values({ chatTarget, messageId, deleteAfter });
  }

  async dueDeletions(now: number): Promise<PendingDeletion[]> {
    return this.db
      .select({
        id: pendingDeletions.id,
        chatTarget: pendingDeletions.chatTarget,
        messageId: pendingDeletions.messageId,
      })
      .from(pendingDeletions)
      .where(lte(pendingDeletions.deleteAfter, now));
  }

  async removeDeletion(id: number): Promise<void> {
    await this.db.delete(pendingDeletions).where(eq(pendingDeletions.id, id));
  }

  async getMeta(key: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ value: meta.value })
      .from(meta)
      .where(eq(meta.key, key))
      .limit(1);
    return row?.value;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db
      .insert(meta)
      .values({ key, value })
      .onConflictDoUpdate({ target: meta.key, set: { value } });
  }
}
