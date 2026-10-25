CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`show_id` text NOT NULL,
	`episode_id` text,
	`kind` text NOT NULL,
	`access` text NOT NULL,
	`storage_target_id` text NOT NULL,
	`key` text NOT NULL,
	`filename` text,
	`content_type` text NOT NULL,
	`bytes` integer,
	`sha256` text,
	`duration_s` integer,
	`sample_rate` integer,
	`channels` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`meta` text,
	`created_at` integer NOT NULL,
	`verified_at` integer,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`storage_target_id`) REFERENCES `storage_targets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `assets_episode_idx` ON `assets` (`episode_id`);--> statement-breakpoint
ALTER TABLE `episodes` ADD `audio_asset_id` text;