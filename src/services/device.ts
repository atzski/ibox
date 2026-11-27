/**
 * Consoles portables (docs/HANDHELD.md, docs/ANDROID.md §9) : l'appareil reconnu par le cœur natif
 * (`platform.rs` `identify` sur PC, `android_chip.rs` sur Android) donne le palier de performance
 * de l'interface et la taille du texte. Une seule logique de paliers pour les deux familles.
 *
 * - **Palier** (du plus complet au plus léger) : `full` (PC), `handheld` (Ryzen Z1 / Z2 Extreme,
 *   Intel Arc, Snapdragon 8 Gen 1 et suivants : interface complète, 3D bridée et au repos quand
 *   rien ne bouge), `lite` (Steam Deck, Ryzen Z1 / Z2 A / Z2 Go, Snapdragon 855 à 888, Dimensity
 *   1100 à 8200 : interface allégée, `styles/performance.css`), `low` (Snapdragon 720G, Dimensity
 *   900, Unisoc T820 : interface allégée, 3D plus légère à 30 im/s), `minimal` (Unisoc T618, Helio
 *   G85 et moins : vue en jaquettes d'office, la 3D reste possible au choix).
 * - **Puce inconnue** (Android) : classe provisoire d'après la mémoire, affinée par le GPU que voit
 *   WebGL (`gpuClassFromRenderer`).
 * - **Chaleur** (Android) : un palier de moins quand la console chauffe (`thermalSteps`).
 * - **Texte** : à 1280 points de large sur 7 pouces, la taille de base d'iBox (~15 px) fait des
 *   lettres de 1,8 mm, et les plus petits textes passent sous le seuil de lisibilité que Valve donne
 *   pour le Deck. Le texte est agrandi d'office jusqu'à ~2 mm par rem, sans dépasser ×1,15.
 */
import type { PlatformInfo } from "./platform";

/** Puissance graphique : `low` / `mid` pour les consoles PC ; `minimal` / `weak` en plus sur Android. */
export type GpuClass = "minimal" | "weak" | "low" | "mid";

/** Puce d'une console Android (`android_chip.rs`). */
export interface AndroidChip {
  /** Code donné par le système (`SM8550`, `MT6893`, `T618`, `kona`…). */
  soc: string;
  /** Nom commercial, si la puce est dans la table. */
  name: string | null;
  /** Puce dans la table ; sinon classe provisoire d'après la mémoire. */
  known: boolean;
  memoryMb: number;
}

export interface HandheldDevice {
  /** `steam-deck-oled`, `rog-ally-x`, `legion-go`… ; `handheld` sans fiche détaillée ; `android`. */
  id: string;
  name: string;
  /** Écran intégré (définition native, diagonale en pouces), s'il est connu. */
  screen: { width: number; height: number; inches: number } | null;
  gpu: GpuClass;
  /** Console Android : puce reconnue. */
  chip?: AndroidChip;
}

export type PerfTier = "full" | "handheld" | "lite" | "low" | "minimal";

/** Nom du palier (Paramètres, diagnostic). */
export const TIER_LABEL: Record<PerfTier, string> = { full: "complet", handheld: "fort", lite: "allégé", low: "modeste", minimal: "minimal" };

/** Du plus léger au plus complet. */
export const TIERS: readonly PerfTier[] = ["minimal", "low", "lite", "handheld", "full"];
const rank = (t: PerfTier) => TIERS.indexOf(t);

/** Le plus léger des deux paliers. */
export const lighterTier = (a: PerfTier, b: PerfTier): PerfTier => (rank(a) <= rank(b) ? a : b);

/** Interface allégée (`<html data-perf="lite">`) : `lite`, `low` et `minimal`. */
export const isLightTier = (t: PerfTier): boolean => rank(t) <= rank("lite");

/** `steps` paliers plus bas, sans descendre sous `floor`. */
export function lowerTier(t: PerfTier, steps: number, floor: PerfTier = "minimal"): PerfTier {
  if (steps <= 0 || rank(t) <= rank(floor)) return t;
  return TIERS[Math.max(rank(floor), rank(t) - steps)];
}

const CLASS_TIER: Record<GpuClass, PerfTier> = { minimal: "minimal", weak: "low", low: "lite", mid: "handheld" };
const CLASS_RANK: Record<GpuClass, number> = { minimal: 0, weak: 1, low: 2, mid: 3 };

/** Plafond de la mémoire (comme `android_chip::memory_cap`) : 3 Go au plus `weak`, 2 Go `minimal`. */
export function memoryCap(memoryMb: number): GpuClass {
  if (memoryMb <= 0) return "mid";
  if (memoryMb < 2600) return "minimal";
  if (memoryMb < 3600) return "weak";
  return "mid";
}

/**
 * Classe d'après le GPU que voit WebGL (`WEBGL_debug_renderer_info`), pour une puce Android absente
 * de la table. `null` : renderer inconnu (émulateur, traducteur ANGLE). Rendu logiciel : `minimal`.
 */
export function gpuClassFromRenderer(renderer: string | null | undefined): GpuClass | null {
  const r = (renderer ?? "").toLowerCase();
  if (!r) return null;
  if (/swiftshader|llvmpipe|softpipe|software|basic render/.test(r)) return "minimal";
  if (r.includes("powervr")) return "minimal";
  if (r.includes("xclipse")) return "low";
  if (r.includes("immortalis")) return "mid";
  const adreno = /adreno[^0-9]*(\d{3})/.exec(r);
  if (adreno) {
    const n = Number(adreno[1]);
    if (n >= 730 && n !== 732) return "mid";
    if (n >= 720 || (n >= 640 && n < 700)) return "low";
    if (n >= 612) return "weak";
    return "minimal";
  }
  const mali = /mali[- ]?g(\d{2,3})/.exec(r);
  if (mali) {
    const g = Number(mali[1]);
    const cores = Number(/\b(?:mc|mp)(\d+)/.exec(r)?.[1] ?? 0);
    if (g >= 710) return cores >= 10 ? "mid" : "low";
    if (g >= 610) return cores >= 6 ? "low" : "weak";
    if (g === 77 || g === 78) return cores >= 9 ? "low" : "weak";
    if (g === 57 || g === 68 || g === 76) return cores >= 4 ? "weak" : "minimal";
    return "minimal";
  }
  if (r.includes("mali")) return "minimal";
  return null;
}

/** Rendu WebGL logiciel (vieux PC sans pilote, machine virtuelle) : la 3D y est inutilisable. */
export const softwareRenderer = (renderer: string | null | undefined): boolean =>
  /swiftshader|llvmpipe|softpipe|basic render|software/i.test(renderer ?? "");

type DeviceSignals = Pick<PlatformInfo, "steamDeck" | "handheld"> & { device?: HandheldDevice | null };

/**
 * Palier d'office selon l'appareil. `renderer` : GPU vu par WebGL (affine une puce Android
 * inconnue ; sans effet ailleurs).
 */
export function deviceTier(p: DeviceSignals, renderer?: string | null): PerfTier {
  const chip = p.device?.chip;
  if (p.device && chip) {
    let cls = p.device.gpu;
    const seen = chip.known ? null : gpuClassFromRenderer(renderer);
    if (seen) {
      const cap = memoryCap(chip.memoryMb);
      cls = CLASS_RANK[seen] <= CLASS_RANK[cap] ? seen : cap;
    }
    return CLASS_TIER[cls];
  }
  if (p.device?.gpu === "mid") return "handheld";
  if (p.steamDeck !== null || p.handheld === true || p.device) return "lite";
  return "full";
}

/**
 * Paliers retirés par la chaleur (`PowerManager.THERMAL_STATUS_*`) : un au statut « modéré » (2),
 * deux à « sévère » (3) et au-delà. Léger (1) : rien, le système commence à peine à brider.
 */
export const thermalSteps = (status: number | null | undefined): number => (!status || status < 2 ? 0 : status === 2 ? 1 : 2);

/** Taille de la base de l'interface (`html`, `styles/global.css`) pour une largeur en points CSS. */
export const baseFontPx = (cssWidth: number): number => Math.min(24, Math.max(14, 0.0062 * cssWidth + 7));

/** Hauteur visée d'un rem à l'écran d'une console portable, en millimètres. */
export const TARGET_REM_MM = 2.0;
/** Agrandissement d'office au plus : au-delà, la mise en page de 1280×720 points ne tient plus. */
export const MAX_TEXT_SCALE = 1.15;

/**
 * L'écran courant est-il l'écran intégré de la console ? Faux sur une télévision ou un moniteur
 * (Steam Deck sur son dock, Ally branchée en HDMI) : sa définition en pixels n'est pas celle de
 * la fiche (à 3 % près, dans un sens ou dans l'autre).
 */
export function onBuiltInScreen(s: { width: number; height: number }, screenPx: { width: number; height: number }): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= b * 0.03;
  const [w, h] = [Math.max(screenPx.width, screenPx.height), Math.min(screenPx.width, screenPx.height)];
  return near(w, Math.max(s.width, s.height)) && near(h, Math.min(s.width, s.height));
}

/**
 * Agrandissement d'office du texte sur l'écran d'une console portable (1 ailleurs).
 * `cssWidth` : largeur de la fenêtre en points CSS ; `dpr` : rapport pixels / point (mise à
 * l'échelle de Windows : 1,5 à 150 %) ; `screenPx` : définition de l'écran courant en pixels
 * (`screen.width × dpr`) : sur une télévision ou un moniteur, rien n'est agrandi.
 */
export function handheldTextScale(device: HandheldDevice | null | undefined, cssWidth: number, dpr: number, screenPx?: { width: number; height: number }): number {
  const s = device?.screen;
  if (!s || cssWidth <= 0 || dpr <= 0) return 1;
  if (screenPx && screenPx.width > 0 && !onBuiltInScreen(s, screenPx)) return 1;
  const mmPerPixel = (s.inches * 25.4) / Math.hypot(s.width, s.height);
  const remMm = baseFontPx(cssWidth) * dpr * mmPerPixel;
  const scale = Math.min(MAX_TEXT_SCALE, Math.max(1, TARGET_REM_MM / remMm));
  return Math.round(scale * 100) / 100;
}

function android(name: string, soc: string, chipName: string, gpu: GpuClass, gb: number): HandheldDevice {
  return { id: "android", name, screen: null, gpu, chip: { soc, name: chipName, known: true, memoryMb: gb * 1024 - 300 } };
}

type Simulated = { os: PlatformInfo["os"]; device: HandheldDevice; steamDeck?: string; gameMode?: boolean; android?: boolean };

/** Appareils simulés (aperçu navigateur et build de mesure : `?device=ally`, `?device=t618`). */
const SIMULATED: Record<string, Simulated> = {
  deck: { os: "linux", steamDeck: "Steam Deck OLED", gameMode: true, device: { id: "steam-deck-oled", name: "Steam Deck OLED", screen: { width: 1280, height: 800, inches: 7.4 }, gpu: "low" } },
  ally: { os: "windows", device: { id: "rog-ally", name: "ROG Ally", screen: { width: 1920, height: 1080, inches: 7 }, gpu: "mid" } },
  "ally-z1": { os: "windows", device: { id: "rog-ally", name: "ROG Ally", screen: { width: 1920, height: 1080, inches: 7 }, gpu: "low" } },
  "legion-go": { os: "windows", device: { id: "legion-go", name: "Legion Go", screen: { width: 2560, height: 1600, inches: 8.8 }, gpu: "mid" } },
  "legion-go-s": { os: "windows", device: { id: "legion-go-s", name: "Legion Go S", screen: { width: 1920, height: 1200, inches: 8 }, gpu: "low" } },
  claw: { os: "windows", device: { id: "msi-claw", name: "MSI Claw", screen: { width: 1920, height: 1080, inches: 7 }, gpu: "mid" } },
  // consoles Android (docs/ANDROID.md §9) : mêmes fiches que `android_chip.rs`
  thor: { os: "linux", android: true, device: android("AYN Thor", "SM8550", "Snapdragon 8 Gen 2", "mid", 12) },
  rp5: { os: "linux", android: true, device: android("Retroid Pocket 5", "SM8250", "Snapdragon 865 / 870", "low", 8) },
  "rp4-pro": { os: "linux", android: true, device: android("Retroid Pocket 4 Pro", "MT6891", "Dimensity 1100", "low", 8) },
  t820: { os: "linux", android: true, device: android("Anbernic RG556", "T820", "Unisoc T820", "weak", 8) },
  t618: { os: "linux", android: true, device: android("Anbernic RG405M", "T618", "Unisoc T618", "minimal", 4) },
};

export function simulatedPlatform(id: string): PlatformInfo | null {
  const s = SIMULATED[id];
  if (!s) return null;
  return { os: s.os, steamDeck: s.steamDeck ?? null, handheld: true, gameMode: s.gameMode ?? false, preview: false, device: s.device, ...(s.android ? { android: true } : {}) };
}
