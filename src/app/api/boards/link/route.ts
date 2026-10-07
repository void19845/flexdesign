import { createLink, deleteLink, uuid } from "@/lib/server/boards";
import { json, readJson, requireStaff, route } from "@/lib/server/http";

/** Crée ou régénère le lien public en lecture seule (propriétaire). */
export const POST = route(async (req) => {
  const { db, userId } = await requireStaff(req);
  return json({ token: await createLink(db, userId, uuid((await readJson(req)).boardId, "Moodboard")) });
});

/** Désactive le lien public (propriétaire). */
export const DELETE = route(async (req) => {
  const { db, userId } = await requireStaff(req);
  await deleteLink(db, userId, uuid((await readJson(req)).boardId, "Moodboard"));
  return json({ ok: true });
});
