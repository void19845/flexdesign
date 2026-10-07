import { publicImage, uuid } from "@/lib/server/boards";
import { route } from "@/lib/server/http";

/** Image d'un moodboard par lien public : le jeton est revérifié en base à chaque image. */
export const GET = route(async (req) => {
  const params = new URL(req.url).searchParams;
  return publicImage(params.get("token") ?? "", uuid(params.get("id"), "Image"));
});
