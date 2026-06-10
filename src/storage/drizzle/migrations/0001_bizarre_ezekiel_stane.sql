CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminders_active_memo_id` ON `reminders` (`memo_id`) WHERE "reminders"."status" = 'active';