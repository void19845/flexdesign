import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { HttpError } from "./errors";
import { anonDb, Db, eq, serviceDb } from "./supabase";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MAX_BOARD_DESCRIPTION_LENGTH,
  MAX_BOARD_TITLE_LENGTH,
  MAX_ITEM_WIDTH,
  MAX_NOTE_LENGTH,
  MIN_ITEM_WIDTH,
  type Board,
  type BoardAccess,
  type BoardItem,
  type BoardMember,
  type BoardSummary,
  type PublicBoard,
  type TeamMember,
} from "@/lib/shared/types";

/**
 * Moodboards : tables design_boards, design_board_members, design_board_links, design_board_items et bucket
 * privé design-assets (supabase/init.sql). Tout passe par le jeton du compte : la base décide qui voit et
 * modifie quoi (design_board_access). Seul le lien public lit les fichiers avec la clé service_role, après
 * avoir vérifié le jeton en base (design_board_by_token).
 */

const BUCKET = "design-assets";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

interface BoardRow {
  id: string;
  title: string;
  description: string;
  owner_id: string;
  team_read: boolean;
  updated_at: string;
  design_board_items: { count: number }[];
  /** La base ne renvoie que sa propre ligne à un membre, et toutes au propriétaire */
  design_board_members: { user_id: string; can_edit: boolean }[];
}

interface ItemRow {
  id: string;
  board_id: string;
  path: string;
  mime: string;
  width_px: number;
  height_px: number;
  x: number;
  y: number;
  w: number;
  z: number;
  note: string;
}

const BOARD_SELECT = "select=id,title,description,owner_id,team_read,updated_at,design_board_items(count),design_board_members(user_id,can_edit)";
const ITEM_SELECT = "select=id,board_id,path,mime,width_px,height_px,x,y,w,z,note";

export function uuid(value: unknown, label = "Identifiant"): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(400, `${label} invalide`);
  return value;
}

/** Équipe Flexdesign (comptes et e-mails), lue par la fonction design_team de la base. */
export async function team(db: Db): Promise<TeamMember[]> {
  const rows = await db.rpc<{ user_id: string; email: string }[]>("design_team");
  return rows.map((r) => ({ userId: r.user_id, email: r.email }));
}

function accessOf(row: BoardRow, userId: string): BoardAccess {
  if (row.owner_id === userId) return "owner";
  const mine = row.design_board_members.find((m) => m.user_id === userId);
  return mine?.can_edit ? "edit" : "read";
}

function toSummary(row: BoardRow, userId: string, emails: Map<string, string>): BoardSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    ownerEmail: emails.get(row.owner_id) ?? null,
    access: accessOf(row, userId),
    teamRead: row.team_read,
    itemCount: row.design_board_items[0]?.count ?? 0,
    updatedAt: row.updated_at,
  };
}

const toItem = (row: ItemRow, url: string): BoardItem => ({
  id: row.id,
  url,
  widthPx: row.width_px,
  heightPx: row.height_px,
  x: row.x,
  y: row.y,
  w: row.w,
  z: row.z,
  note: row.note,
});
const teamItem = (row: ItemRow) => toItem(row, `/api/boards/image?id=${row.id}`);

async function emailMap(db: Db): Promise<Map<string, string>> {
  return new Map((await team(db)).map((m) => [m.userId, m.email]));
}

/** Tableau visible par le compte, sinon 404 (un tableau non partagé avec lui n'existe pas pour lui). */
async function readBoard(db: Db, id: string): Promise<BoardRow> {
  const row = await db.one<BoardRow>("design_boards", `${BOARD_SELECT}&id=${eq(id)}`);
  if (!row) throw new HttpError(404, "Moodboard introuvable");
  return row;
}

async function requireOwner(db: Db, id: string, userId: string): Promise<BoardRow> {
  const row = await readBoard(db, id);
  if (row.owner_id !== userId) throw new HttpError(403, "Seul le propriétaire du moodboard peut faire cela.");
  return row;
}

async function requireEdit(db: Db, boardId: string, userId: string): Promise<void> {
  if (accessOf(await readBoard(db, boardId), userId) === "read") throw new HttpError(403, "Ce moodboard est partagé avec toi en lecture seule.");
}

// --- Tableaux --------------------------------------------------------------------

export async function listBoards(db: Db, userId: string): Promise<BoardSummary[]> {
  const [rows, emails] = await Promise.all([db.select<BoardRow>("design_boards", `${BOARD_SELECT}&order=updated_at.desc`), emailMap(db)]);
  return rows.map((r) => toSummary(r, userId, emails));
}

export function boardText(body: Record<string, unknown>): { title: string; description: string } {
  const title = typeof body.title === "string" ? body.title.trim().replace(/\s+/g, " ") : "";
  if (!title || title.length > MAX_BOARD_TITLE_LENGTH) throw new HttpError(400, `Titre requis (${MAX_BOARD_TITLE_LENGTH} caractères max)`);
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length > MAX_BOARD_DESCRIPTION_LENGTH) throw new HttpError(400, `Description : ${MAX_BOARD_DESCRIPTION_LENGTH} caractères max`);
  return { title, description };
}

export async function createBoard(db: Db, userId: string, text: { title: string; description: string }): Promise<BoardSummary> {
  const [created] = await db.insert<{ id: string }>("design_boards", { owner_id: userId, ...text });
  return toSummary(await readBoard(db, created.id), userId, await emailMap(db));
}

export async function boardDetail(db: Db, id: string, userId: string): Promise<Board> {
  const row = await readBoard(db, id);
  const [items, emails, link] = await Promise.all([
    db.select<ItemRow>("design_board_items", `${ITEM_SELECT}&board_id=${eq(id)}&order=z.asc,created_at.asc`),
    emailMap(db),
    // La base ne montre le jeton qu'au propriétaire
    db.one<{ token: string }>("design_board_links", `select=token&board_id=${eq(id)}`),
  ]);
  const summary = toSummary(row, userId, emails);
  return {
    ...summary,
    items: items.map(teamItem),
    members: summary.access === "owner" ? row.design_board_members.map((m) => ({ userId: m.user_id, email: emails.get(m.user_id) ?? null, canEdit: m.can_edit })) : [],
    shareToken: link?.token ?? null,
  };
}

export async function updateSettings(db: Db, userId: string, id: string, text: { title: string; description: string }, teamRead: boolean): Promise<void> {
  await requireOwner(db, id, userId);
  const rows = await db.update("design_boards", `id=${eq(id)}`, { ...text, team_read: teamRead, updated_at: new Date().toISOString() });
  if (!rows.length) throw new HttpError(403, "Seul le propriétaire du moodboard peut faire cela.");
}

/** Supprime le tableau et ses fichiers (fichiers d'abord : après, plus personne n'a le droit de les effacer). */
export async function deleteBoard(db: Db, userId: string, id: string): Promise<void> {
  await requireOwner(db, id, userId);
  const items = await db.select<{ path: string }>("design_board_items", `select=path&board_id=${eq(id)}`);
  await db.removeFiles(BUCKET, items.map((i) => i.path));
  await db.remove("design_boards", `id=${eq(id)}`);
}

// --- Partage ----------------------------------------------------------------------

async function members(db: Db, boardId: string): Promise<BoardMember[]> {
  const [rows, emails] = await Promise.all([
    db.select<{ user_id: string; can_edit: boolean }>("design_board_members", `select=user_id,can_edit&board_id=${eq(boardId)}&order=created_at.asc`),
    emailMap(db),
  ]);
  return rows.map((m) => ({ userId: m.user_id, email: emails.get(m.user_id) ?? null, canEdit: m.can_edit }));
}

/** Ajoute un membre de l'équipe Flexdesign au tableau, ou change son droit (lecture ou modification). */
export async function setMember(db: Db, userId: string, boardId: string, memberId: string, canEdit: boolean): Promise<BoardMember[]> {
  const board = await requireOwner(db, boardId, userId);
  if (memberId === userId) throw new HttpError(400, "Tu es déjà propriétaire de ce moodboard.");
  if (!(await team(db)).some((m) => m.userId === memberId)) throw new HttpError(400, "Ce compte ne fait pas partie de l'équipe Flexdesign.");
  if (board.design_board_members.some((m) => m.user_id === memberId)) {
    await db.update("design_board_members", `board_id=${eq(boardId)}&user_id=${eq(memberId)}`, { can_edit: canEdit });
  } else {
    await db.insert("design_board_members", { board_id: boardId, user_id: memberId, can_edit: canEdit });
  }
  return members(db, boardId);
}

export async function removeMember(db: Db, userId: string, boardId: string, memberId: string): Promise<BoardMember[]> {
  await requireOwner(db, boardId, userId);
  await db.remove("design_board_members", `board_id=${eq(boardId)}&user_id=${eq(memberId)}`);
  return members(db, boardId);
}

/** Crée ou régénère le lien public : l'ancien jeton cesse aussitôt de fonctionner. */
export async function createLink(db: Db, userId: string, boardId: string): Promise<string> {
  await requireOwner(db, boardId, userId);
  const token = randomBytes(32).toString("base64url");
  await db.remove("design_board_links", `board_id=${eq(boardId)}`);
  await db.insert("design_board_links", { board_id: boardId, token });
  return token;
}

export async function deleteLink(db: Db, userId: string, boardId: string): Promise<void> {
  await requireOwner(db, boardId, userId);
  await db.remove("design_board_links", `board_id=${eq(boardId)}`);
}

// --- Images -----------------------------------------------------------------------

/** Type réel de l'image d'après ses premiers octets (jamais d'après son nom ou le type annoncé). SVG refusé. */
export function imageType(bytes: Uint8Array): { mime: string; ext: string } | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return { mime: "image/png", ext: "png" };
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return { mime: "image/gif", ext: "gif" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

function int(value: unknown, min: number, max: number, label: string): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} invalide`);
  return n;
}

export async function addItem(
  db: Db,
  userId: string,
  input: { boardId: string; bytes: Uint8Array<ArrayBuffer>; widthPx: unknown; heightPx: unknown; x: unknown; y: unknown; w: unknown },
): Promise<BoardItem> {
  const type = imageType(input.bytes);
  if (!type) throw new HttpError(400, "Fichier refusé : seules les images JPEG, PNG, WebP et GIF sont acceptées");
  const fields = {
    width_px: int(input.widthPx, 1, 10000, "Largeur de l'image"),
    height_px: int(input.heightPx, 1, 10000, "Hauteur de l'image"),
    x: int(input.x, 0, CANVAS_WIDTH, "Position"),
    y: int(input.y, 0, CANVAS_HEIGHT, "Position"),
    w: int(input.w, MIN_ITEM_WIDTH, MAX_ITEM_WIDTH, "Largeur affichée"),
  };
  await requireEdit(db, input.boardId, userId);
  const top = await db.one<{ z: number }>("design_board_items", `select=z&board_id=${eq(input.boardId)}&order=z.desc`);
  const path = `${input.boardId}/${randomUUID()}.${type.ext}`;
  await db.upload(BUCKET, path, input.bytes, type.mime, false);
  try {
    const [row] = await db.insert<ItemRow>("design_board_items", { board_id: input.boardId, path, mime: type.mime, ...fields, z: (top?.z ?? 0) + 1, created_by: userId });
    return teamItem(row);
  } catch (err) {
    await db.removeFiles(BUCKET, [path]).catch(() => {});
    throw err;
  }
}

/** Déplace, redimensionne, change l'ordre d'empilement ou la note d'une image. */
export async function updateItem(db: Db, userId: string, id: string, body: Record<string, unknown>): Promise<BoardItem> {
  const patch: Record<string, number | string> = {};
  if (body.x !== undefined) patch.x = int(body.x, 0, CANVAS_WIDTH, "Position");
  if (body.y !== undefined) patch.y = int(body.y, 0, CANVAS_HEIGHT, "Position");
  if (body.w !== undefined) patch.w = int(body.w, MIN_ITEM_WIDTH, MAX_ITEM_WIDTH, "Largeur affichée");
  if (body.z !== undefined) patch.z = int(body.z, -1_000_000, 1_000_000, "Ordre");
  if (body.note !== undefined) {
    if (typeof body.note !== "string" || body.note.trim().length > MAX_NOTE_LENGTH) throw new HttpError(400, `Note : ${MAX_NOTE_LENGTH} caractères max`);
    patch.note = body.note.trim();
  }
  if (!Object.keys(patch).length) throw new HttpError(400, "Rien à modifier");
  const item = await db.one<ItemRow>("design_board_items", `${ITEM_SELECT}&id=${eq(id)}`);
  if (!item) throw new HttpError(404, "Image introuvable");
  await requireEdit(db, item.board_id, userId);
  const [row] = await db.update<ItemRow>("design_board_items", `id=${eq(id)}&select=${ITEM_SELECT.slice(7)}`, patch);
  if (!row) throw new HttpError(403, "Ce moodboard est partagé avec toi en lecture seule.");
  return teamItem(row);
}

export async function deleteItem(db: Db, userId: string, id: string): Promise<void> {
  const item = await db.one<ItemRow>("design_board_items", `${ITEM_SELECT}&id=${eq(id)}`);
  if (!item) throw new HttpError(404, "Image introuvable");
  await requireEdit(db, item.board_id, userId);
  await db.remove("design_board_items", `id=${eq(id)}`);
  await db.removeFiles(BUCKET, [item.path]);
}

function imageResponse(res: Response, mime: string): Response {
  return new Response(res.body, {
    headers: { "Content-Type": mime, "Cache-Control": "private, max-age=300", "Content-Disposition": "inline" },
  });
}

/** Image d'un tableau pour un membre de l'équipe : lue avec son jeton (règles du bucket design-assets). */
export async function itemImage(db: Db, id: string): Promise<Response> {
  const item = await db.one<ItemRow>("design_board_items", `${ITEM_SELECT}&id=${eq(id)}`);
  const file = item ? await db.download(BUCKET, item.path) : null;
  if (!item || !file) throw new HttpError(404, "Image introuvable");
  return imageResponse(file, item.mime);
}

// --- Lien public (sans compte) ----------------------------------------------------

interface PublicRow {
  title: string;
  description: string;
  items: ItemRow[];
}

async function publicRow(token: string): Promise<PublicRow> {
  const row = TOKEN.test(token) ? await anonDb().rpc<PublicRow | null>("design_board_by_token", { p_token: token }) : null;
  if (!row) throw new HttpError(404, "Lien invalide ou désactivé");
  return row;
}

export async function publicBoard(token: string): Promise<PublicBoard> {
  const row = await publicRow(token);
  return {
    title: row.title,
    description: row.description,
    // Les chemins du bucket ne sortent pas du serveur
    items: row.items.map((i) => toItem(i, `/api/public/image?token=${token}&id=${i.id}`)),
  };
}

/** Image d'un tableau par lien public : le jeton est vérifié en base avant de lire le fichier. */
export async function publicImage(token: string, id: string): Promise<Response> {
  const item = (await publicRow(token)).items.find((i) => i.id === id);
  const file = item ? await serviceDb().download(BUCKET, item.path) : null;
  if (!item || !file) throw new HttpError(404, "Image introuvable");
  return imageResponse(file, item.mime);
}
