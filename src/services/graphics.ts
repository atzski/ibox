/**
 * Profils graphiques des scènes 3D (étagère, vol des boîtiers, visionneuse des fiches). Les scènes
 * restent les mêmes dans tous les profils : seuls la définition de rendu et le rythme d'images changent.
 *
 * - `quality` : rendu suréchantillonné jusqu'à ×1,5, images au rythme de l'écran (PC).
 * - `deck` : Steam Deck, rendu à la définition native de l'écran (1280×800), plafonné à 60 im/s
 *   (l'écran OLED monte à 90 Hz : 60 suffisent à l'étagère et économisent le GPU).
 * - `battery` (économie d'énergie) : définition native et 30 im/s.
 * - `auto` : `battery` sur batterie, `deck` sur un Steam Deck branché ou au palier allégé, sinon
 *   `quality` (`handheld` sur une console puissante).
 *
 * Le choix du profil et du palier se fait dans `services/budget.ts` (un seul réglage) ; ce module
 * ne fait que traduire un profil et un palier en réglages de rendu.
 *
 * Paliers (`services/device.ts`) : sur une console portable, l'étagère n'est dessinée que lorsqu'elle
 * bouge (`idle`) et `auto` devient `handheld` (rendu affiné jusqu'à ×1,5, 60 im/s : les écrans de
 * 120 à 144 Hz de l'Ally ou de la Legion Go n'y gagnent rien de visible). Au palier allégé (Steam
 * Deck, petits APU), les textures des jaquettes et l'ombre de la visionneuse sont aussi plus légères ;
 * aux paliers `low` et `minimal` (puces Android modestes), plus encore, à 30 im/s.
 *
 * **Android** (docs/ANDROID.md §9) : les écrans sont denses (densité 2 à 3) ; la définition de rendu
 * suit un budget de lignes par palier au lieu du `dpr` 1 du Deck (trop doux sur un écran de 1080p à
 * densité 2,6) : écran natif au palier fort, 900, 720 puis 540 lignes. Au palier fort, l'étagère
 * suit la fréquence de l'écran (90 ou 120 Hz) ; sur batterie, seul l'économiseur d'énergie d'Android
 * passe en profil Économie (une console Android est presque toujours sur batterie).
 */
import type { PerfTier } from "./device";

export type GraphicsProfile = "auto" | "quality" | "deck" | "battery";
/** `handheld` : choisi seulement par `auto`, sur une console portable puissante. */
export type ResolvedProfile = Exclude<GraphicsProfile, "auto"> | "handheld";

export interface GraphicsSettings {
  profile: ResolvedProfile;
  /** Définition de rendu (`dpr` de React Three Fiber). */
  dpr: number | [number, number];
  /** Plafond d'images par seconde (`null` : rythme de l'écran). */
  fps: number | null;
  /** Rendu à la demande : une scène posée n'est plus redessinée (`three/FrameCap.tsx`). */
  idle: boolean;
  /** Échelle des textures de jaquettes de l'étagère (1 : 800 px de large pour une face). */
  textures: number;
  /** Échelle des textures de la visionneuse des fiches (un seul boîtier, vu de près). */
  inspectTextures: number;
  /** Côté de la carte d'ombre de la visionneuse, en pixels. */
  shadowMap: number;
  /** Jeux de textures gardés hors de l'écran (boîtiers déjà vus, `three/useCaseTextures.ts`). */
  keep: number;
  /**
   * Anticrénelage (MSAA) de l'étagère et du vol des boîtiers. Coupé aux paliers allégés : sur la
   * puce du Deck, il multiplie la mémoire et la bande passante de chaque image dessinée. La
   * visionneuse des fiches (un seul boîtier vu de près) le garde toujours.
   */
  antialias: boolean;
}

/** Écran d'une console Android : hauteur en points CSS (paysage), densité, fréquence voulue. */
export interface AndroidScreen {
  cssHeight: number;
  dpr: number;
  refresh: number;
}

export function resolveProfile(choice: GraphicsProfile, deck: boolean, onBattery: boolean, lite = false, handheld = false): ResolvedProfile {
  if (choice !== "auto") return choice;
  if (onBattery) return "battery";
  if (deck || lite) return "deck";
  return handheld ? "handheld" : "quality";
}

/** Textures, ombres et mémoire par palier. */
const TIER_EXTRAS: Record<PerfTier, Omit<GraphicsSettings, "profile" | "dpr" | "fps">> = {
  full: { idle: false, textures: 1, inspectTextures: 1.6, shadowMap: 2048, keep: 32, antialias: true },
  handheld: { idle: true, textures: 1, inspectTextures: 1.6, shadowMap: 2048, keep: 32, antialias: true },
  lite: { idle: true, textures: 0.7, inspectTextures: 1.1, shadowMap: 1024, keep: 12, antialias: false },
  low: { idle: true, textures: 0.55, inspectTextures: 0.9, shadowMap: 512, keep: 6, antialias: false },
  minimal: { idle: true, textures: 0.5, inspectTextures: 0.8, shadowMap: 512, keep: 4, antialias: false },
};

/** Lignes de rendu visées sur Android, par palier (`battery` : comme `minimal`). */
const ANDROID_LINES: Record<PerfTier, number> = { full: 2160, handheld: 2160, lite: 900, low: 720, minimal: 540 };

/** Définition de rendu d'une console Android : budget de lignes, jamais sous 1 ni au-delà de l'écran. */
export function androidDpr(lines: number, screen: AndroidScreen): number {
  const max = Math.min(3, Math.max(1, screen.dpr));
  if (screen.cssHeight <= 0) return max;
  return Math.round(Math.min(max, Math.max(1, lines / screen.cssHeight)) * 100) / 100;
}

/**
 * Mémoire de la console : avec 4 Go ou moins (système, WebView et émulateur lancé ensuite se la
 * partagent), moins de boîtiers gardés hors de l'écran.
 */
export function keepFor(keep: number, memoryMb: number | undefined): number {
  if (!memoryMb) return keep;
  if (memoryMb < 3600) return Math.min(keep, 4);
  if (memoryMb < 4600) return Math.min(keep, 6);
  if (memoryMb < 6600) return Math.min(keep, 12);
  return keep;
}

export function graphicsFor(profile: ResolvedProfile, tier: PerfTier = "full", screen?: AndroidScreen): GraphicsSettings {
  const extra = TIER_EXTRAS[tier];
  const slow = tier === "low" || tier === "minimal";
  if (screen) {
    switch (profile) {
      case "quality":
        return { profile, dpr: [1, androidDpr(ANDROID_LINES.full, screen)], fps: null, ...extra };
      case "battery":
        return { profile, dpr: androidDpr(ANDROID_LINES.minimal, screen), fps: 30, ...extra };
      case "handheld":
        return { profile, dpr: androidDpr(ANDROID_LINES.handheld, screen), fps: screen.refresh > 60 ? Math.min(120, screen.refresh) : 60, ...extra };
      default:
        return { profile, dpr: androidDpr(ANDROID_LINES[tier], screen), fps: slow ? 30 : 60, ...extra };
    }
  }
  switch (profile) {
    case "deck":
      return { profile, dpr: 1, fps: slow ? 30 : 60, ...extra };
    case "battery":
      return { profile, dpr: 1, fps: 30, ...extra };
    case "handheld":
      return { profile, dpr: [1, 1.5], fps: 60, ...extra };
    default:
      return { profile, dpr: [1, 1.5], fps: null, ...extra };
  }
}
