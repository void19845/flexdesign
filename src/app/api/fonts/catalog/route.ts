import { copyFromCatalog, searchCatalog } from "@/lib/server/fonts";
import { HttpError, json, readJson, requireAdmin, route, str } from "@/lib/server/http";

/** Recherche dans le catalogue Google Fonts (via Fontsource). Admin seulement. */
export const GET = route(async (req) => {
  await requireAdmin(req);
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.length > 80) throw new HttpError(400, "Recherche trop longue");
  return json(await searchCatalog(q));
});

/** Copie une police du catalogue dans le bucket design-fonts. Admin seulement. */
export const POST = route(async (req) => {
  const { db } = await requireAdmin(req);
  const body = await readJson(req);
  const id = str(body.id);
  if (!/^[a-z0-9-]{1,80}$/.test(id)) throw new HttpError(400, "Police du catalogue invalide");
  const weights = Array.isArray(body.weights) ? body.weights.filter((w): w is number => Number.isInteger(w) && w >= 100 && w <= 900 && w % 100 === 0) : [];
  if (!weights.length) throw new HttpError(400, "Choisis au moins une graisse");
  return json(await copyFromCatalog(db, id, [...new Set(weights)], body.italic === true), 201);
});
