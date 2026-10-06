# Flexdesign

Appli de design de **Flex Suite** : thèmes (palette, polices) que chaque appli peut adopter si elle le veut, studio de visuels
(affiches, posts) et moodboards. Elle partage le projet Supabase des autres applis (Flexfolio, Flexform,
Flexstaff).

État actuel : socle seulement (connexion, rôles, sécurité). Les fonctionnalités prévues sont décrites
dans [PLAN.md](PLAN.md).

## Prérequis

- Node.js 22 ou plus
- Le dépôt `flexstaff` cloné à côté (dossier Flex Suite) : il contient **tout le SQL de la base**, les
  comptes de test et la base locale. Ce dépôt-ci ne contient aucun schéma.

## Droits

Flexdesign est inscrite dans `suite_apps` sous le nom `flexdesign` (migration
`20261005120000_flexdesign.sql` de flexstaff). Un compte entre s'il a le rôle `admin` ou `staff` pour
`flexdesign` dans `app_roles`, ou s'il est super admin de la suite. Les rôles se donnent depuis Flexstaff
ou avec `npm run role -- prenom.nom@exemple.fr flexdesign staff` dans flexstaff.

Le rôle est relu dans la base à chaque requête (fonction `suite_app_role`, avec le jeton du compte) : un
rôle retiré coupe l'accès aussitôt. Un compte sans rôle est refusé à la connexion, sans cookie. La clé
`service_role` ne sert qu'à limiter les tentatives de connexion.

## Variables d'environnement

Dans `.env` (jamais versionné) :

| Variable | Rôle |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Projet Supabase (les noms `NEXT_PUBLIC_*` marchent aussi) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé serveur : limite de tentatives de connexion uniquement |
| `TEST_*` | Comptes de test de flexstaff, pour `scripts/e2e.mjs` uniquement |

En local, le `.env` de flexstaff convient tel quel.

## Lancer

Base locale démarrée dans flexstaff (`npm run db:start`, Docker Desktop doit tourner), migrations
appliquées (`npm run db:reset` si la base existait déjà avant la migration Flexdesign), puis :

```bash
npm install
npm run dev
```

Ouvre http://localhost:8788. `npm run build` puis `npm start` pour la version de production (même port).
`npm run lint` vérifie le code.

## Tester

Avec l'appli lancée et la base locale :

```bash
node --env-file=.env scripts/e2e.mjs http://localhost:8788
```

`scripts/e2e.mjs` vérifie la connexion et les cas refusés (visiteur, mauvais mot de passe, admins des
autres applis sans rôle Flexdesign, rôle retiré en cours de session). Il refuse de tourner sur une autre
base que la base locale. Il donne puis retire un rôle `flexdesign` au compte `TEST_STAFF_EMAIL`.

## Structure

- `src/app/api/<route>/route.ts` : routes de l'API, enveloppées dans `route()` de `src/lib/server/http.ts`
- `src/lib/server/` : sessions et rôles (`http.ts`), client REST Supabase (`supabase.ts`)
- `src/lib/shared/types.ts` : contrat entre l'API et l'interface
- `src/components/` : interface (une appli client par page)
- `src/proxy.ts` : Content-Security-Policy avec nonce par requête
