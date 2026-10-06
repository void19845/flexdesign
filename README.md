# Flexdesign

Appli de design de **Flex Suite** : thèmes (palette, polices) que chaque appli peut adopter si elle le veut, studio de visuels
(affiches, posts) et moodboards. Elle partage le projet Supabase des autres applis (Flexfolio, Flexform,
Flexstaff).

État actuel : socle (connexion, rôles, sécurité) et thèmes (couleurs, polices). Le studio et les moodboards
sont décrits dans [PLAN.md](PLAN.md).

## Prérequis

- Node.js 22 ou plus
- Le dépôt `flexstaff` cloné à côté (dossier Flex Suite) : il contient **tout le SQL de la base**, les
  comptes de test et la base locale. Ce dépôt-ci ne contient aucun schéma.

## Droits

Flexdesign est inscrite dans `suite_apps` sous le nom `flexdesign` (`supabase/init.sql`). Un compte entre s'il a le rôle `admin` ou `staff` pour
`flexdesign` dans `app_roles`, ou s'il est super admin de la suite. Les rôles se donnent depuis Flexstaff
ou avec `npm run role -- prenom.nom@exemple.fr flexdesign staff` dans flexstaff.

Le rôle est relu dans la base à chaque requête (fonction `suite_app_role`, avec le jeton du compte) : un
rôle retiré coupe l'accès aussitôt. Un compte sans rôle est refusé à la connexion, sans cookie. La clé
`service_role` ne sert qu'à limiter les tentatives de connexion.

## Thèmes

Un thème regroupe :

- **12 couleurs de rôle** (`background`, `surface`, `text`, `muted`, `border`, `primary`, `onPrimary`, `accent`,
  `onAccent`, `success`, `warning`, `danger`), en clair et, si le thème a une variante sombre, en sombre ;
- jusqu'à **24 couleurs nommées** (une valeur pour les deux modes) ;
- des **nuances calculées** à chaque enregistrement, en hexadécimal : `<couleur>Hover` (survol) et
  `<couleur>Soft` (fond léger) pour `primary`, `accent`, `success`, `warning`, `danger` ;
- une **police par rôle** (`heading`, `body`, `accent`, `mono`) avec sa police de secours.

Couleurs saisies en `#rgb` ou `#rrggbb`, stockées en `#rrggbb` minuscules (vérifié par le serveur et par la base).
L'éditeur affiche le contraste WCAG des paires texte / fond (4,5:1 pour le texte, 3:1 pour les gros titres) :
c'est une alerte, pas un blocage.

Polices : catalogue Google Fonts (via l'API publique Fontsource) ou fichiers envoyés par l'équipe (woff2, woff,
ttf, otf, 2 Mo maximum, type vérifié par les premiers octets, case « l'équipe détient la licence » obligatoire).
Les fichiers sont copiés dans le bucket public `design-fonts` de Supabase (sous-ensembles `latin` et `latin-ext`
pour le catalogue) : les navigateurs ne contactent jamais Google. Le nom de famille CSS d'une police envoyée est
généré (`Flexdesign xxxxxxxx`), jamais le texte saisi. Une police utilisée par un thème ne peut pas être supprimée.

Droits (`supabase/init.sql`) : tout le monde lit les thèmes et les
polices, y compris sans compte ; seuls les admins Flexdesign (et super admins) les modifient. Le staff voit les
thèmes en lecture seule.

### Lire un thème depuis une autre appli

Une appli qui se lie à un thème (réglage d'admin dans sa propre base, désactivé par défaut) le lit avec la clé
anon, par l'API REST de Supabase :

```
GET /rest/v1/design_themes?id=eq.<id>&select=name,has_dark,design_theme_colors(mode,kind,name,hex),design_theme_fonts(role,fallback,design_fonts(family,design_font_files(weight,style,unicode_range,format,path)))
```

Fichiers : `<SUPABASE_URL>/storage/v1/object/public/design-fonts/<path>` (l'appli ajoute l'hôte Supabase à son
`font-src`). L'appli revérifie chaque couleur (`^#[0-9a-f]{6}$`) et chaque nom de famille avant de les mettre
dans du CSS, et garde sa propre apparence si le thème est absent ou injoignable.

## Variables d'environnement

Dans `.env` (jamais versionné) :

| Variable | Rôle |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Projet Supabase (les noms `NEXT_PUBLIC_*` marchent aussi) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé serveur : limite de tentatives de connexion uniquement |
| `NEXT_PUBLIC_SUPABASE_URL` | Facultatif : adresse de Supabase vue par les navigateurs, si elle diffère de `SUPABASE_URL` (adresses des polices, CSP `font-src`) |
| `TEST_*` | Comptes de test de flexstaff, pour `scripts/e2e.mjs` uniquement |

En local, le `.env` de flexstaff convient tel quel.

## Lancer

Base locale démarrée dans flexstaff (`npm run db:start`, Docker Desktop doit tourner), schéma
à jour (`npm run db:setup` dans flexstaff applique à la base en place `supabase/init.sql` de flexstaff puis celui de
chaque appli, dont ce dépôt), puis :

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
autres applis sans rôle Flexdesign, rôle retiré en cours de session), puis les thèmes et les polices : écriture
refusée au staff et aux visiteurs (par l'API et directement dans la base avec leur jeton), valeurs invalides,
fichiers refusés (type, taille, licence non cochée), police utilisée par un thème. La copie depuis le catalogue
demande un accès à Internet (sinon elle est sautée). Il refuse de tourner sur une autre
base que la base locale. Il donne puis retire un rôle `flexdesign` au compte `TEST_STAFF_EMAIL`.

## Structure

- `src/app/api/<route>/route.ts` : routes de l'API, enveloppées dans `route()` de `src/lib/server/http.ts`
- `src/lib/server/` : sessions et rôles (`http.ts`), client REST et Storage Supabase (`supabase.ts`), thèmes
  (`themes.ts`), polices et catalogue Fontsource (`fonts.ts`)
- `src/lib/shared/color.ts` : format des couleurs, contraste WCAG, nuances calculées (serveur et interface)
- `src/lib/shared/types.ts` : contrat entre l'API et l'interface
- `src/components/` : interface (une appli client par page)
- `src/proxy.ts` : Content-Security-Policy avec nonce par requête
