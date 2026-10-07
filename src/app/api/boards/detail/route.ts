import { boardDetail, uuid } from "@/lib/server/boards";
import { json, requireStaff, route } from "@/lib/server/http";

/** Un moodboard avec ses images ; membres et lien public pour le propriétaire seulement. */
export const GET = route(async (req) => {
  const { db, userId } = await requireStaff(req);
  return json(await boardDetail(db, uuid(new URL(req.url).searchParams.get("id"), "Moodboard"), userId));
});
