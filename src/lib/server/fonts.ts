import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { HttpError } from "./errors";
import { Db, DbError, eq, publicSupabaseUrl } from "./supabase";
import { MAX_FONT_BYTES, type CatalogFont, type Font, type FontFile, type FontStyle } from "@/lib/shared/types";

/**
 * Polices de Flexdesign : tables design_fonts et design_font_files, fichiers dans le bucket public
 * design-fonts (supabase/init.sql). Les navigateurs ne
 * contactent jamais Google : les fichiers du catalogue sont copiés une fois dans le bucket.
 */

const BUCKET = "design-fonts";
/** Catalogue Google Fonts complet, sous licence libre, servi par Fontsource (API publique, sans clé) */
const FONTSOURCE_API = "https://api.fontsource.org/v1/fonts";
/** Seule origine acceptée pour télécharger un fichier indiqué par l'API */
const FONTSOURCE_FILES = "https://cdn.jsdelivr.net/fontsource/";
/** Sous-ensembles copiés : le français tient dans latin, latin-ext couvre les autres langues latines */
const SUBSETS = ["latin", "latin-ext"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Même règle que la contrainte de design_font_files.unicode_range */
const UNICODE_RANGE = /^U\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?(,U\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?)*$/;

interface FontRow {
  id: string;
  family: string;
  label: string;
  source: "catalog" | "upload";
  category: string;
  license: string;
  design_font_files: { weight: number; style: FontStyle; subset: string | null; unicode_range: string | null; format: FontFile["format"]; path: string }[];
}

const SELECT = "select=id,family,label,source,category,license,design_font_files(weight,style,subset,unicode_range,format,path)";

function toFont(row: FontRow): Font {
  const base = `${publicSupabaseUrl()}/storage/v1/object/public/${BUCKET}/`;
  return {
    id: row.id,
    family: row.family,
    label: row.label,
    source: row.source,
    category: row.category,
    license: row.license,
    files: row.design_font_files
      .map((f) => ({ weight: f.weight, style: f.style, subset: f.subset, unicodeRange: f.unicode_range, format: f.format, url: base + f.path }))
      .sort((a, b) => a.weight - b.weight || a.style.localeCompare(b.style) || (a.subset ?? "").localeCompare(b.subset ?? "")),
  };
}

export async function listFonts(db: Db): Promise<Font[]> {
  return (await db.select<FontRow>("design_fonts", `${SELECT}&order=label.asc`)).map(toFont);
}

async function readFont(db: Db, id: string): Promise<Font> {
  const row = await db.one<FontRow>("design_fonts", `${SELECT}&id=${eq(id)}`);
  if (!row) throw new HttpError(404, "Police introuvable");
  return toFont(row);
}

export function fontId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(400, "Identifiant de police invalide");
  return value;
}

/** Supprime une police et ses fichiers. Refusé si un thème l'utilise encore. */
export async function deleteFont(db: Db, id: string): Promise<void> {
  const font = await db.one<FontRow>("design_fonts", `${SELECT}&id=${eq(id)}`);
  if (!font) throw new HttpError(404, "Police introuvable");
  try {
    await db.remove("design_fonts", `id=${eq(id)}`);
  } catch (err) {
    if (err instanceof DbError && err.code === "23503") throw new HttpError(409, "Police utilisée par un thème : choisis d'abord une autre police dans ce thème");
    throw err;
  }
  await db.removeFiles(BUCKET, font.design_font_files.map((f) => f.path));
}

// --- Catalogue (Fontsource) -------------------------------------------------------

interface FontsourceEntry {
  id: string;
  family: string;
  subsets: string[];
  weights: number[];
  styles: string[];
  defSubset: string;
  category: string;
  license: string;
  type: string;
}

interface FontsourceDetail extends FontsourceEntry {
  unicodeRange: Record<string, string>;
  variants: Record<string, Record<string, Record<string, { url: { woff2?: string } }>>>;
}

const CATEGORIES = ["sans-serif", "serif", "display", "handwriting", "monospace"];
const LICENSES = ["OFL-1.1", "Apache-2.0", "UFL-1.0"];
let catalog: { at: number; fonts: FontsourceEntry[] } | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  } catch {
    throw new HttpError(502, "Catalogue de polices injoignable, réessaie plus tard");
  }
  if (!res.ok) throw new HttpError(502, "Catalogue de polices injoignable, réessaie plus tard");
  return (await res.json()) as T;
}

/** Polices Google du catalogue sous licence libre connue (hors icônes), gardées en mémoire 24 h. */
async function catalogFonts(): Promise<FontsourceEntry[]> {
  if (!catalog || Date.now() - catalog.at > 24 * 3600_000) {
    const all = await fetchJson<FontsourceEntry[]>(FONTSOURCE_API);
    const fonts = all.filter((f) => f.type === "google" && CATEGORIES.includes(f.category) && LICENSES.includes(f.license) && /^[a-z0-9-]{1,80}$/.test(f.id) && /^[A-Za-z0-9][A-Za-z0-9 ]{0,62}$/.test(f.family));
    catalog = { at: Date.now(), fonts };
  }
  return catalog.fonts;
}

const toCatalogFont = (f: FontsourceEntry): CatalogFont => ({
  id: f.id,
  family: f.family,
  category: f.category,
  license: f.license,
  weights: f.weights,
  italic: f.styles.includes("italic"),
});

/** Recherche par nom dans le catalogue : 30 résultats au plus, ceux qui commencent par le texte d'abord. */
export async function searchCatalog(query: string): Promise<CatalogFont[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits = (await catalogFonts()).filter((f) => f.family.toLowerCase().includes(q));
  hits.sort((a, b) => Number(!a.family.toLowerCase().startsWith(q)) - Number(!b.family.toLowerCase().startsWith(q)));
  return hits.slice(0, 30).map(toCatalogFont);
}

/** Télécharge un fichier woff2 du catalogue (origine, taille et type vérifiés). */
async function download(url: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!url.startsWith(FONTSOURCE_FILES)) throw new HttpError(502, "Adresse de fichier inattendue dans le catalogue");
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch {
    throw new HttpError(502, "Téléchargement de la police impossible, réessaie plus tard");
  }
  if (!res.ok) throw new HttpError(502, "Téléchargement de la police impossible, réessaie plus tard");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_FONT_BYTES || fontFormat(bytes)?.format !== "woff2") throw new HttpError(502, "Fichier de police inattendu dans le catalogue");
  return bytes;
}

/**
 * Copie une police du catalogue dans le bucket : graisses choisies, style normal (et italique si demandé),
 * sous-ensembles latin et latin-ext. Relancer avec d'autres graisses complète la même police.
 */
export async function copyFromCatalog(db: Db, id: string, weights: number[], italic: boolean): Promise<Font> {
  const entry = (await catalogFonts()).find((f) => f.id === id);
  if (!entry) throw new HttpError(404, "Police absente du catalogue");
  const detail = await fetchJson<FontsourceDetail>(`${FONTSOURCE_API}/${id}`);
  const chosen = weights.filter((w) => entry.weights.includes(w));
  if (!chosen.length) throw new HttpError(400, "Choisis au moins une graisse disponible");
  const styles = (["normal", "italic"] as const).filter((s) => entry.styles.includes(s) && (s === "normal" || italic));
  if (!styles.length) throw new HttpError(400, "Aucun style disponible pour cette police");
  const subsets = SUBSETS.filter((s) => entry.subsets.includes(s));
  if (!subsets.length) subsets.push(entry.defSubset);

  const existing = await db.one<FontRow>("design_fonts", `${SELECT}&catalog_id=${eq(id)}`);
  const fid = existing?.id ?? randomUUID();
  const have = new Set(existing?.design_font_files.map((f) => `${f.weight}-${f.style}-${f.subset}`));
  const todo = chosen.flatMap((weight) => styles.flatMap((style) => subsets.map((subset) => ({ weight, style, subset })))).filter((f) => !have.has(`${f.weight}-${f.style}-${f.subset}`));

  // Fichiers d'abord, lignes ensuite : une ligne publiée pointe toujours vers un fichier présent
  const files = await Promise.all(
    todo.map(async ({ weight, style, subset }) => {
      const url = detail.variants[String(weight)]?.[style]?.[subset]?.url.woff2;
      if (!url) throw new HttpError(502, `Fichier absent du catalogue (${weight} ${style} ${subset})`);
      const path = `${fid}/${weight}-${style}-${subset}.woff2`;
      await db.upload(BUCKET, path, await download(url), "font/woff2");
      const range = detail.unicodeRange?.[subset];
      return { font_id: fid, weight, style, subset, unicode_range: range && UNICODE_RANGE.test(range) ? range : null, format: "woff2", path };
    }),
  );
  try {
    if (!existing) {
      await db.insert("design_fonts", { id: fid, family: entry.family, label: entry.family, source: "catalog", catalog_id: id, category: entry.category, license: entry.license });
    }
    if (files.length) await db.insert("design_font_files", files);
  } catch (err) {
    await db.removeFiles(BUCKET, files.map((f) => f.path)).catch(() => {});
    if (err instanceof DbError && err.code === "23505") throw new HttpError(409, "Cette police est déjà en cours d'ajout, recharge la liste");
    throw err;
  }
  return readFont(db, fid);
}

// --- Polices envoyées par l'équipe -------------------------------------------------

/** Type réel du fichier d'après ses premiers octets (jamais d'après son nom ou le type annoncé). */
export function fontFormat(bytes: Uint8Array): { format: FontFile["format"]; ext: string; mime: string } | null {
  const sig = String.fromCharCode(...bytes.subarray(0, 4));
  if (sig === "wOF2") return { format: "woff2", ext: "woff2", mime: "font/woff2" };
  if (sig === "wOFF") return { format: "woff", ext: "woff", mime: "font/woff" };
  if (sig === "OTTO") return { format: "opentype", ext: "otf", mime: "font/otf" };
  if (sig === "\x00\x01\x00\x00" || sig === "true") return { format: "truetype", ext: "ttf", mime: "font/ttf" };
  return null;
}

/**
 * Ajoute un fichier envoyé : nouvelle police (label saisi, nom de famille CSS généré) ou nouvelle
 * graisse / style d'une police déjà envoyée (fontId). Chemin du fichier généré.
 */
export async function uploadFont(
  db: Db,
  input: { bytes: Uint8Array<ArrayBuffer>; weight: number; style: FontStyle; label: string; fontId: string | null },
): Promise<Font> {
  const type = fontFormat(input.bytes);
  if (!type) throw new HttpError(400, "Fichier refusé : seules les polices woff2, woff, ttf et otf sont acceptées");

  let fid: string;
  if (input.fontId) {
    const font = await db.one<{ id: string; source: string }>("design_fonts", `select=id,source&id=${eq(input.fontId)}`);
    if (!font) throw new HttpError(404, "Police introuvable");
    if (font.source !== "upload") throw new HttpError(400, "On ne peut ajouter un fichier qu'à une police envoyée par l'équipe");
    fid = font.id;
  } else {
    fid = randomUUID();
  }

  const path = `${fid}/${input.weight}-${input.style}.${type.ext}`;
  if (await db.one("design_font_files", `select=id&font_id=${eq(fid)}&weight=${eq(input.weight)}&style=${eq(input.style)}`)) {
    throw new HttpError(409, "Cette police a déjà un fichier pour cette graisse et ce style");
  }
  await db.upload(BUCKET, path, input.bytes, type.mime);
  try {
    if (!input.fontId) {
      await db.insert("design_fonts", { id: fid, family: `Flexdesign ${randomBytes(4).toString("hex")}`, label: input.label, source: "upload", category: "other", license: "own" });
    }
    await db.insert("design_font_files", { font_id: fid, weight: input.weight, style: input.style, subset: null, unicode_range: null, format: type.format, path });
  } catch (err) {
    await db.removeFiles(BUCKET, [path]).catch(() => {});
    if (err instanceof DbError && err.code === "23505") throw new HttpError(409, "Cette police a déjà un fichier pour cette graisse et ce style");
    throw err;
  }
  return readFont(db, fid);
}
