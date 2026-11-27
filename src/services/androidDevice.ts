/**
 * État de la console Android (plugin `ibox-android`, `DeviceState.kt`, docs/ANDROID.md §9) :
 * chaleur, batterie et économiseur d'énergie, écran (définition, fréquences), mémoire.
 *
 * - La chaleur retire des paliers (`device.ts` `thermalSteps`, lu par `performance.ts`).
 * - La batterie remplace la lecture de `/sys/class/power_supply` (fermée aux applications
 *   Android) : `services/power.ts` reçoit la charge, le secteur et l'économiseur.
 * - Mémoire basse ou interface cachée (jeu lancé) : les textures inutilisées des boîtiers sont
 *   libérées, pour qu'Android ne ferme pas iBox pendant la partie.
 * - Fréquence d'affichage : la plus haute de l'écran au palier fort, 60 Hz ailleurs.
 *
 * Rien ne tourne en boucle : Android prévient à chaque changement (événement `device`).
 */
import { create } from "zustand";
import { isTauri } from "./native";
import { usePlatform } from "./platform";
import { usePower } from "./power";

export interface AndroidDeviceState {
  /** `PowerManager.THERMAL_STATUS_*` : 0 aucun, 1 léger, 2 modéré, 3 sévère, 4 critique… */
  thermal: number;
  /** Marge thermique prévue à 10 s (Android 11+), 1 = début du bridage. */
  headroom?: number | null;
  /** Charge en %, -1 inconnue. */
  battery: number;
  charging: boolean;
  saver: boolean;
  /** Écran en pixels (paysage) et fréquences (Hz). */
  width: number;
  height: number;
  refresh: number;
  refreshRates: number[];
  memoryMb: number;
  lowRam: boolean;
}

interface DeviceEvent extends Partial<AndroidDeviceState> {
  reason?: string;
  trim?: number;
}

export const useAndroidDevice = create<AndroidDeviceState | null>(() => null);

/** Chaleur simulée dans l'aperçu (`?thermal=2`) et le banc de mesure. */
function simulatedThermal(): number | null {
  if (!(import.meta.env.DEV || import.meta.env.VITE_IBOX_BENCH === "1") || typeof location === "undefined") return null;
  const v = new URLSearchParams(location.search).get("thermal");
  return v === null ? null : Number(v) || 0;
}

/** Statut thermique actuel (0 hors d'Android). */
export const thermalStatus = (s: AndroidDeviceState | null = useAndroidDevice.getState()): number => s?.thermal ?? 0;

/**
 * Fréquence d'affichage à demander : la plus haute (jusqu'à 120 Hz) au palier `handheld`
 * (Snapdragon 8 Gen 1 et suivants), 60 Hz sinon. 0 : laisser le système choisir.
 */
export function wantedRefresh(rates: number[], strong: boolean): number {
  const usable = rates.filter((r) => r >= 50 && r <= 125);
  if (usable.length === 0) return 0;
  if (strong) return Math.max(...usable);
  return usable.includes(60) ? 60 : Math.min(...usable);
}

function apply(e: DeviceEvent): void {
  const prev = useAndroidDevice.getState();
  const next: AndroidDeviceState = {
    thermal: e.thermal ?? prev?.thermal ?? 0,
    headroom: e.headroom ?? null,
    battery: e.battery ?? prev?.battery ?? -1,
    charging: e.charging ?? prev?.charging ?? false,
    saver: e.saver ?? prev?.saver ?? false,
    width: e.width ?? prev?.width ?? 0,
    height: e.height ?? prev?.height ?? 0,
    refresh: e.refresh ?? prev?.refresh ?? 0,
    refreshRates: e.refreshRates ?? prev?.refreshRates ?? [],
    memoryMb: e.memoryMb ?? prev?.memoryMb ?? 0,
    lowRam: e.lowRam ?? prev?.lowRam ?? false,
  };
  useAndroidDevice.setState(next, true);
  // une console Android vit sur batterie : seul l'économiseur d'énergie (ou une batterie presque
  // vide) fait passer la 3D en profil Économie (`graphics.ts`), voir `power.ts`
  const power = { onBattery: !next.charging && next.battery >= 0, percent: next.battery >= 0 ? next.battery : null };
  const before = usePower.getState();
  usePower.setState({ ...power, saver: next.saver || (!next.charging && next.battery >= 0 && next.battery <= 15) });
  // Rust (pouls iNetbox, service « Partie en cours ») ne lit pas la batterie lui-même sur Android
  if (isTauri() && (before.onBattery !== power.onBattery || before.percent !== power.percent)) {
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("power_report", power)).catch(() => undefined);
  }
}

const trimHandlers = new Set<(level: number) => void>();

/**
 * Appelé quand Android demande de la mémoire (`level` : `ComponentCallbacks2.TRIM_MEMORY_*`, 20 =
 * interface cachée, jeu lancé). L'étagère y libère ses textures inutilisées.
 */
export function onMemoryTrim(fn: (level: number) => void): () => void {
  trimHandlers.add(fn);
  return () => trimHandlers.delete(fn);
}

/** Suit l'état de la console (Android seulement) ; renvoie la fonction d'arrêt. */
export function attachAndroidDevice(): () => void {
  const sim = simulatedThermal();
  if (sim !== null) {
    apply({ thermal: sim, battery: 80, charging: false, refreshRates: [60] });
    return () => undefined;
  }
  if (!isTauri() || !usePlatform.getState().android) return () => undefined;
  let stopped = false;
  let unlisten: (() => void) | undefined;
  void (async () => {
    const { invoke, addPluginListener } = await import("@tauri-apps/api/core");
    const first = await invoke<DeviceEvent>("android_device_state").catch(() => null);
    if (stopped) return;
    if (first) apply(first);
    const listener = await addPluginListener<DeviceEvent>("ibox-android", "device", (e) => {
      apply(e);
      if (e.trim) trimHandlers.forEach((fn) => fn(e.trim!));
    }).catch(() => null);
    if (stopped) void listener?.unregister();
    else unlisten = () => void listener?.unregister();
  })();
  return () => {
    stopped = true;
    unlisten?.();
  };
}

let asked = -1;

/** Demande la fréquence d'affichage voulue (sans effet si elle l'est déjà, ou hors d'Android). */
export function requestRefresh(hz: number): void {
  if (hz === asked || !isTauri() || !usePlatform.getState().android) return;
  asked = hz;
  void import("@tauri-apps/api/core").then(({ invoke }) => invoke<number>("android_frame_rate", { hz })).catch(() => undefined);
}
