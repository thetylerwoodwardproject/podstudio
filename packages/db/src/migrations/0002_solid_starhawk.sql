CREATE TABLE `show_txt_records` (
	`id` text PRIMARY KEY NOT NULL,
	`show_id` text NOT NULL,
	`purpose` text,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now','subsec')*1000) NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `show_txt_records_show_idx` ON `show_txt_records` (`show_id`);