CREATE TABLE `devoirs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`dossier` text NOT NULL,
	`version` integer NOT NULL,
	`parent` text,
	`titre` text NOT NULL,
	`etudiant` text NOT NULL,
	`professeur` text NOT NULL,
	`fichier` text NOT NULL,
	`taille` integer NOT NULL,
	`objet` text NOT NULL,
	`etat` text NOT NULL,
	`score` real,
	`mots` integer NOT NULL,
	`communs` integer NOT NULL,
	`cree` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `version_dossier` ON `devoirs` (`owner`,`dossier`,`version`);--> statement-breakpoint
CREATE INDEX `file_devoirs` ON `devoirs` (`owner`,`cree`);--> statement-breakpoint
CREATE TABLE `journal` (
	`id` text PRIMARY KEY NOT NULL,
	`devoir` text NOT NULL,
	`date` text NOT NULL,
	`action` text NOT NULL,
	`acteur` text NOT NULL,
	`motif` text NOT NULL,
	FOREIGN KEY (`devoir`) REFERENCES `devoirs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `journal_devoir` ON `journal` (`devoir`,`date`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`titre` text NOT NULL,
	`fichier` text NOT NULL,
	`mots` integer NOT NULL,
	`objet` text NOT NULL,
	`cree` text NOT NULL,
	`dossier` text,
	`devoir` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_devoir` ON `sources` (`owner`,`devoir`);--> statement-breakpoint
CREATE INDEX `mes_sources` ON `sources` (`owner`,`cree`);