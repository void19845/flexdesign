import { boardText, createBoard, deleteBoard, listBoards, uuid } from "@/lib/server/boards";
import { json, readJson, requireStaff, route } from "@/lib/server/http";

/** Moodboards visibles par le compte : les siens et ceux partagés avec lui (admin et staff). */
export const GET = route(async (req) => {
  const { db, userId } = await requireStaff(req);
  return json(await listBoards(db, userId));
});

/** Nouveau moodboard, dont le compte est propriétaire. */
export const POST = route(async (req) => {
  const { db, userId } = await requireStaff(req);
  return json(await createBoard(db, userId, boardText(await readJson(req))), 201);
});

/** Suppression d'un moodboard et de ses images (propriétaire). */
export const DELETE = route(async (req) => {
  const { db, userId } = await requireStaff(req);
  await deleteBoard(db, userId, uuid((await readJson(req)).id, "Moodboard"));
  return json({ ok: true });
});
