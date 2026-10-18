ALTER TABLE `shows` ADD `description` text;--> statement-breakpoint
ALTER TABLE `shows` ADD `language` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE `shows` ADD `explicit` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `shows` ADD `podcast_tags` text;