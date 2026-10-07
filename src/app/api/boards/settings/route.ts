import { boardText, updateSettings, uuid } from "@/lib/server/boards";
import { json, readJson, requireStaff, route } from "@/lib/server/http";

/** Titre, description et lecture par toute l'équipe Flexdesign (propriétaire). */
export const POST = route(async (req) => {
  const { db, userId } = await requireStaff(req);
  const body = await readJson(req);
  await updateSettings(db, userId, uuid(body.id, "Moodboard"), boardText(body), body.teamRead === true);
  return json({ ok: true });
});
