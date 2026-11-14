import type { CSSProperties } from "react";
import type { Platform } from "@/domain/types";
import { alpha } from "@/art/paint";

/** Variables CSS d'accent dérivées du thème d'une console. */
export function themeVars(platform?: Platform): CSSProperties {
  if (!platform) return {};
  const t = platform.theme;
  return {
    "--accent": t.primary,
    // fonds teintés : pastel clair le jour, teinte profonde la nuit
    "--accent-soft": `light-dark(${t.soft}, color-mix(in oklab, ${t.primary} 20%, #252b3b))`,
    "--accent-deep": t.deep,
    "--accent-text": `light-dark(${t.deep}, color-mix(in oklab, ${t.primary} 75%, #ffffff))`,
    "--accent-glow": alpha(t.primary, 0.45),
  } as CSSProperties;
}

/** Ressorts Motion selon la personnalité de mouvement de la console. */
export const SPRINGS = {
  bouncy: { type: "spring", stiffness: 420, damping: 22, mass: 0.9 },
  airy: { type: "spring", stiffness: 220, damping: 26, mass: 1 },
  snappy: { type: "spring", stiffness: 520, damping: 34, mass: 0.8 },
  calm: { type: "spring", stiffness: 260, damping: 32, mass: 1 },
  floaty: { type: "spring", stiffness: 180, damping: 18, mass: 1.1 },
} as const;

/** Fond « carte de console » : dégradé pastel le jour, teinte profonde la nuit. */
export function platformCardBackground(platform: Platform): string {
  const t = platform.theme;
  return `linear-gradient(145deg, light-dark(${t.soft}, color-mix(in oklab, ${t.primary} 24%, #252b3b)) 0%, light-dark(${t.primary}, color-mix(in oklab, ${t.primary} 62%, #252b3b)) 135%)`;
}

/** Mélange une couleur avec la surface courante (blanc le jour, ardoise la nuit). */
export function onSurface(color: string, lightAmount: number, darkAmount = 0.18): string {
  return `light-dark(color-mix(in oklab, ${color} ${Math.round((1 - lightAmount) * 100)}%, #ffffff), color-mix(in oklab, ${color} ${Math.round(darkAmount * 100)}%, #252b3b))`;
}
