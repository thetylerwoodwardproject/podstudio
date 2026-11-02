CREATE TABLE `library_items` (
	`id` text PRIMARY KEY NOT NULL,
	`show_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'music' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`filename` text,
	`original_asset_id` text,
	`asset_id` text,
	`duration_s` real,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_until` integer,
	`cancel_requested` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `library_items_show_idx` ON `library_items` (`show_id`);