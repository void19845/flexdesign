import { SHADED_ROLES, type ColorRole, type DerivedPalette, type Palette } from "./types";

/** #rgb ou #rrggbb (casse libre) -> #rrggbb en minuscules ; null si la valeur n'est pas une couleur hexadécimale. */
export function normalizeHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return null;
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Mélange de deux couleurs #rrggbb : part de b entre 0 et 1. */
export function mix(a: string, b: string, part: number): string {
  const ca = channels(a);
  const cb = channels(b);
  return `#${ca.map((x, i) => Math.round(x + (cb[i] - x) * part).toString(16).padStart(2, "0")).join("")}`;
}

/** Luminance relative WCAG 2.x */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste WCAG 2.x, de 1 à 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Paires vérifiées : 4,5:1 minimum pour du texte courant, 3:1 pour les gros titres. */
export const CONTRAST_PAIRS: { fg: ColorRole; bg: ColorRole; label: string }[] = [
  { fg: "text", bg: "background", label: "Texte sur fond" },
  { fg: "text", bg: "surface", label: "Texte sur surface" },
  { fg: "onPrimary", bg: "primary", label: "Texte sur couleur principale" },
  { fg: "onAccent", bg: "accent", label: "Texte sur accent" },
  { fg: "muted", bg: "background", label: "Texte secondaire sur fond" },
];

/**
 * Nuances publiées avec le thème, en hexadécimal (utilisables aussi dans un canvas ou un PDF) :
 * survol = un peu plus sombre en clair, un peu plus clair en sombre ; fond léger = la couleur à 14 % sur le fond.
 */
export function deriveShades(palette: Palette, mode: "light" | "dark"): DerivedPalette {
  const out = {} as DerivedPalette;
  for (const role of SHADED_ROLES) {
    out[`${role}Hover`] = mix(palette[role], mode === "light" ? "#000000" : "#ffffff", 0.15);
    out[`${role}Soft`] = mix(palette.background, palette[role], 0.14);
  }
  return out;
}
