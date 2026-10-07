/**
 * Contrat entre l'API de Flexdesign (src/app/api) et l'interface (src/components).
 * Les droits sont ceux de la suite (app_roles, appli 'flexdesign') : voir supabase/init.sql de flexstaff et de ce dépôt.
 */

/** Rôle dans Flexdesign (un super admin de la suite est admin) */
export type Role = "admin" | "staff";

/** GET /api/auth/me et réponse de POST /api/auth/login */
export interface Me {
  email: string;
  role: Role;
}

// --- Thèmes ------------------------------------------------------------------

/** Rôles de couleur fixes, que les applis liées savent utiliser (même liste que la contrainte en base) */
export const COLOR_ROLES = ["background", "surface", "text", "muted", "border", "primary", "onPrimary", "accent", "onAccent", "success", "warning", "danger"] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];
export type Palette = Record<ColorRole, string>;

/** Couleurs qui reçoivent des nuances calculées : <couleur>Hover (survol) et <couleur>Soft (fond léger) */
export const SHADED_ROLES = ["primary", "accent", "success", "warning", "danger"] as const;
export type ShadedRole = (typeof SHADED_ROLES)[number];
export type DerivedName = `${ShadedRole}${"Hover" | "Soft"}`;
export type DerivedPalette = Record<DerivedName, string>;

export const MAX_NAMED_COLORS = 24;
export const MAX_THEME_NAME_LENGTH = 60;
/** Nom d'une couleur nommée : minuscules, chiffres et tirets (ex. corail, bleu-nuit) */
export const NAMED_COLOR_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

export interface NamedColor {
  name: string;
  hex: string;
}

export const FONT_ROLES = ["heading", "body", "accent", "mono"] as const;
export type FontRole = (typeof FONT_ROLES)[number];
export const FALLBACKS = ["sans-serif", "serif", "monospace", "cursive", "system-ui"] as const;
export type Fallback = (typeof FALLBACKS)[number];

export interface ThemeFont {
  role: FontRole;
  fontId: string;
  fallback: Fallback;
}

/** Corps de POST /api/themes : sans id, crée un thème ; avec id, le remplace entièrement. */
export interface ThemeInput {
  id?: string;
  name: string;
  hasDark: boolean;
  light: Palette;
  /** Variante sombre : null si le thème n'en a pas (la claire s'applique) */
  dark: Palette | null;
  /** Une seule valeur pour les deux modes */
  named: NamedColor[];
  fonts: ThemeFont[];
}

/** Élément de GET /api/themes. Couleurs toujours en #rrggbb minuscules. */
export interface Theme extends ThemeInput {
  id: string;
  /** Nuances calculées par Flexdesign à chaque enregistrement */
  derived: { light: DerivedPalette; dark: DerivedPalette | null };
  updatedAt: string;
}

// --- Polices -----------------------------------------------------------------

export type FontStyle = "normal" | "italic";

export interface FontFile {
  weight: number;
  style: FontStyle;
  /** Sous-ensemble du catalogue (ex. latin) ; null pour une police envoyée */
  subset: string | null;
  unicodeRange: string | null;
  format: "woff2" | "woff" | "truetype" | "opentype";
  /** Adresse publique du fichier (bucket design-fonts) */
  url: string;
}

/** Élément de GET /api/fonts */
export interface Font {
  id: string;
  /** Nom de famille CSS (généré pour une police envoyée) */
  family: string;
  /** Nom affiché */
  label: string;
  source: "catalog" | "upload";
  category: string;
  license: string;
  files: FontFile[];
}

/** Élément de GET /api/fonts/catalog?q= (catalogue Google Fonts, via Fontsource) */
export interface CatalogFont {
  id: string;
  family: string;
  category: string;
  license: string;
  weights: number[];
  italic: boolean;
}

/** Taille maximale d'un fichier de police (même limite que le bucket design-fonts) */
export const MAX_FONT_BYTES = 2 * 1024 * 1024;
export const MAX_FONT_LABEL_LENGTH = 80;

// --- Moodboards --------------------------------------------------------------

/** Accès du compte à un tableau : propriétaire, membre en modification, lecture (membre ou toute l'équipe) */
export type BoardAccess = "owner" | "edit" | "read";

export const MAX_BOARD_TITLE_LENGTH = 80;
export const MAX_BOARD_DESCRIPTION_LENGTH = 500;
export const MAX_NOTE_LENGTH = 500;
/** Taille maximale d'une image envoyée (même limite que le bucket design-assets) */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Côté le plus long d'une image après réduction dans le navigateur */
export const MAX_IMAGE_SIDE = 2560;
/** Toile d'un tableau, en pixels logiques : x de 0 à CANVAS_WIDTH, y de 0 à CANVAS_HEIGHT */
export const CANVAS_WIDTH = 6000;
export const CANVAS_HEIGHT = 4000;
/** Largeur affichée d'une image sur la toile ; la hauteur suit les proportions de l'image */
export const MIN_ITEM_WIDTH = 40;
export const MAX_ITEM_WIDTH = 4000;

/** Élément de GET /api/boards */
export interface BoardSummary {
  id: string;
  title: string;
  description: string;
  /** E-mail du propriétaire (null s'il n'est plus dans l'équipe) */
  ownerEmail: string | null;
  access: BoardAccess;
  teamRead: boolean;
  itemCount: number;
  updatedAt: string;
}

export interface BoardItem {
  id: string;
  /** Adresse de l'image sur le même site (route /api qui vérifie les droits) */
  url: string;
  widthPx: number;
  heightPx: number;
  x: number;
  y: number;
  w: number;
  z: number;
  note: string;
}

export interface BoardMember {
  userId: string;
  email: string | null;
  canEdit: boolean;
}

/** GET /api/boards/detail?id= */
export interface Board extends BoardSummary {
  items: BoardItem[];
  /** Propriétaire seulement (vide sinon) */
  members: BoardMember[];
  /** Jeton du lien public : propriétaire seulement, null sans lien */
  shareToken: string | null;
}

/** Élément de GET /api/team : équipe Flexdesign, pour choisir les membres d'un tableau */
export interface TeamMember {
  userId: string;
  email: string;
}

/** GET /api/public/board?token= (sans compte) */
export interface PublicBoard {
  title: string;
  description: string;
  items: BoardItem[];
}

/**
 * Autres routes :
 *   POST   /api/auth/logout        { ok: true }
 *   POST   /api/themes             ThemeInput -> Theme (admin)
 *   DELETE /api/themes             { id } -> { ok: true } (admin)
 *   DELETE /api/fonts              { id } -> { ok: true } (admin ; refusé si un thème l'utilise)
 *   POST   /api/fonts/catalog      { id, weights: number[], italic: boolean } -> Font (admin)
 *   POST   /api/fonts/upload       multipart : file, weight, style, license, label (nouvelle police)
 *                                  ou fontId (ajout à une police envoyée) -> Font (admin)
 * Moodboards (admin et staff ; les droits sur chaque tableau sont vérifiés par la base) :
 *   POST   /api/boards             { title, description } -> BoardSummary (le compte en est propriétaire)
 *   DELETE /api/boards             { id } -> { ok: true } (propriétaire)
 *   POST   /api/boards/settings    { id, title, description, teamRead } -> { ok: true } (propriétaire)
 *   POST   /api/boards/members     { boardId, userId, canEdit } -> BoardMember[] (propriétaire)
 *   DELETE /api/boards/members     { boardId, userId } -> BoardMember[] (propriétaire)
 *   POST   /api/boards/link        { boardId } -> { token } (propriétaire ; crée ou régénère le lien)
 *   DELETE /api/boards/link        { boardId } -> { ok: true } (propriétaire)
 *   POST   /api/boards/items       multipart : boardId, file, widthPx, heightPx, x, y, w -> BoardItem
 *   DELETE /api/boards/items       { id } -> { ok: true }
 *   POST   /api/boards/items/update { id, x?, y?, w?, z?, note? } -> BoardItem
 *   GET    /api/boards/image?id=   l'image (même site)
 *   GET    /api/public/image?token=&id=  image d'un tableau par lien public (sans compte)
 * Page publique : /m/<jeton> (lecture seule, non indexée).
 * Erreurs : { error: string } avec le code HTTP (400, 401 non connecté, 403 droits, 404, 409, 413, 429).
 */
export const MAX_EMAIL_LENGTH = 254;
