"use client";

import { useState } from "react";
import { ThemeEditor } from "@/components/theme-editor";
import type { Font, Theme } from "@/lib/shared/types";

/** Liste des thèmes ; un clic ouvre l'éditeur. n change à chaque ouverture : l'éditeur repart d'un brouillon neuf. */
export function ThemesPanel({
  themes,
  fonts,
  canEdit,
  onThemesChange,
  onAuthError,
}: {
  themes: Theme[];
  fonts: Font[];
  canEdit: boolean;
  onThemesChange: (themes: Theme[]) => void;
  onAuthError: (message: string) => void;
}) {
  const [open, setOpen] = useState<{ n: number; theme: Theme | null } | null>(null);

  function edit(theme: Theme | null): void {
    setOpen((o) => ({ n: (o?.n ?? 0) + 1, theme }));
  }

  function saved(theme: Theme): void {
    const others = themes.filter((t) => t.id !== theme.id);
    onThemesChange([...others, theme].sort((a, b) => a.name.localeCompare(b.name, "fr")));
  }

  if (open) {
    return (
      <ThemeEditor
        key={open.n}
        theme={open.theme}
        fonts={fonts}
        canEdit={canEdit}
        onClose={() => setOpen(null)}
        onSaved={saved}
        onDeleted={(id) => {
          onThemesChange(themes.filter((t) => t.id !== id));
          setOpen(null);
        }}
        onAuthError={onAuthError}
      />
    );
  }

  return (
    <section>
      <div className="section-head">
        <h2>Thèmes</h2>
        {canEdit && (
          <button type="button" className="btn primary small" onClick={() => edit(null)}>
            Nouveau thème
          </button>
        )}
      </div>
      {themes.length === 0 ? (
        <p className="card muted">
          {canEdit ? "Aucun thème pour l'instant. Créez le premier avec « Nouveau thème »." : "Aucun thème pour l'instant."}
        </p>
      ) : (
        <ul className="theme-list">
          {themes.map((t) => (
            <li key={t.id}>
              <button type="button" className="theme-card" onClick={() => edit(t)}>
                <span className="theme-swatches">
                  {(["background", "primary", "accent", "text"] as const).map((role) => (
                    <span key={role} className="swatch" style={{ background: t.light[role] }} />
                  ))}
                </span>
                <strong>{t.name}</strong>
                {t.hasDark && <span className="badge">sombre</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
