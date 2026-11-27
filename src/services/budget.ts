/**
 * Budget de performance : un seul réglage, un seul calcul (docs/HANDHELD.md §3).
 *
 * Avant, trois notions se recouvraient : le réglage Mode performance (auto / activé / désactivé),
 * le réglage Profil graphique (auto / qualité / Steam Deck / économie) et le palier de l'appareil.
 * Tout passe maintenant par `resolveBudget` : le réglage Performances (`perfPreset`) et ce que dit
 * l'appareil (palier d'office, chaleur, batterie, écran Android) donnent, d'un seul tenant,
 *
 * - le **palier** (`tier`) : effets de l'interface (`light` → `<html data-perf="lite">`) et
 *   paliers modestes (`<html data-tier>`), 3D ou jaquettes (`render3d.ts`) ;
 * - le **rendu 3D** : définition, rythme d'images, rendu à la demande, textures, ombre, jeux de
 *   textures gardés (`graphics.ts`, `graphicsFor`).
 *
 * Positions du réglage : **Automatique** (l'appareil décide, Économie sur batterie), **Qualité**
 * (tous les effets, rendu affiné, rythme de l'écran), **Équilibré** (tous les effets, 60 im/s,
 * 3D au repos quand rien ne bouge), **Allégé** (interface allégée, définition de l'écran, 60 im/s),
 * **Économie** (allégé, 30 im/s). Un réglage choisi à la main ne remonte jamais un appareil au-dessus
 * de ce qu'il tient seulement pour Allégé et Économie (une puce `minimal` reste `minimal`).
 *
 * Les anciens réglages (`performanceMode`, `graphicsProfile`) sont lus tant que le nouveau n'a pas
 * été choisi (`presetOf`).
 */
import { useEffect, useMemo } from "react";
import { useSettings } from "./settings";
import { usePlatform, type PlatformInfo } from "./platform";
import { usePower } from "./power";
import { deviceTier, isLightTier, lighterTier, lowerTier, thermalSteps, type PerfTier } from "./device";
import { webglInfo } from "./webgl";
import { requestRefresh, useAndroidDevice, wantedRefresh } from "./androidDevice";
import { graphicsFor, keepFor, resolveProfile, type AndroidScreen, type GraphicsSettings, type ResolvedProfile } from "./graphics";

export type PerfPreset = "auto" | "quality" | "balanced" | "light" | "battery";

/** Réglage effectif, anciens réglages compris. */
export function presetOf(s: { perfPreset?: PerfPreset; performanceMode?: "auto" | "on" | "off"; graphicsProfile?: "auto" | "quality" | "deck" | "battery" }): PerfPreset {
  if (s.perfPreset) return s.perfPreset;
  const g = s.graphicsProfile ?? "auto";
  if (g === "battery") return "battery";
  if (s.performanceMode === "on" || g === "deck") return "light";
  if (s.performanceMode === "off" || g === "quality") return "quality";
  return "auto";
}

/** GPU vu par WebGL, lu seulement pour une puce Android absente de la table (`device.ts`). */
const rendererFor = (p: PlatformInfo): string | null => (p.device?.chip && !p.device.chip.known ? webglInfo().renderer : null);

/**
 * Palier d'office : l'appareil, puis la chaleur (Android : un palier de moins à « modéré », deux à
 * « sévère », jamais jusqu'à couper la 3D : plancher `low`).
 */
export function autoTier(p: PlatformInfo, thermal: number): PerfTier {
  return lowerTier(deviceTier(p, rendererFor(p)), thermalSteps(thermal), "low");
}

/** Palier de l'appareil seul, sans la chaleur (Paramètres, diagnostic). */
export const deviceTierOf = (p: PlatformInfo): PerfTier => deviceTier(p, rendererFor(p));

export interface BudgetInput {
  preset: PerfPreset;
  /** Palier d'office (appareil et chaleur, `autoTier`). */
  auto: PerfTier;
  /** Steam Deck reconnu. */
  deck: boolean;
  /** Sur batterie (Android : économiseur d'énergie actif). */
  onBattery: boolean;
  /** Écran d'une console Android (définition de rendu par budget de lignes). */
  screen?: AndroidScreen;
  /** Mémoire d'une console Android : moins de boîtiers gardés hors de l'écran. */
  memoryMb?: number;
}

export interface PerfBudget extends GraphicsSettings {
  preset: PerfPreset;
  tier: PerfTier;
  /** Interface allégée (`<html data-perf="lite">`). */
  light: boolean;
}

/** Palier et profil de rendu d'une position du réglage. */
function presetPlan(i: BudgetInput): { tier: PerfTier; profile: ResolvedProfile } {
  switch (i.preset) {
    case "quality":
      return { tier: "full", profile: "quality" };
    case "balanced":
      return { tier: "handheld", profile: "handheld" };
    case "light":
      return { tier: lighterTier(i.auto, "lite"), profile: "deck" };
    case "battery":
      return { tier: lighterTier(i.auto, "lite"), profile: "battery" };
    default:
      return { tier: i.auto, profile: resolveProfile("auto", i.deck, i.onBattery, isLightTier(i.auto), i.auto === "handheld") };
  }
}

/** Le budget complet (pur, testé). */
export function resolveBudget(i: BudgetInput): PerfBudget {
  const { tier, profile } = presetPlan(i);
  const g = graphicsFor(profile, tier, i.screen);
  return { ...g, keep: i.screen ? keepFor(g.keep, i.memoryMb) : g.keep, preset: i.preset, tier, light: isLightTier(tier) };
}

/** Écran Android courant (hauteur en paysage, densité, fréquence voulue au palier). */
function androidScreen(tier: PerfTier, rates: number[] | undefined): AndroidScreen {
  const h = typeof window === "undefined" ? 0 : Math.min(window.innerWidth, window.innerHeight);
  const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  return { cssHeight: h, dpr, refresh: wantedRefresh(rates ?? [], tier === "handheld") || 60 };
}

function budgetFrom(preset: PerfPreset, p: PlatformInfo, thermal: number, onBattery: boolean, rates: number[] | undefined): PerfBudget {
  const auto = autoTier(p, thermal);
  const base = { preset, auto, deck: p.steamDeck !== null, onBattery, memoryMb: p.device?.chip?.memoryMb };
  if (p.android !== true) return resolveBudget(base);
  // l'écran Android dépend du palier retenu : deux passes (le palier ne dépend pas de l'écran)
  const tier = presetPlan(base).tier;
  return resolveBudget({ ...base, screen: androidScreen(tier, rates) });
}

/** Budget actuel (composants). */
export function usePerfBudget(): PerfBudget {
  const preset = useSettings(presetOf);
  const platform = usePlatform();
  const thermal = useAndroidDevice((s) => s?.thermal ?? 0);
  // Android : la console vit sur batterie, seul l'économiseur d'énergie compte
  const onBattery = usePower((pw) => (platform.android === true ? pw.saver === true : pw.onBattery));
  const rates = useAndroidDevice((s) => s?.refreshRates);
  return useMemo(() => budgetFrom(preset, platform, thermal, onBattery, rates), [preset, platform, thermal, onBattery, rates]);
}

/** Budget actuel, hors React (services, diagnostic). */
export function perfBudget(): PerfBudget {
  const p = usePlatform.getState();
  const power = usePower.getState();
  const dev = useAndroidDevice.getState();
  const onBattery = p.android === true ? power.saver === true : power.onBattery;
  return budgetFrom(presetOf(useSettings.getState()), p, dev?.thermal ?? 0, onBattery, dev?.refreshRates);
}

/** Palier actuel. */
export const usePerfTier = (): PerfTier => usePerfBudget().tier;
export const perfTier = (): PerfTier => perfBudget().tier;
/** Interface allégée active (`<html data-perf="lite">`). */
export const usePerformanceMode = (): boolean => usePerfBudget().light;
export const performanceMode = (): boolean => perfBudget().light;
/** Réglages de rendu 3D (scènes, textures). */
export const useGraphics = (): GraphicsSettings => usePerfBudget();
export const currentGraphics = (): GraphicsSettings => perfBudget();

/**
 * Fréquence d'affichage de la fenêtre (Android) : la plus haute de l'écran au palier fort, 60 Hz
 * ailleurs (`DeviceState.setFrameRate`). Monté une fois (`App.tsx`).
 */
export function useAndroidRefresh(): void {
  const android = usePlatform((p) => p.android === true);
  const rates = useAndroidDevice((s) => s?.refreshRates);
  const tier = usePerfTier();
  const hz = android && rates ? wantedRefresh(rates, tier === "handheld") : 0;
  useEffect(() => {
    if (hz > 0) requestRefresh(hz);
  }, [hz]);
}
