import { loadConfig } from "./config/load.ts";
import { executeAction } from "./core/actions.ts";
import { addDuration } from "./core/duration.ts";
import { buildReminderView, evaluateTriggers } from "./core/reminders.ts";
import { MemosClient } from "./memos/client.ts";
import { TelegramNotifier } from "./notifiers/telegram.ts";
import { startScheduler } from "./scheduler.ts";
import { SqliteStorage } from "./storage/drizzle/sqlite.ts";
import { createServer, startServer } from "./webhook/server.ts";

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.storage.driver !== "sqlite") {
    throw new Error(`storage driver "${config.storage.driver}" not implemented yet`);
  }
  const storage = new SqliteStorage(config.storage.url);
  await storage.init();

  if (config.notifier.type !== "telegram") {
    throw new Error("only the telegram notifier is implemented in v0.1");
  }
  const tg = config.notifier.telegram;
  const notifier = new TelegramNotifier({
    botToken: tg.botToken,
    defaultChatId: tg.defaultChatId,
    chatRouting: tg.chatRouting,
  });

  const memos = config.memos
    ? new MemosClient({
        baseUrl: config.memos.baseUrl,
        token: config.memos.token,
      })
    : undefined;
  const timezone = config.schedule.timezone;

  notifier.registerQueries({
    listActive: async (target) => {
      const active = await storage.listActiveForTarget(target);
      return active.map((r) => buildReminderView(r, config.actions));
    },
    // Throwaway reminder (id 0 never resolves to a stored row, so tapping is a safe no-op) shown by /test.
    sampleView: () =>
      buildReminderView(
        {
          id: 0,
          memoId: "sample",
          memoName: null,
          excerpt: "This is a sample reminder — your real nudges will look like this.",
          chatTarget: "",
          createdAt: Date.now(),
          nextRemindAt: Date.now(),
          recurrence: null,
          status: "active",
        },
        config.actions,
      ),
  });

  const deleteHandledAfter = config.schedule.deleteHandledAfter;
  await notifier.start({
    onAction: (reminderId, actionId) =>
      executeAction({ storage, actions: config.actions, timezone, memos }, reminderId, actionId),
    // Queue the handled message for deletion; the scheduler sweeps it once the window elapses.
    // Conditional spread (not `onHandled: undefined`) to satisfy exactOptionalPropertyTypes.
    ...(deleteHandledAfter === "off"
      ? {}
      : {
          onHandled: async (target: string, messageId: number) => {
            const at = addDuration(new Date(), deleteHandledAfter).getTime();
            await storage.enqueueDeletion(target, messageId, at);
          },
        }),
  });

  const app = createServer({
    onMemoCreated: async (memo) => {
      const now = Date.now();
      const outcome = evaluateTriggers(config, memo, now);
      if (!outcome) return;
      if (await storage.existsForMemo(memo.id)) return; // dedupe re-deliveries of the same memo

      await storage.insert({
        memoId: memo.id,
        memoName: memo.name,
        excerpt: outcome.excerpt,
        chatTarget: notifier.resolveTarget(memo.creatorId ?? undefined),
        createdAt: now,
        nextRemindAt: outcome.nextRemindAt,
        recurrence: outcome.recurrence,
        status: "active",
      });
    },
  });
  const server = startServer(app, config.server.port);
  console.log(`memonudge: listening on :${config.server.port}`);

  const scheduler = startScheduler(config, storage, notifier);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`memonudge: received ${signal}, shutting down…`);
    scheduler.stop();
    void notifier.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref(); // backstop if a connection never drains
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
