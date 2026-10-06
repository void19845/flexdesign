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

/**
 * Autres routes :
 *   POST   /api/auth/logout        { ok: true }
 *   POST   /api/themes             ThemeInput -> Theme (admin)
 *   DELETE /api/themes             { id } -> { ok: true } (admin)
 *   DELETE /api/fonts              { id } -> { ok: true } (admin ; refusé si un thème l'utilise)
 *   POST   /api/fonts/catalog      { id, weights: number[], italic: boolean } -> Font (admin)
 *   POST   /api/fonts/upload       multipart : file, weight, style, license, label (nouvelle police)
 *                                  ou fontId (ajout à une police envoyée) -> Font (admin)
 * Erreurs : { error: string } avec le code HTTP (400, 401 non connecté, 403 droits, 404, 409, 413, 429).
 */
export const MAX_EMAIL_LENGTH = 254;
