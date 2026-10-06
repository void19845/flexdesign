"use client";

import type { CSSProperties } from "react";
import { useFontFaces } from "@/lib/client/fonts";
import { deriveShades } from "@/lib/shared/color";
import { COLOR_ROLES, type Font, type ThemeInput } from "@/lib/shared/types";

export type Mode = "light" | "dark";

/** Aperçu en direct du brouillon : variables CSS posées sur le conteneur à partir des couleurs déjà validées. */
export function ThemePreview({
  draft,
  fonts,
  mode,
  onModeChange,
}: {
  draft: ThemeInput;
  fonts: Font[];
  mode: Mode;
  onModeChange: (mode: Mode) => void;
}) {
  useFontFaces(fonts);
  const palette = mode === "dark" && draft.hasDark && draft.dark ? draft.dark : draft.light;
  const vars: Record<string, string> = {};
  for (const role of COLOR_ROLES) vars[`--p-${role}`] = palette[role];
  for (const [name, hex] of Object.entries(deriveShades(palette, mode))) vars[`--p-${name}`] = hex;
  // Familles validées côté serveur ; sans police choisie, la variable reste absente et la police de l'appli s'applique
  for (const f of draft.fonts) {
    const font = fonts.find((x) => x.id === f.fontId);
    if (font) vars[`--p-font-${f.role}`] = `"${font.family}", ${f.fallback}`;
  }

  return (
    <div className="preview-wrap">
      <div className="preview-head">
        <h3>Aperçu</h3>
        {draft.hasDark && (
          <nav className="tabs compact" role="tablist">
            <button type="button" className="btn tab small" role="tab" aria-selected={mode === "light"} onClick={() => onModeChange("light")}>
              Clair
            </button>
            <button type="button" className="btn tab small" role="tab" aria-selected={mode === "dark"} onClick={() => onModeChange("dark")}>
              Sombre
            </button>
          </nav>
        )}
      </div>
      <div className="preview" style={vars as CSSProperties}>
        <div className="preview-bar">
          <strong>Mon appli</strong>
          <span>Accueil</span>
          <span>Contact</span>
        </div>
        <div className="preview-body">
          <h1>Titre principal</h1>
          <h2>Sous-titre de section</h2>
          <p>Texte courant : voici à quoi ressemble un paragraphe avec ce thème.</p>
          <p className="preview-muted">Texte secondaire, pour les précisions et les dates.</p>
          <div className="preview-actions">
            <button type="button" className="preview-btn">
              Bouton principal
            </button>
            <span className="preview-badge">Accent</span>
          </div>
          <p className="preview-alert success">Enregistrement réussi.</p>
          <p className="preview-alert warning">Attention, vérifiez ce champ.</p>
          <p className="preview-alert danger">Une erreur est survenue.</p>
          <code className="preview-code">const theme = &quot;{draft.name || "nouveau"}&quot;;</code>
          {draft.named.length > 0 && (
            <ul className="preview-named">
              {draft.named.map((c, i) => (
                <li key={i}>
                  <span className="swatch" style={{ background: c.hex }} />
                  {c.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
