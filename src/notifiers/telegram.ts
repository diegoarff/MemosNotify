import { Bot, InlineKeyboard } from "grammy";
import type { InteractiveNotifier, NotifierHandlers, ReminderView } from "./interface.ts";

export interface TelegramOptions {
  botToken: string;
  defaultChatId: string;
  chatRouting?: { memosCreatorId: number; chatId: string }[] | undefined;
}

// callback_data is "<reminderId>:<actionId>" — Telegram caps it at 64 bytes.
export function formatCallbackData(reminderId: number, actionId: string): string {
  return `${reminderId}:${actionId}`;
}

export function parseCallbackData(data: string): { reminderId: number; actionId: string } | null {
  const idx = data.indexOf(":");
  if (idx < 0) return null;
  const reminderId = Number(data.slice(0, idx));
  const actionId = data.slice(idx + 1);
  if (!Number.isInteger(reminderId) || actionId.length === 0) return null;
  return { reminderId, actionId };
}

// No parse_mode, so an excerpt can contain any characters without needing escaping.
export function buildMessageText(view: ReminderView): string {
  const body = view.excerpt.trim() || "(no preview)";
  return `🔔 ${body}`;
}

export function buildKeyboard(view: ReminderView): InlineKeyboard {
  const kb = new InlineKeyboard();
  // Drop open_url buttons with no resolved URL — they'd render as dead callbacks that still report "Done ✓".
  const renderable = view.actions.filter((a) => a.type !== "open_url" || Boolean(a.url));
  renderable.forEach((a, i) => {
    if (i > 0 && i % 2 === 0) kb.row(); // 2 buttons per row keeps labels readable
    if (a.type === "open_url" && a.url) {
      kb.url(a.label, a.url);
    } else {
      kb.text(a.label, formatCallbackData(view.reminderId, a.id));
    }
  });
  return kb;
}

// grammY long-polling notifier: outbound only, no public endpoint.
export class TelegramNotifier implements InteractiveNotifier {
  readonly name = "telegram";
  private readonly bot: Bot;
  private listActive?: (target: string) => Promise<ReminderView[]>;
  private sampleView?: (() => ReminderView) | undefined;
  private stopping = false;

  constructor(private readonly opts: TelegramOptions) {
    this.bot = new Bot(opts.botToken);
  }

  registerQueries(q: {
    listActive(target: string): Promise<ReminderView[]>;
    sampleView?(): ReminderView;
  }): void {
    this.listActive = q.listActive;
    this.sampleView = q.sampleView;
  }

  async start(handlers: NotifierHandlers): Promise<void> {
    this.bot.on("callback_query:data", async (ctx) => {
      const parsed = parseCallbackData(ctx.callbackQuery.data);
      if (!parsed) {
        await ctx.answerCallbackQuery();
        return;
      }
      try {
        await handlers.onAction(parsed.reminderId, parsed.actionId);
        await ctx.answerCallbackQuery({ text: "Done ✓" });
        // Remove the keyboard so the resolved buttons can't be re-tapped (which would re-run
        // snooze/webhook/etc.); Telegram keeps the existing markup unless reply_markup is sent, so
        // editing the text alone is not enough — pass an empty keyboard.
        const original = ctx.callbackQuery.message?.text;
        if (original) {
          await ctx
            .editMessageText(`${original}\n\n✓ handled`, { reply_markup: { inline_keyboard: [] } })
            .catch(() => {});
        } else {
          await ctx.editMessageReplyMarkup().catch(() => {});
        }
      } catch (err) {
        await ctx.answerCallbackQuery({ text: "Failed — check logs" });
        console.error("telegram action failed:", err);
      }
    });

    this.bot.command("pending", async (ctx) => {
      const target = String(ctx.chat.id);
      const active = (await this.listActive?.(target)) ?? [];
      if (active.length === 0) {
        await ctx.reply("No pending reminders. 🎉");
        return;
      }
      await ctx.reply(`You have ${active.length} pending reminder(s):`);
      for (const view of active) {
        await ctx.reply(buildMessageText(view), { reply_markup: buildKeyboard(view) });
      }
    });

    this.bot.command("test", async (ctx) => {
      await ctx.reply(`✅ MemoNudge connected.\nThis chat id is: ${ctx.chat.id}`);
      // Fire a sample reminder so the user sees a real nudge + its buttons.
      const sample = this.sampleView?.();
      if (sample) {
        await ctx.reply(buildMessageText(sample), { reply_markup: buildKeyboard(sample) });
      }
    });

    this.bot.catch((err) => {
      console.error("telegram bot error:", err.error);
    });

    // bot.start() only resolves once the bot stops, so init() first to fail fast on a
    // bad token, then leave polling running in the background.
    await this.bot.init();
    void this.bot
      .start({ onStart: (me) => console.log(`telegram: @${me.username} long polling started`) })
      .then(() => this.onPollingEnded())
      .catch((err: unknown) => this.onPollingEnded(err));
  }

  // Long polling is the sole delivery path, so a silent death leaves the app "up" but broken.
  // Exit non-zero (unless we asked it to stop) so the container restart policy revives it.
  private onPollingEnded(err?: unknown): void {
    if (this.stopping) return;
    if (err) console.error("telegram polling crashed:", err);
    else console.error("telegram polling stopped unexpectedly");
    console.error("exiting so the supervisor can restart the bot");
    process.exit(1);
  }

  async notify(target: string, batch: ReminderView[]): Promise<number[]> {
    if (batch.length === 0) return [];
    // A digest gets a header line; either way each reminder is its own message so it keeps its buttons.
    if (batch.length > 1) {
      // Best-effort header: a failed header must not drop the reminders that follow.
      await this.bot.api
        .sendMessage(target, `🔔 You have ${batch.length} reminders due:`)
        .catch((err: unknown) => console.error("telegram digest header failed:", err));
    }
    // Send each reminder independently and report which succeeded, so the scheduler retries only failures.
    const delivered: number[] = [];
    for (const view of batch) {
      try {
        await this.bot.api.sendMessage(target, buildMessageText(view), {
          reply_markup: buildKeyboard(view),
        });
        delivered.push(view.reminderId);
      } catch (err) {
        console.error(`telegram send failed for reminder ${view.reminderId}:`, err);
      }
    }
    return delivered;
  }

  resolveTarget(memoCreatorId?: number): string {
    const route = this.opts.chatRouting?.find((r) => r.memosCreatorId === memoCreatorId);
    return route?.chatId ?? this.opts.defaultChatId;
  }

  async stop(): Promise<void> {
    this.stopping = true; // so onPollingEnded() treats the resulting start() resolution as graceful
    await this.bot.stop();
  }
}
