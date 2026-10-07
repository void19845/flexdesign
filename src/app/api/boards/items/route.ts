import { addItem, deleteItem, uuid } from "@/lib/server/boards";
import { HttpError, json, readJson, requireStaff, route } from "@/lib/server/http";
import { MAX_IMAGE_BYTES } from "@/lib/shared/types";

/**
 * Ajout d'une image (multipart) : boardId, file (déjà réduite par le navigateur), widthPx, heightPx (taille
 * de l'image), x, y, w (place sur la toile). Propriétaire ou membre en modification.
 */
export const POST = route(async (req) => {
  const { db, userId } = await requireStaff(req);
  // Refus avant de lire le corps
  if (Number(req.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES + 64 * 1024) throw new HttpError(413, "Image trop lourde : 5 Mo maximum");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Formulaire invalide");
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "Choisis une image");
  if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "Image trop lourde : 5 Mo maximum");
  const item = await addItem(db, userId, {
    boardId: uuid(form.get("boardId"), "Moodboard"),
    bytes: new Uint8Array(await file.arrayBuffer()),
    widthPx: form.get("widthPx"),
    heightPx: form.get("heightPx"),
    x: form.get("x"),
    y: form.get("y"),
    w: form.get("w"),
  });
  return json(item, 201);
});

export const DELETE = route(async (req) => {
  const { db, userId } = await requireStaff(req);
  await deleteItem(db, userId, uuid((await readJson(req)).id, "Image"));
  return json({ ok: true });
});
