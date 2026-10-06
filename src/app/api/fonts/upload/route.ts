import { fontId, uploadFont } from "@/lib/server/fonts";
import { HttpError, json, requireAdmin, route } from "@/lib/server/http";
import { MAX_FONT_BYTES, MAX_FONT_LABEL_LENGTH } from "@/lib/shared/types";

/**
 * Envoi d'une police par l'équipe (multipart) : file, weight, style, license (case cochée obligatoire),
 * puis label pour une nouvelle police ou fontId pour compléter une police déjà envoyée. Admin seulement.
 */
export const POST = route(async (req) => {
  const { db } = await requireAdmin(req);
  // Refus avant de lire le corps : un fichier de police dépasse rarement quelques centaines de Ko
  if (Number(req.headers.get("content-length") ?? 0) > MAX_FONT_BYTES + 64 * 1024) throw new HttpError(413, "Fichier trop lourd : 2 Mo maximum");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Formulaire invalide");
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "Choisis un fichier de police");
  if (file.size > MAX_FONT_BYTES) throw new HttpError(413, "Fichier trop lourd : 2 Mo maximum");
  if (form.get("license") !== "on") throw new HttpError(400, "Coche la case : l'équipe doit détenir la licence de cette police (usage web et PDF)");
  const weight = Number(form.get("weight"));
  if (!Number.isInteger(weight) || weight < 100 || weight > 900 || weight % 100 !== 0) throw new HttpError(400, "Graisse invalide (100 à 900)");
  const style = form.get("style");
  if (style !== "normal" && style !== "italic") throw new HttpError(400, "Style invalide");

  const rawId = form.get("fontId");
  const existing = typeof rawId === "string" && rawId ? fontId(rawId) : null;
  const label = typeof form.get("label") === "string" ? (form.get("label") as string).trim().replace(/\s+/g, " ") : "";
  if (!existing && (!label || label.length > MAX_FONT_LABEL_LENGTH)) throw new HttpError(400, `Nom de la police requis (${MAX_FONT_LABEL_LENGTH} caractères max)`);

  const bytes = new Uint8Array(await file.arrayBuffer());
  return json(await uploadFont(db, { bytes, weight, style, label, fontId: existing }), 201);
});
