CREATE TABLE `episode_people` (
	`episode_id` text NOT NULL,
	`person_id` text NOT NULL,
	`role` text,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`show_id` text NOT NULL,
	`guid` text NOT NULL,
	`guid_is_permalink` integer,
	`number` integer,
	`season` integer,
	`title` text NOT NULL,
	`subtitle` text,
	`slug` text NOT NULL,
	`public_id` text NOT NULL,
	`status` text DEFAULT 'recording' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`description` text,
	`explicit` integer DEFAULT 0 NOT NULL,
	`publish_at` integer,
	`duration_s` integer,
	`has_video` integer DEFAULT 0 NOT NULL,
	`artwork_url` text,
	`branding` text,
	`created_at` integer DEFAULT (unixepoch('now','subsec')*1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now','subsec')*1000) NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_public_id_unique` ON `episodes` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_show_guid_unique` ON `episodes` (`show_id`,`guid`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`show_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text,
	`avatar` text,
	`website` text,
	`socials` text,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shows` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`podcast_guid` text NOT NULL,
	`feed_url` text,
	`locked` integer DEFAULT 0 NOT NULL,
	`unlocked_until` integer,
	`website` text,
	`owner_email` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`settings` text,
	`theme` text,
	`short_style` text,
	`created_at` integer DEFAULT (unixepoch('now','subsec')*1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shows_slug_unique` ON `shows` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `shows_podcast_guid_unique` ON `shows` (`podcast_guid`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_verified_at` integer,
	`name` text NOT NULL,
	`role` text DEFAULT 'editor' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now','subsec')*1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);