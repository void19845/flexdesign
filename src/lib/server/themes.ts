import "server-only";

import { HttpError } from "./errors";
import { Db, DbError, eq } from "./supabase";
import { deriveShades, normalizeHex } from "@/lib/shared/color";
import {
  COLOR_ROLES,
  FALLBACKS,
  FONT_ROLES,
  MAX_NAMED_COLORS,
  MAX_THEME_NAME_LENGTH,
  NAMED_COLOR_PATTERN,
  type DerivedPalette,
  type Fallback,
  type FontRole,
  type NamedColor,
  type Palette,
  type Theme,
  type ThemeFont,
  type ThemeInput,
} from "@/lib/shared/types";

/**
 * Thèmes de Flexdesign : tables design_themes, design_theme_colors, design_theme_fonts (migration
 * 20261006120000_flexdesign_themes.sql de flexstaff). Lecture publique, écriture admin : la RLS décide,
 * avec le jeton du compte.
 */

interface ThemeRow {
  id: string;
  name: string;
  has_dark: boolean;
  updated_at: string;
  design_theme_colors: { mode: "light" | "dark"; kind: "role" | "named" | "derived"; name: string; hex: string; position: number }[];
  design_theme_fonts: { role: FontRole; font_id: string; fallback: Fallback }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function themeId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(400, "Identifiant de thème invalide");
  return value;
}

function toTheme(row: ThemeRow): Theme {
  const colors = [...row.design_theme_colors].sort((a, b) => a.position - b.position);
  const pick = <T>(mode: "light" | "dark", kind: "role" | "derived"): T =>
    Object.fromEntries(colors.filter((c) => c.mode === mode && c.kind === kind).map((c) => [c.name, c.hex])) as T;
  return {
    id: row.id,
    name: row.name,
    hasDark: row.has_dark,
    light: pick<Palette>("light", "role"),
    dark: row.has_dark ? pick<Palette>("dark", "role") : null,
    named: colors.filter((c) => c.kind === "named").map((c) => ({ name: c.name, hex: c.hex })),
    derived: { light: pick<DerivedPalette>("light", "derived"), dark: row.has_dark ? pick<DerivedPalette>("dark", "derived") : null },
    fonts: row.design_theme_fonts.map((f) => ({ role: f.role, fontId: f.font_id, fallback: f.fallback })),
    updatedAt: row.updated_at,
  };
}

const SELECT = "select=id,name,has_dark,updated_at,design_theme_colors(mode,kind,name,hex,position),design_theme_fonts(role,font_id,fallback)";

export async function listThemes(db: Db): Promise<Theme[]> {
  return (await db.select<ThemeRow>("design_themes", `${SELECT}&order=name.asc`)).map(toTheme);
}

// --- Validation du corps de POST /api/themes ----------------------------------

function palette(value: unknown, label: string): Palette {
  const src = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const out = {} as Palette;
  for (const role of COLOR_ROLES) {
    const hex = typeof src[role] === "string" ? normalizeHex(src[role]) : null;
    if (!hex) throw new HttpError(400, `${label} : couleur « ${role} » invalide (#rgb ou #rrggbb)`);
    out[role] = hex;
  }
  return out;
}

function namedColors(value: unknown): NamedColor[] {
  const list = Array.isArray(value) ? value : [];
  if (list.length > MAX_NAMED_COLORS) throw new HttpError(400, `${MAX_NAMED_COLORS} couleurs nommées au maximum`);
  const seen = new Set<string>();
  return list.map((item: unknown) => {
    const { name, hex } = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const n = typeof name === "string" ? name.trim() : "";
    if (!NAMED_COLOR_PATTERN.test(n)) throw new HttpError(400, "Nom de couleur invalide : minuscules, chiffres et tirets, 32 caractères max");
    if (seen.has(n) || (COLOR_ROLES as readonly string[]).includes(n)) throw new HttpError(400, `Nom de couleur déjà pris : « ${n} »`);
    seen.add(n);
    const h = typeof hex === "string" ? normalizeHex(hex) : null;
    if (!h) throw new HttpError(400, `Couleur « ${n} » invalide (#rgb ou #rrggbb)`);
    return { name: n, hex: h };
  });
}

function themeFonts(value: unknown): ThemeFont[] {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  return list.map((item: unknown) => {
    const { role, fontId, fallback } = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    if (!FONT_ROLES.includes(role as FontRole) || seen.has(role as string)) throw new HttpError(400, "Rôle de police invalide");
    if (typeof fontId !== "string" || !UUID.test(fontId)) throw new HttpError(400, "Police invalide");
    if (!FALLBACKS.includes(fallback as Fallback)) throw new HttpError(400, "Police de secours invalide");
    seen.add(role as string);
    return { role: role as FontRole, fontId, fallback: fallback as Fallback };
  });
}

export function parseThemeInput(body: Record<string, unknown>): ThemeInput {
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > MAX_THEME_NAME_LENGTH) throw new HttpError(400, `Nom du thème requis (${MAX_THEME_NAME_LENGTH} caractères max)`);
  const hasDark = body.hasDark === true;
  return {
    id: body.id === undefined || body.id === null ? undefined : themeId(body.id),
    name,
    hasDark,
    light: palette(body.light, "Mode clair"),
    dark: hasDark ? palette(body.dark, "Mode sombre") : null,
    named: namedColors(body.named),
    fonts: themeFonts(body.fonts),
  };
}

// --- Écriture -----------------------------------------------------------------

/** Enregistre le thème et toutes ses couleurs en une transaction (design_save_theme), puis le relit. */
export async function saveTheme(db: Db, input: ThemeInput): Promise<Theme> {
  const rows = (mode: "light" | "dark", p: Palette) => {
    const derived = deriveShades(p, mode);
    return [
      ...COLOR_ROLES.map((name, position) => ({ mode, kind: "role", name, hex: p[name], position })),
      ...Object.entries(derived).map(([name, hex], i) => ({ mode, kind: "derived", name, hex, position: i })),
    ];
  };
  const colors = [
    ...rows("light", input.light),
    ...(input.dark ? rows("dark", input.dark) : []),
    ...input.named.map((c, position) => ({ mode: "light", kind: "named", name: c.name, hex: c.hex, position })),
  ];
  let id: string;
  try {
    id = await db.rpc<string>("design_save_theme", {
      p_theme: {
        id: input.id ?? null,
        name: input.name,
        has_dark: input.hasDark,
        colors,
        fonts: input.fonts.map((f) => ({ role: f.role, font_id: f.fontId, fallback: f.fallback })),
      },
    });
  } catch (err) {
    if (err instanceof DbError && err.code === "23505") throw new HttpError(409, "Un thème porte déjà ce nom");
    if (err instanceof DbError && err.code === "23503") throw new HttpError(400, "Une des polices choisies n'existe plus");
    throw err;
  }
  const row = await db.one<ThemeRow>("design_themes", `${SELECT}&id=${eq(id)}`);
  if (!row) throw new HttpError(404, "Thème introuvable");
  return toTheme(row);
}

/** Supprime un thème (ses couleurs et polices suivent). Les applis liées reviennent à leur propre apparence. */
export async function deleteTheme(db: Db, id: string): Promise<void> {
  if (!(await db.one<{ id: string }>("design_themes", `select=id&id=${eq(id)}`))) throw new HttpError(404, "Thème introuvable");
  await db.remove("design_themes", `id=${eq(id)}`);
}
