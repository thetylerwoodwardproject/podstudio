CREATE TABLE `podroll_items` (
	`id` text PRIMARY KEY NOT NULL,
	`show_id` text NOT NULL,
	`feed_guid` text NOT NULL,
	`feed_url` text,
	`title` text NOT NULL,
	`author` text,
	`artwork` text,
	`note` text,
	`position` integer NOT NULL,
	`verified_at` integer,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `podroll_items_show_idx` ON `podroll_items` (`show_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `podroll_items_show_guid_unique` ON `podroll_items` (`show_id`,`feed_guid`);