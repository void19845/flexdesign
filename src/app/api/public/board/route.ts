import { publicBoard } from "@/lib/server/boards";
import { json, rateLimit, route } from "@/lib/server/http";

/** Moodboard par lien public, en lecture seule et sans compte. */
export const GET = route(async (req) => {
  await rateLimit(req, "public-board", 60);
  return json(await publicBoard(new URL(req.url).searchParams.get("token") ?? ""));
});
