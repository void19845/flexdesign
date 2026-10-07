import { updateItem, uuid } from "@/lib/server/boards";
import { json, readJson, requireStaff, route } from "@/lib/server/http";

/** Position, largeur, ordre d'empilement ou note d'une image. Propriétaire ou membre en modification. */
export const POST = route(async (req) => {
  const { db, userId } = await requireStaff(req);
  const body = await readJson(req);
  return json(await updateItem(db, userId, uuid(body.id, "Image"), body));
});
