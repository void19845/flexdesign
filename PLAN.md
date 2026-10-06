# Plan de Flexdesign

Trois outils, livrés dans cet ordre : thèmes, moodboards, studio. La demande de visuels (« design request
board ») ne fait pas partie de Flexdesign : elle passe par un sondage Flexform.

Principe : chaque appli de la suite fonctionne seule, avec sa propre apparence. Flexdesign est un plus,
jamais une dépendance : une appli qui ne s'y lie pas, ou dont le lien échoue (Flexdesign absente, thème
supprimé, base injoignable), garde son apparence à elle. Flexdesign ne dépend d'aucune autre appli non plus.

## 0. Socle (fait)

- Appli Next.js 16 sur le modèle de Flexform / Flexstaff : route handlers, client REST Supabase sans
  dépendance, CSS global, CSP avec nonce, port 8788.
- Inscription `flexdesign` dans `suite_apps` (migration flexstaff) : admins et staff gérés dans Flexstaff.
- Connexion réservée aux rôles `admin` / `staff` de Flexdesign, relus à chaque requête.
- Tests : `scripts/e2e.mjs` (connexion, refus) et deux vérifications dans `npm run test:rls` de flexstaff.

## 1. Thèmes

But : des thèmes riches (couleurs, polices) que chaque appli **peut** adopter. Plusieurs thèmes : chaque
appli liée choisit le sien.

- **Couleurs** : rôles fixes que les applis savent utiliser (`background`, `surface`, `text`, `muted`,
  `border`, `primary`, `onPrimary`, `accent`, `onAccent`, `success`, `warning`, `danger`), plus jusqu'à
  ~24 couleurs nommées libres. Variante sombre facultative (mêmes rôles, sinon la claire s'applique).
  Saisie `#rgb` ou `#rrggbb`, stockage `#rrggbb` en minuscules uniquement (regex côté serveur + `CHECK`
  en base ; chaque appli revérifie à la lecture). Nuances dérivées (survol, fond léger) calculées par
  Flexdesign et publiées en hexadécimal, pas en `color-mix()`, pour servir aussi au canvas et au PDF.
- **Contraste** : formule WCAG 2.x en ~10 lignes, sans dépendance. Alerte sous 4,5:1 (3:1 pour les gros
  titres) sur texte/fond, texte/surface, onPrimary/primary, onAccent/accent, muted/fond.
- **Polices** : catalogue Google Fonts complet (~2 000 familles, toutes sous licence libre OFL / Apache /
  UFL) lu côté serveur depuis l'API Fontsource (sans clé). Rôles : titre, texte, accent, chasse fixe.
  Les fichiers woff2 choisis sont copiés une fois dans un bucket Storage public `design-fonts` : aucun
  appel à Google depuis le navigateur des visiteurs (une décision allemande de 2022 juge ce transfert
  d'IP contraire au RGPD). Une appli liée ajoute l'hôte Supabase à son `font-src` ; si le fichier ne
  charge pas, sa police de secours s'applique.
- **Polices envoyées par l'équipe** (woff2 / ttf / otf), dès la première version : taille plafonnée (~2 Mo), type vérifié par
  les premiers octets, nom de fichier et nom de famille générés (jamais le texte saisi), case
  obligatoire « je détiens la licence » (les polices commerciales interdisent souvent l'usage web ou PDF).
- tables `design_themes`, `design_theme_colors`, `design_theme_fonts`, `design_fonts` (catalogue copié
  et polices envoyées), lisibles par tous (anon, pour les applis qui s'y lient), modifiables par les
  admins Flexdesign.
- éditeur dans Flexdesign avec aperçu ; aucune valeur brute (`url()`, `@import`) ne passe dans du CSS.
- dans chaque appli, plus tard et dans son propre dépôt : un réglage d'admin « lier à un thème
  Flexdesign » (désactivé par défaut). Le réglage vit dans les tables de l'appli ; Flexdesign n'écrit
  jamais chez les autres, et les autres ne font que lire les thèmes.

État des liens existants :

- **Flexform ne se lie plus à Flexfolio** (retrait en cours : code Flexform + migration flexstaff qui
  supprime `sondage_settings.theme_linked`). Flexform garde son thème BDE, puis pourra se lier à un
  thème Flexdesign.
- Flexfolio garde son propre éditeur de palette et de polices (`site_settings`), inchangé.

## 2. Moodboards

But : rassembler des images de référence. Chaque moodboard est **personnel** et peut être partagé.

- tables `design_boards` (titre, description, propriétaire) et `design_board_items` (tableau, image,
  note, position ; `on delete cascade` vers le tableau) ;
- partage, au choix du propriétaire, cumulable :
  - avec des membres choisis de l'équipe Flexdesign, en lecture ou en modification
    (table `design_board_members`) ;
  - avec toute l'équipe Flexdesign, en lecture (un interrupteur sur le tableau) ;
  - par lien public en lecture seule, sans compte : jeton secret aléatoire, révocable et
    régénérable, page publique non indexée ;
- bucket Storage privé `design-assets`, règles sur `storage.objects` qui suivent les droits du tableau.
  Pour le lien public, le serveur vérifie le jeton dans la base puis sert des URL signées de courte durée ;
- images envoyées dans le bucket uniquement : pas d'images externes, pour garder la CSP stricte.

Ce volet pose le circuit d'envoi d'images (taille, type, nom de fichier) réutilisé par le studio.

## 3. Studio de visuels

But : produire des visuels à partir de modèles. **A4 d'abord**, export **PDF** en un clic.

- table `design_templates` : format (A4 d'abord ; post carré, story plus tard), calques (texte, image,
  forme) en `jsonb` validé côté serveur, couleurs et polices prises dans un thème ou saisies à la main ;
- table `design_visuals` : un visuel rempli à partir d'un modèle (textes, images du bucket) ;
- rendu dans le navigateur sur un `<canvas>` A4 à 300 dpi (2480 x 3508) ;
- export PDF généré dans le navigateur et téléchargé en un clic (`Blob` + lien `download`, aucun
  changement de CSP ; pas d'aperçu PDF dans une iframe) ;
- générateur PDF maison, sans dépendance (~60 lignes) : une page A4 qui contient l'image JPEG du canvas.
  Fichier de 1 à 3 Mo, rendu identique à l'écran, texte non sélectionnable. Si le texte sélectionnable ou
  le multipage deviennent nécessaires : `@cantoo/pdf-lib` + `@pdf-lib/fontkit` (le `pdf-lib` d'origine
  n'est plus maintenu depuis 2021) ;
- une étape `ensureFonts` charge chaque police (graisse, style) avec `document.fonts.load` et vérifie le
  résultat avant de dessiner : un canvas ne se redessine jamais tout seul ;
- images du bucket : servies par une route `/api` du même site, sinon le canvas est « teinté » et
  l'export échoue ; SVG refusés à l'envoi (un SVG peut contenir du script) ;
- limites : pas de CMYK ni de PDF/X, que certains imprimeurs exigent.

## Droits (validés)

| Action | admin | staff | visiteur |
|---|---|---|---|
| Lire les thèmes | oui | oui | oui (lecture publique, pour les applis qui s'y lient) |
| Modifier les thèmes | oui | non | non |
| Créer / modifier les modèles du studio | oui | non | non |
| Créer des visuels à partir des modèles | oui | oui | non |
| Moodboards : créer, modifier les siens, les partager | oui | oui | non |
| Moodboards partagés avec soi : lire, ou modifier si le propriétaire l'a permis | oui | oui | non |
| Moodboard par lien public : lire | oui | oui | oui, avec le lien |
| Moodboard privé ou non partagé avec soi : voir, modifier, supprimer | non | non | non |

Un moodboard n'est visible que par son propriétaire et ceux avec qui il l'a partagé : être admin de
Flexdesign (ou super admin de la suite) ne donne aucun accès aux moodboards des autres.

Chaque règle arrive avec sa migration dans flexstaff et au moins un cas refusé dans `npm run test:rls`.

## Questions ouvertes

Aucune pour l'instant : le plan est validé. Prochaine étape, le volet 1 (thèmes).
