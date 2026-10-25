CREATE TABLE `recording_chunks` (
	`recording_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`first_sample` integer NOT NULL,
	`sample_count` integer NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`key` text NOT NULL,
	`storage_target_id` text NOT NULL,
	`verified_at` integer NOT NULL,
	PRIMARY KEY(`recording_id`, `sequence`),
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`show_id` text NOT NULL,
	`episode_id` text NOT NULL,
	`status` text DEFAULT 'recording' NOT NULL,
	`sample_rate` integer NOT NULL,
	`channels` integer DEFAULT 1 NOT NULL,
	`bit_depth` integer DEFAULT 24 NOT NULL,
	`device` text,
	`annotations` text,
	`report` text,
	`total_samples` integer,
	`final_asset_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`finalized_at` integer,
	`error` text,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recordings_episode_idx` ON `recordings` (`episode_id`);--> statement-breakpoint
ALTER TABLE `episodes` ADD `script` text;