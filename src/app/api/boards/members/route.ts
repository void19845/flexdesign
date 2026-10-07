import { removeMember, setMember, uuid } from "@/lib/server/boards";
import { json, readJson, requireStaff, route } from "@/lib/server/http";

/** Partage avec un membre de l'équipe Flexdesign, en lecture ou en modification (propriétaire). */
export const POST = route(async (req) => {
  const { db, userId } = await requireStaff(req);
  const body = await readJson(req);
  return json(await setMember(db, userId, uuid(body.boardId, "Moodboard"), uuid(body.userId, "Compte"), body.canEdit === true));
});

export const DELETE = route(async (req) => {
  const { db, userId } = await requireStaff(req);
  const body = await readJson(req);
  return json(await removeMember(db, userId, uuid(body.boardId, "Moodboard"), uuid(body.userId, "Compte")));
});
