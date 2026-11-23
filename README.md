# Folio UAZ

Plateforme de relecture des devoirs de l’Université Adventiste Zurcher. Java 17, Spring Boot, PostgreSQL et React TypeScript. Les comptes, cours, devoirs et le corpus sont saisis par l’Université. Flyway crée le schéma au premier démarrage.

## Démarrage sous Windows

Prérequis pour démarrer l’archive : **JDK 17**, **Maven 3.9** et **PostgreSQL**. Le ZIP inclut une compilation de l’interface dans `frontend/dist`. Spring Boot sert ces fichiers avec l’API. Node.js est seulement nécessaire pour recompiler le frontend.

1. Dans pgAdmin, créez un rôle PostgreSQL avec connexion et mot de passe puis la base `folio_uaz` avec ce rôle comme propriétaire. Vous pouvez définir un autre nom de base via l’URL JDBC.
2. Ouvrez PowerShell dans le dossier du projet. Remplacez les valeurs entre chevrons par vos valeurs réelles.

```powershell
$env:FOLIO_DB_URL = "jdbc:postgresql://localhost:5432/folio_uaz"
$env:FOLIO_DB_USER = "<rôle PostgreSQL>"
$env:FOLIO_DB_PASSWORD = "<mot de passe PostgreSQL>"
$env:FOLIO_ADMIN_EMAIL = "<adresse réelle du premier administrateur>"
$env:FOLIO_ADMIN_PASSWORD = "<mot de passe administrateur de 12 caractères minimum>"
$env:FOLIO_ADMIN_NOM = "<nom de l’administrateur>"
cd backend
mvn package
java -jar target/folio-1.0.0.jar
```

Ouvrez http://localhost:8080. Le premier compte est créé si la table des comptes est vide. Retirez les variables `FOLIO_ADMIN_*` de la configuration après cette initialisation. Si vous hébergez l’application derrière HTTPS, activez `FOLIO_SECURE_COOKIE=true`.

## Préparer un vrai parcours

1. Dans **Administration**, créez les comptes du professeur, du relecteur et des étudiants.
2. Créez un devoir et son cours, associez le professeur, puis inscrivez les étudiants.
3. Dans **Sources de référence**, importez les fichiers autorisés avant le premier dépôt.
4. L’étudiant choisit son devoir et dépose un PDF textuel, un DOCX ou un TXT. Le relecteur examine le rapport et motive sa décision. Après transmission, le professeur désigné accède à la version validée en lecture seule.

L’application compare des séquences exactes de mots. Elle normalise la casse et les accents et compte une seule fois les mots communs entre plusieurs sources. Une analyse sans corpus ni texte exploitable ne génère pas un score nul artificiel. Les PDF scannés doivent être traités par OCR avant dépôt si aucun texte n’en est extrait. La version ne comprend pas de score IA. La conservation configurée reste indicative et ne déclenche aucune suppression automatique. Les originaux sont stockés en PostgreSQL. Les anciens comptes et documents de la version en ligne ne sont pas importés par cette installation.

## Modifier l’interface

Avec Node.js 22.12+ ou 24 installé, exécutez `npm ci` puis `npm run build` dans `frontend`. Relancez ensuite `mvn package` dans `backend` pour incorporer la nouvelle interface. En développement, `npm run dev` sur le frontend Vite redirige les requêtes API vers Spring Boot sur le port 8080.
