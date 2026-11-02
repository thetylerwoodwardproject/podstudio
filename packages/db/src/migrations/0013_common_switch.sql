CREATE TABLE `render_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`project_revision_id` text NOT NULL,
	`revision_seq` integer NOT NULL,
	`kind` text NOT NULL,
	`settings` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`asset_id` text,
	`summary` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_until` integer,
	`cancel_requested` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `render_jobs_episode_idx` ON `render_jobs` (`episode_id`);--> statement-breakpoint
CREATE INDEX `render_jobs_status_idx` ON `render_jobs` (`status`);