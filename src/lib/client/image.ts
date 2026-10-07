import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE } from "@/lib/shared/types";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
}

/**
 * Prépare une image avant l'envoi : GIF gardé tel quel (animation), autres formats réduits
 * (côté le plus long à MAX_IMAGE_SIDE) et réencodés en WebP, ou en JPEG si le navigateur ne sait pas.
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; widthPx: number; heightPx: number }> {
  if (!ACCEPTED.includes(file.type)) throw new Error("seules les images JPEG, PNG, WebP et GIF sont acceptées");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("image illisible");
  }
  let result: { blob: Blob; widthPx: number; heightPx: number };
  try {
    if (file.type === "image/gif") {
      result = { blob: file, widthPx: bitmap.width, heightPx: bitmap.height };
    } else {
      const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("préparation de l'image impossible");
      ctx.drawImage(bitmap, 0, 0, width, height);
      let blob = await toBlob(canvas, "image/webp");
      if (!blob || blob.type !== "image/webp") {
        // Le JPEG n'a pas de transparence : fond blanc sous l'image plutôt que noir
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
        blob = await toBlob(canvas, "image/jpeg");
      }
      if (!blob) throw new Error("préparation de l'image impossible");
      result = { blob, widthPx: width, heightPx: height };
    }
  } finally {
    bitmap.close();
  }
  if (result.blob.size > MAX_IMAGE_BYTES) throw new Error("image trop lourde : 5 Mo maximum");
  return result;
}
