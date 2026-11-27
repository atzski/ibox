/**
 * Couleurs calculées à l'exécution (thèmes, cartes de console) sur une WebView Android ancienne :
 * `color-mix()` et `light-dark()` y rendraient la déclaration invalide (fond vide, texte
 * invisible). `compat` les remplace alors par leur repli (`theme/colorMix.ts`) ; sur un moteur
 * récent (Windows, Steam Deck, Android à jour) la valeur est rendue telle quelle.
 */
import type { CSSProperties } from "react";
import { lightDarkFallback, mixFallback } from "./colorMix";

const supports = (value: string) => typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("color", value);
const HAS_MIX = supports("color-mix(in srgb, red, blue)");
const HAS_LIGHT_DARK = supports("light-dark(red, blue)");

/** Thème sombre en cours (`data-theme`, posé par `app/App.tsx`). */
function darkTheme(): boolean {
  const theme = document.documentElement.dataset.theme;
  if (theme === "dark") return true;
  if (theme === "system") return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  return false;
}

/** Valeur CSS utilisable par le moteur courant. */
export function compat(value: string): string {
  let out = value;
  if (!HAS_LIGHT_DARK && out.includes("light-dark(")) out = lightDarkFallback(out, darkTheme());
  if (!HAS_MIX && out.includes("color-mix(")) out = mixFallback(out);
  return out;
}

/** `compat` appliqué à chaque valeur texte d'un objet de style. */
export function compatStyle<T extends CSSProperties | Record<string, string>>(style: T): T {
  if (HAS_MIX && HAS_LIGHT_DARK) return style;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style)) out[k] = typeof v === "string" ? compat(v) : v;
  return out as T;
}
