import { json, readJson, requireAdmin, requireStaff, route } from "@/lib/server/http";
import { deleteTheme, listThemes, parseThemeInput, saveTheme, themeId } from "@/lib/server/themes";

/** Liste des thèmes (admin et staff ; le staff ne fait que les consulter). */
export const GET = route(async (req) => {
  const { db } = await requireStaff(req);
  return json(await listThemes(db));
});

/** Création (sans id) ou remplacement complet d'un thème. Admin seulement. */
export const POST = route(async (req) => {
  const { db } = await requireAdmin(req);
  const input = parseThemeInput(await readJson(req));
  return json(await saveTheme(db, input), input.id ? 200 : 201);
});

export const DELETE = route(async (req) => {
  const { db } = await requireAdmin(req);
  await deleteTheme(db, themeId((await readJson(req)).id));
  return json({ ok: true });
});
