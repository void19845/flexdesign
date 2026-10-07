import { team } from "@/lib/server/boards";
import { json, requireStaff, route } from "@/lib/server/http";

/** Équipe Flexdesign (comptes et e-mails), pour partager un moodboard. */
export const GET = route(async (req) => {
  const { db } = await requireStaff(req);
  return json(await team(db));
});
