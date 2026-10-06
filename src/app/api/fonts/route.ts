import { deleteFont, fontId, listFonts } from "@/lib/server/fonts";
import { json, readJson, requireAdmin, requireStaff, route } from "@/lib/server/http";

/** Polices disponibles avec l'adresse de leurs fichiers (admin et staff : utile à l'aperçu des thèmes). */
export const GET = route(async (req) => {
  const { db } = await requireStaff(req);
  return json(await listFonts(db));
});

/** Suppression d'une police et de ses fichiers. Admin seulement, refusée si un thème l'utilise. */
export const DELETE = route(async (req) => {
  const { db } = await requireAdmin(req);
  await deleteFont(db, fontId((await readJson(req)).id));
  return json({ ok: true });
});
