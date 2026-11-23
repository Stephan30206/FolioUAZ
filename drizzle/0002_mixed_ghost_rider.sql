CREATE TABLE `configuration` (
	`cle` text PRIMARY KEY NOT NULL,
	`valeur` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `journal` ADD `conseil` text DEFAULT '' NOT NULL;