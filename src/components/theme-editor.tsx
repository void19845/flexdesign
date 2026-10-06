"use client";

import { useState, type KeyboardEvent } from "react";
import { ThemePreview, type Mode } from "@/components/theme-preview";
import { isAuthError, post } from "@/lib/client/api";
import { CONTRAST_PAIRS, contrastRatio, deriveShades, normalizeHex } from "@/lib/shared/color";
import {
  COLOR_ROLES,
  FALLBACKS,
  FONT_ROLES,
  MAX_NAMED_COLORS,
  MAX_THEME_NAME_LENGTH,
  NAMED_COLOR_PATTERN,
  SHADED_ROLES,
  type ColorRole,
  type Fallback,
  type Font,
  type FontRole,
  type NamedColor,
  type Palette,
  type Theme,
  type ThemeInput,
} from "@/lib/shared/types";

const ROLE_LABELS: Record<ColorRole, string> = {
  background: "Fond",
  surface: "Surface",
  text: "Texte",
  muted: "Texte secondaire",
  border: "Bordure",
  primary: "Principale",
  onPrimary: "Texte sur principale",
  accent: "Accent",
  onAccent: "Texte sur accent",
  success: "Succès",
  warning: "Avertissement",
  danger: "Danger",
};

const FONT_LABELS: Record<FontRole, string> = { heading: "Titres", body: "Texte", accent: "Accent", mono: "Chasse fixe" };

const DEFAULT_LIGHT: Palette = {
  background: "#ffffff",
  surface: "#f6f6f8",
  text: "#1c1b22",
  muted: "#5f5d6b",
  border: "#e2e1e8",
  primary: "#4f46e5",
  onPrimary: "#ffffff",
  accent: "#f59e0b",
  onAccent: "#1c1b22",
  success: "#15803d",
  warning: "#b45309",
  danger: "#dc2626",
};

const DEFAULT_DARK: Palette = {
  background: "#15141a",
  surface: "#1f1e26",
  text: "#f1f0f5",
  muted: "#a5a3b3",
  border: "#34323e",
  primary: "#818cf8",
  onPrimary: "#15141a",
  accent: "#fbbf24",
  onAccent: "#15141a",
  success: "#4ade80",
  warning: "#fbbf24",
  danger: "#f87171",
};

const NEW_THEME: ThemeInput = { name: "", hasDark: false, light: DEFAULT_LIGHT, dark: null, named: [], fonts: [] };

function toInput(theme: Theme): ThemeInput {
  return { id: theme.id, name: theme.name, hasDark: theme.hasDark, light: theme.light, dark: theme.dark, named: theme.named, fonts: theme.fonts };
}

/** Police de secours proposée selon la catégorie de la police choisie. */
function defaultFallback(category: string): Fallback {
  if (category === "monospace") return "monospace";
  if (category === "serif") return "serif";
  if (category === "handwriting") return "cursive";
  return "sans-serif";
}

/** Niveau WCAG : 4,5:1 pour le texte courant, 3:1 pour les gros titres. */
function contrastLevel(ratio: number): { label: string; className: string } {
  if (ratio >= 4.5) return { label: "OK", className: "ok" };
  if (ratio >= 3) return { label: "Gros titres seulement", className: "large" };
  return { label: "Insuffisant", className: "fail" };
}

/** Rapport arrondi vers le bas (jamais affiché au-dessus du seuil qu'il n'atteint pas), ex. 4,4:1. */
function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1).replace(".", ",")}:1`;
}

/** Couleur : nuancier, ou saisie #rgb / #rrggbb validée à la sortie du champ ou sur Entrée. */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const [invalid, setInvalid] = useState(false);

  function commit(input: HTMLInputElement): void {
    const hex = normalizeHex(input.value);
    setInvalid(!hex);
    if (!hex) return;
    if (hex === value) input.value = hex;
    else onChange(hex);
  }

  return (
    <div className="color-field">
      <span className="color-label">{label}</span>
      <div className="color-inputs">
        <input
          type="color"
          value={value}
          aria-label={`${label}, nuancier`}
          onChange={(e) => {
            setInvalid(false);
            onChange(e.target.value);
          }}
        />
        {/* key : le champ repart de la valeur enregistrée après chaque changement */}
        <input
          key={value}
          type="text"
          className={invalid ? "invalid" : undefined}
          defaultValue={value}
          maxLength={7}
          spellCheck={false}
          aria-label={`${label}, code hexadécimal`}
          aria-invalid={invalid}
          onBlur={(e) => commit(e.currentTarget)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") commit(e.currentTarget);
          }}
        />
      </div>
    </div>
  );
}

/** Éditeur d'un thème avec aperçu. Le staff voit le même écran, en lecture seule (le serveur refuse ses écritures). */
export function ThemeEditor({
  theme,
  fonts,
  canEdit,
  onClose,
  onSaved,
  onDeleted,
  onAuthError,
}: {
  theme: Theme | null;
  fonts: Font[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: (theme: Theme) => void;
  onDeleted: (id: string) => void;
  onAuthError: (message: string) => void;
}) {
  const [draft, setDraft] = useState<ThemeInput>(theme ? toInput(theme) : NEW_THEME);
  const [mode, setMode] = useState<Mode>("light");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const readOnly = !canEdit;
  const palette = mode === "dark" && draft.hasDark && draft.dark ? draft.dark : draft.light;
  const shades = deriveShades(palette, mode);

  function update(change: Partial<ThemeInput>): void {
    setDraft((d) => ({ ...d, ...change }));
    setStatus("");
  }

  function setColor(role: ColorRole, hex: string): void {
    if (mode === "dark" && draft.dark) update({ dark: { ...draft.dark, [role]: hex } });
    else update({ light: { ...draft.light, [role]: hex } });
  }

  function toggleDark(on: boolean): void {
    update({ hasDark: on, dark: draft.dark ?? DEFAULT_DARK });
    setMode(on ? "dark" : "light");
  }

  function setNamed(index: number, change: Partial<NamedColor>): void {
    update({ named: draft.named.map((c, i) => (i === index ? { ...c, ...change } : c)) });
  }

  function addNamed(): void {
    let n = draft.named.length + 1;
    while (draft.named.some((c) => c.name === `couleur-${n}`)) n++;
    update({ named: [...draft.named, { name: `couleur-${n}`, hex: draft.light.primary }] });
  }

  function setFont(role: FontRole, fontId: string): void {
    const others = draft.fonts.filter((f) => f.role !== role);
    const font = fonts.find((f) => f.id === fontId);
    update({ fonts: font ? [...others, { role, fontId, fallback: defaultFallback(font.category) }] : others });
  }

  function setFallback(role: FontRole, fallback: Fallback): void {
    update({ fonts: draft.fonts.map((f) => (f.role === role ? { ...f, fallback } : f)) });
  }

  function fail(err: unknown): void {
    if (isAuthError(err)) onAuthError(err.message);
    else setError((err as Error).message);
  }

  async function save(): Promise<void> {
    setPending(true);
    setError("");
    try {
      const saved = await post<Theme>("/api/themes", { ...draft, dark: draft.hasDark ? draft.dark : null });
      setDraft(toInput(saved));
      setStatus("Thème enregistré.");
      onSaved(saved);
    } catch (err) {
      fail(err);
    }
    setPending(false);
  }

  async function remove(): Promise<void> {
    const id = draft.id;
    if (!id || !window.confirm(`Supprimer le thème « ${draft.name} » ? Les applis liées reprendront leur apparence.`)) return;
    setPending(true);
    setError("");
    try {
      await post("/api/themes", { id }, "DELETE");
      onDeleted(id);
    } catch (err) {
      fail(err);
      setPending(false);
    }
  }

  return (
    <div className="editor">
      <header className="editor-head">
        <h2>{draft.id ? draft.name || "Thème" : "Nouveau thème"}</h2>
        <div className="topbar-actions">
          {canEdit && (
            <>
              <button type="button" className="btn primary small" onClick={save} disabled={pending}>
                Enregistrer
              </button>
              {draft.id && (
                <button type="button" className="btn ghost small danger-text" onClick={remove} disabled={pending}>
                  Supprimer
                </button>
              )}
            </>
          )}
          <button type="button" className="btn ghost small" onClick={onClose}>
            Fermer
          </button>
        </div>
      </header>
      {readOnly && <p className="muted small">Lecture seule : seuls les admins de Flexdesign modifient les thèmes.</p>}
      <p className="error" role="alert">
        {error}
      </p>
      <p className="muted small" role="status">
        {status}
      </p>

      <div className="editor-layout">
        <div className="editor-form">
          <section className="card">
            <fieldset className="plain" disabled={readOnly}>
              <label className="field">
                <span>Nom</span>
                <input value={draft.name} maxLength={MAX_THEME_NAME_LENGTH} required onChange={(e) => update({ name: e.target.value })} />
              </label>
            </fieldset>
          </section>

          <section className="card">
            <h3>Couleurs</h3>
            <fieldset className="plain" disabled={readOnly}>
              <label className="check">
                <input type="checkbox" checked={draft.hasDark} onChange={(e) => toggleDark(e.target.checked)} />
                Variante sombre
              </label>
            </fieldset>
            {draft.hasDark && (
              <nav className="tabs" role="tablist">
                <button type="button" className="btn tab" role="tab" aria-selected={mode === "light"} onClick={() => setMode("light")}>
                  Clair
                </button>
                <button type="button" className="btn tab" role="tab" aria-selected={mode === "dark"} onClick={() => setMode("dark")}>
                  Sombre
                </button>
              </nav>
            )}
            <fieldset className="plain" disabled={readOnly}>
              <div className="color-grid">
                {COLOR_ROLES.map((role) => (
                  <ColorField key={role} label={ROLE_LABELS[role]} value={palette[role]} onChange={(hex) => setColor(role, hex)} />
                ))}
              </div>
            </fieldset>

            <h3>Nuances calculées</h3>
            <p className="muted small">Survol et fond léger, recalculés à chaque enregistrement.</p>
            <ul className="shade-grid">
              {SHADED_ROLES.flatMap((role) => [
                <li key={`${role}Hover`}>
                  <span className="swatch" style={{ background: shades[`${role}Hover`] }} />
                  {ROLE_LABELS[role]}, survol
                </li>,
                <li key={`${role}Soft`}>
                  <span className="swatch" style={{ background: shades[`${role}Soft`] }} />
                  {ROLE_LABELS[role]}, fond léger
                </li>,
              ])}
            </ul>

            <h3>Contraste</h3>
            <ul className="contrast-list">
              {CONTRAST_PAIRS.map((pair) => {
                const ratio = contrastRatio(palette[pair.fg], palette[pair.bg]);
                const level = contrastLevel(ratio);
                return (
                  <li key={`${pair.fg}-${pair.bg}`}>
                    <span className="contrast-sample" style={{ background: palette[pair.bg], color: palette[pair.fg] }}>
                      Aa
                    </span>
                    <span className="contrast-name">{pair.label}</span>
                    <span className="contrast-ratio">{formatRatio(ratio)}</span>
                    <span className={`badge contrast-${level.className}`}>{level.label}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card">
            <h3>Couleurs nommées</h3>
            <p className="muted small">
              {`Jusqu'à ${MAX_NAMED_COLORS} couleurs libres, une seule valeur pour les deux modes. Nom : minuscules, chiffres et tirets.`}
            </p>
            <fieldset className="plain" disabled={readOnly}>
              {draft.named.map((c, i) => (
                <div key={i} className="named-row">
                  <input
                    value={c.name}
                    maxLength={32}
                    spellCheck={false}
                    aria-label="Nom de la couleur"
                    className={NAMED_COLOR_PATTERN.test(c.name) ? undefined : "invalid"}
                    aria-invalid={!NAMED_COLOR_PATTERN.test(c.name)}
                    onChange={(e) => setNamed(i, { name: e.target.value.toLowerCase() })}
                  />
                  <ColorField label={c.name || "Couleur nommée"} value={c.hex} onChange={(hex) => setNamed(i, { hex })} />
                  {canEdit && (
                    <button type="button" className="btn ghost small" onClick={() => update({ named: draft.named.filter((_, j) => j !== i) })}>
                      Retirer
                    </button>
                  )}
                </div>
              ))}
              {canEdit && (
                <button type="button" className="btn small" onClick={addNamed} disabled={draft.named.length >= MAX_NAMED_COLORS}>
                  Ajouter une couleur
                </button>
              )}
            </fieldset>
          </section>

          <section className="card">
            <h3>Polices</h3>
            <p className="muted small">Les polices se gèrent dans l&apos;onglet Polices. La police de secours sert si le fichier ne charge pas.</p>
            <fieldset className="plain" disabled={readOnly}>
              {FONT_ROLES.map((role) => {
                const entry = draft.fonts.find((f) => f.role === role);
                return (
                  <div key={role} className="font-row">
                    <span className="font-role">{FONT_LABELS[role]}</span>
                    <select value={entry?.fontId ?? ""} aria-label={`Police : ${FONT_LABELS[role]}`} onChange={(e) => setFont(role, e.target.value)}>
                      <option value="">{"Aucune (police de l'appli)"}</option>
                      {fonts.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={entry?.fallback ?? "sans-serif"}
                      aria-label={`Police de secours : ${FONT_LABELS[role]}`}
                      disabled={!entry}
                      onChange={(e) => setFallback(role, e.target.value as Fallback)}
                    >
                      {FALLBACKS.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </fieldset>
          </section>
        </div>

        <aside className="editor-preview">
          <ThemePreview draft={draft} fonts={fonts} mode={mode} onModeChange={setMode} />
        </aside>
      </div>
    </div>
  );
}
