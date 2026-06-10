// Channel-agnostic notifier contract. Action semantics live in core, never here.

export interface ReminderView {
  reminderId: number;
  excerpt: string;
  actions: { id: string; label: string; type: string; url?: string }[];
}

export interface NotifierHandlers {
  onAction(reminderId: number, actionId: string): Promise<void>;
  // Reports that a delivered message was acted on, so the app can schedule its later cleanup.
  // The notifier just emits the event; retention policy lives in the app, not here.
  onHandled?(target: string, messageId: number): Promise<void>;
}

export interface Notifier {
  readonly name: string;
  start(handlers: NotifierHandlers): Promise<void>;
  // batch > 1 is a digest. Resolves to the reminderIds actually delivered, so the caller can
  // reschedule only those and retry the rest (partial-failure safe).
  notify(target: string, batch: ReminderView[]): Promise<number[]>;
  resolveTarget(memoCreatorId?: number): string;
  // Optional capability: remove a previously sent message (a one-way channel like ntfy can't).
  deleteMessage?(target: string, messageId: number): Promise<void>;
}

// Optional capability (Telegram implements it; a one-way channel like ntfy wouldn't).
export interface InteractiveNotifier extends Notifier {
  registerQueries(q: {
    listActive(target: string): Promise<ReminderView[]>;
    sampleView?(): ReminderView; // a demo reminder for /test, so the user sees the real format
  }): void;
}
