CREATE TABLE `show_links` (
	`id` text PRIMARY KEY NOT NULL,
	`show_id` text NOT NULL,
	`platform` text NOT NULL,
	`value` text NOT NULL,
	`visible` integer DEFAULT 1 NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `show_links_show_idx` ON `show_links` (`show_id`);