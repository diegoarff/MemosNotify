CREATE TABLE `reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`memo_id` text NOT NULL,
	`memo_name` text,
	`excerpt` text,
	`chat_target` text NOT NULL,
	`created_at` integer NOT NULL,
	`next_remind_at` integer NOT NULL,
	`recurrence` text,
	`status` text DEFAULT 'active' NOT NULL
);
