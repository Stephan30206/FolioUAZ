CREATE TABLE `devoirs_cours` (
	`id` text PRIMARY KEY NOT NULL,
	`cours` text NOT NULL,
	`titre` text NOT NULL,
	`professeur` text NOT NULL,
	`echeance` text NOT NULL,
	`maximum` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `roles_uaz` (
	`email` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `devoirs` ADD `devoir_cours` text;