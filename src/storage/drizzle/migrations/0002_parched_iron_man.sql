CREATE TABLE `pending_deletions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_target` text NOT NULL,
	`message_id` integer NOT NULL,
	`delete_after` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pending_deletions_delete_after` ON `pending_deletions` (`delete_after`);