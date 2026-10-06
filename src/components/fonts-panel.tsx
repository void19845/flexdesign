"use client";

import { useRef, useState, type FormEvent } from "react";
import { api, isAuthError, post, postForm } from "@/lib/client/api";
import { useFontFaces } from "@/lib/client/fonts";
import { MAX_FONT_BYTES, MAX_FONT_LABEL_LENGTH, type CatalogFont, type Font } from "@/lib/shared/types";

const SAMPLE = "Portez ce vieux whisky au juge blond qui fume.";
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const CATEGORY_LABELS: Record<string, string> = {
  "sans-serif": "Sans empattement",
  serif: "Avec empattement",
  display: "Titrage",
  handwriting: "Manuscrite",
  monospace: "Chasse fixe",
};

const family = (font: Font) => `"${font.family}", sans-serif`;
const licenseLabel = (license: string) => (license === "own" ? "Licence détenue par l'équipe" : `Licence ${license}`);

/** Couples graisse / style disponibles (les sous-ensembles du catalogue donnent plusieurs fichiers par couple). */
function variants(font: Font): { weight: number; style: string }[] {
  const seen = new Set<string>();
  return font.files.filter((f) => !seen.has(`${f.weight}-${f.style}`) && seen.add(`${f.weight}-${f.style}`));
}

/** Graisses cochées par défaut : 400 et 700 si disponibles, sinon la première. */
function defaultWeights(font: CatalogFont): number[] {
  const picked = [400, 700].filter((w) => font.weights.includes(w));
  return picked.length ? picked : font.weights.slice(0, 1);
}

/** Polices de la suite (admin) : liste, copie depuis le catalogue Google Fonts, envoi d'un fichier. */
export function FontsPanel({ fonts, onFontsChange, onAuthError }: { fonts: Font[]; onFontsChange: (fonts: Font[]) => void; onAuthError: (message: string) => void }) {
  useFontFaces(fonts);

  const [listError, setListError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const [results, setResults] = useState<CatalogFont[] | null>(null);
  const [choices, setChoices] = useState<Record<string, { weights: number[]; italic: boolean }>>({});
  const [searching, setSearching] = useState(false);
  const [copying, setCopying] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState("");

  const [uploadTarget, setUploadTarget] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const uploadForm = useRef<HTMLFormElement>(null);
  const target = uploadTarget ? fonts.find((f) => f.id === uploadTarget) : undefined;

  function fail(err: unknown, show: (message: string) => void): void {
    if (isAuthError(err)) onAuthError(err.message);
    else show((err as Error).message);
  }

  /** Remplace ou ajoute la police renvoyée par le serveur, dans l'ordre des noms. */
  function saveFont(font: Font): void {
    onFontsChange([...fonts.filter((f) => f.id !== font.id), font].sort((a, b) => a.label.localeCompare(b.label)));
  }

  async function remove(font: Font): Promise<void> {
    if (!window.confirm(`Supprimer la police « ${font.label} » et ses fichiers ?`)) return;
    setDeleting(font.id);
    setListError("");
    try {
      await post("/api/fonts", { id: font.id }, "DELETE");
      onFontsChange(fonts.filter((f) => f.id !== font.id));
      if (uploadTarget === font.id) setUploadTarget(null);
    } catch (err) {
      fail(err, setListError);
    }
    setDeleting(null);
  }

  function addFile(font: Font): void {
    setUploadTarget(font.id);
    setUploadError("");
    uploadForm.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function search(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
    setSearching(true);
    setCatalogError("");
    try {
      const found = await api<CatalogFont[]>(`/api/fonts/catalog?q=${encodeURIComponent(q)}`);
      setResults(found);
      setChoices(Object.fromEntries(found.map((f) => [f.id, { weights: defaultWeights(f), italic: false }])));
    } catch (err) {
      fail(err, setCatalogError);
    }
    setSearching(false);
  }

  function toggleWeight(id: string, weight: number): void {
    setChoices((c) => {
      const weights = c[id].weights.includes(weight) ? c[id].weights.filter((w) => w !== weight) : [...c[id].weights, weight];
      return { ...c, [id]: { ...c[id], weights } };
    });
  }

  async function copy(font: CatalogFont): Promise<void> {
    setCopying(font.id);
    setCatalogError("");
    try {
      saveFont(await post<Font>("/api/fonts/catalog", { id: font.id, ...choices[font.id] }));
    } catch (err) {
      fail(err, setCatalogError);
    }
    setCopying(null);
  }

  async function upload(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (file instanceof File && file.size > MAX_FONT_BYTES) {
      setUploadError("Fichier trop lourd : 2 Mo maximum");
      return;
    }
    if (target) data.set("fontId", target.id);
    setUploading(true);
    setUploadError("");
    try {
      saveFont(await postForm<Font>("/api/fonts/upload", data));
      form.reset();
    } catch (err) {
      fail(err, setUploadError);
    }
    setUploading(false);
  }

  return (
    <>
      <section className="card">
        <h2>Polices de la suite</h2>
        {fonts.length === 0 && <p className="muted">Aucune police pour le moment.</p>}
        <ul className="font-list">
          {fonts.map((font) => (
            <li key={font.id} className="font-item">
              <div className="font-head">
                <div>
                  <h3>{font.label}</h3>
                  <p className="muted small">
                    {font.source === "catalog" ? "Catalogue Google Fonts" : "Envoyée par l'équipe"} - {licenseLabel(font.license)}
                  </p>
                </div>
                <div className="font-actions">
                  {font.source === "upload" && (
                    <button type="button" className="btn ghost small" onClick={() => addFile(font)}>
                      Ajouter un fichier
                    </button>
                  )}
                  <button type="button" className="btn ghost small" onClick={() => void remove(font)} disabled={deleting === font.id}>
                    Supprimer
                  </button>
                </div>
              </div>
              <p className="font-sample" style={{ fontFamily: family(font) }}>
                {SAMPLE}
              </p>
              <ul className="font-variants">
                {variants(font).map((v) => (
                  <li key={`${v.weight}-${v.style}`} style={{ fontFamily: family(font), fontWeight: v.weight, fontStyle: v.style }}>
                    {v.weight}
                    {v.style === "italic" ? " italique" : ""}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="error" role="alert">
          {listError}
        </p>
      </section>

      <section className="card">
        <h2>Ajouter depuis le catalogue</h2>
        <p className="muted small">
          Catalogue Google Fonts, sous licence libre. Les fichiers choisis sont copiés une fois dans le stockage de la suite : le navigateur des visiteurs ne contacte jamais Google.
        </p>
        <form className="font-search" onSubmit={search}>
          <input name="q" type="search" placeholder="Nom de la police (ex. Inter)" minLength={2} maxLength={80} required aria-label="Nom de la police" />
          <button type="submit" className="btn primary" disabled={searching}>
            Chercher
          </button>
        </form>
        {results && results.length === 0 && <p className="muted">Aucune police trouvée.</p>}
        {results && results.length > 0 && (
          <ul className="catalog-list">
            {results.map((font) => {
              const choice = choices[font.id];
              const copied = fonts.some((f) => f.source === "catalog" && f.family === font.family);
              return (
                <li key={font.id} className="catalog-item">
                  <div>
                    <h3>{font.family}</h3>
                    <p className="muted small">
                      {CATEGORY_LABELS[font.category] ?? font.category} - Licence {font.license}
                    </p>
                  </div>
                  <div className="catalog-weights">
                    {font.weights.map((w) => (
                      <label key={w} className="check">
                        <input type="checkbox" checked={choice.weights.includes(w)} onChange={() => toggleWeight(font.id, w)} />
                        {w}
                      </label>
                    ))}
                    {font.italic && (
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={choice.italic}
                          onChange={(e) => {
                            const italic = e.currentTarget.checked;
                            setChoices((c) => ({ ...c, [font.id]: { ...c[font.id], italic } }));
                          }}
                        />
                        Italique
                      </label>
                    )}
                  </div>
                  <button type="button" className="btn primary small" onClick={() => void copy(font)} disabled={copying !== null || choice.weights.length === 0}>
                    {copying === font.id ? "Copie en cours..." : copied ? "Ajouter les graisses" : "Copier"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="error" role="alert">
          {catalogError}
        </p>
      </section>

      <form ref={uploadForm} className="card" onSubmit={upload}>
        <h2>{target ? `Ajouter un fichier à « ${target.label} »` : "Envoyer une police"}</h2>
        {target && (
          <p>
            <button type="button" className="btn ghost small" onClick={() => setUploadTarget(null)}>
              Envoyer plutôt une nouvelle police
            </button>
          </p>
        )}
        <label className="field">
          <span>Fichier (woff2, woff, ttf ou otf, 2 Mo maximum)</span>
          <input name="file" type="file" accept=".woff2,.woff,.ttf,.otf" required />
        </label>
        {!target && (
          <label className="field">
            <span>Nom de la police</span>
            <input name="label" type="text" maxLength={MAX_FONT_LABEL_LENGTH} required />
          </label>
        )}
        <div className="font-upload-row">
          <label className="field">
            <span>Graisse</span>
            <select name="weight" defaultValue="400">
              {WEIGHTS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Style</span>
            <select name="style" defaultValue="normal">
              <option value="normal">Normal</option>
              <option value="italic">Italique</option>
            </select>
          </label>
        </div>
        <label className="check">
          <input name="license" type="checkbox" required />
          {"L'équipe détient la licence de cette police, y compris pour le web et le PDF"}
        </label>
        <p className="muted small">Les polices commerciales interdisent souvent l&apos;usage sur le web ou dans un PDF : vérifie la licence avant d&apos;envoyer.</p>
        <p className="error" role="alert">
          {uploadError}
        </p>
        <button type="submit" className="btn primary" disabled={uploading}>
          {uploading ? "Envoi en cours..." : "Envoyer"}
        </button>
      </form>
    </>
  );
}
