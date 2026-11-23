# Folio UAZ en local

Code source du site Folio UAZ dans son thème prune, issu de la révision 47589fe.
L’archive contient l’interface React et TypeScript, l’API Node.js, les migrations SQLite et les ressources de lecture des documents.

## Démarrage sous Windows

1. Installez Node.js 24 LTS et vérifiez avec `node --version`.
2. Décompressez l’archive et ouvrez le dossier `Folio-UAZ` dans VS Code.
3. Ouvrez un terminal **Invite de commandes (cmd)** dans ce dossier et lancez ces commandes.

```bat
npm ci
npm run build
npm run dev
```

Ouvrez http://localhost:5173 et laissez le terminal tourner. Après une modification du code, relancez `npm run build` puis rechargez la page.

## Premiers essais

Le serveur local ouvre directement un compte de démonstration du centre. Il écoute uniquement sur cet ordinateur. Les dépôts et le corpus local sont stockés dans `.sites-runtime/local` sur cette machine. L’installation des dépendances et le premier chargement d’un modèle sémantique demandent une connexion Internet. L’archive contient le code et les ressources suivis dans Git. Les comptes et documents du site hébergé restent dans le service en ligne.
