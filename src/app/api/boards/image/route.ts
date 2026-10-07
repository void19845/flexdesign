import { itemImage, uuid } from "@/lib/server/boards";
import { requireStaff, route } from "@/lib/server/http";

/** Image d'un moodboard, servie par le même site (la page n'a pas d'autre origine d'images). */
export const GET = route(async (req) => {
  const { db } = await requireStaff(req);
  return itemImage(db, uuid(new URL(req.url).searchParams.get("id"), "Image"));
});
