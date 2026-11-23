import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";
export const devoirs=sqliteTable("devoirs",{
 id:text().primaryKey(),owner:text().notNull(),dossier:text().notNull(),version:integer().notNull(),parent:text(),devoirCours:text("devoir_cours"),passages:integer(),signalIA:text("signal_ia"),
 titre:text().notNull(),etudiant:text().notNull(),professeur:text().notNull(),fichier:text().notNull(),taille:integer().notNull(),
 objet:text().notNull(),etat:text().notNull(),score:real(),mots:integer().notNull(),communs:integer().notNull(),cree:text().notNull()
},t=>[uniqueIndex("version_dossier").on(t.owner,t.dossier,t.version),index("file_devoirs").on(t.owner,t.cree)]);
export const sources=sqliteTable("sources",{
 id:text().primaryKey(), owner:text().notNull(), titre:text().notNull(),fichier:text().notNull(),mots:integer().notNull(),
 objet:text().notNull(),cree:text().notNull(),dossier:text(),devoir:text(),partage:integer().notNull().default(0)
},t=>[uniqueIndex("source_devoir").on(t.owner,t.devoir),index("mes_sources").on(t.owner,t.cree)]);
export const journal=sqliteTable("journal",{
 id:text().primaryKey(),devoir:text().notNull().references(()=>devoirs.id),date:text().notNull(),
 action:text().notNull(),acteur:text().notNull(),motif:text().notNull(),conseil:text().notNull().default("")
},t=>[index("journal_devoir").on(t.devoir,t.date)]);

export const configuration=sqliteTable("configuration",{cle:text().primaryKey(),valeur:text().notNull()});
export const devoirsCours=sqliteTable("devoirs_cours",{
 id:text().primaryKey(),cours:text().notNull(),titre:text().notNull(),professeur:text().notNull(),
 echeance:text().notNull(),maximum:integer().notNull()
});
export const rolesUaz=sqliteTable("roles_uaz",{email:text().primaryKey(),role:text().notNull()});
