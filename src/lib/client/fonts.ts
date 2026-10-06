import { useEffect } from "react";
import type { Font } from "@/lib/shared/types";

/** Adresses des fichiers déjà déclarés au navigateur : chacun ne l'est qu'une fois pour toute la page. */
const registered = new Set<string>();

/**
 * Déclare les fichiers des polices au navigateur (FontFace). Il ne les télécharge qu'au premier texte qui les
 * utilise ; si un fichier ne charge pas, la police de secours s'applique.
 */
export function useFontFaces(fonts: Font[]): void {
  useEffect(() => {
    for (const font of fonts) {
      for (const file of font.files) {
        if (registered.has(file.url)) continue;
        registered.add(file.url);
        const face = new FontFace(font.family, `url("${file.url}") format("${file.format}")`, {
          weight: String(file.weight),
          style: file.style,
          ...(file.unicodeRange ? { unicodeRange: file.unicodeRange } : {}),
        });
        document.fonts.add(face);
      }
    }
  }, [fonts]);
}
