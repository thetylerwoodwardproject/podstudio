CREATE TABLE `storage_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`endpoint` text,
	`bucket` text NOT NULL,
	`region` text,
	`access_key_id` text NOT NULL,
	`secret_access_key` text NOT NULL,
	`routes` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now','subsec')*1000) NOT NULL
);
