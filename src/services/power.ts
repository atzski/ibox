/**
 * Alimentation (Steam Deck surtout, docs/STEAMDECK.md §7 et §12 D5) : sur batterie, les veilles
 * de fond s'espacent et la scène 3D s'allège ; à la sortie de veille (`system-resumed`, envoyé
 * par le natif), les veilles reprennent aussitôt (événement `ibox-resumed` sur `window`).
 */
import { create } from "zustand";
import { isTauri } from "./native";

export interface PowerState {
  onBattery: boolean;
  percent: number | null;
}

export const usePower = create<PowerState>(() => ({ onBattery: false, percent: null }));

/** Événement de `window` émis à la sortie de veille. */
export const RESUMED = "ibox-resumed";

/** Délai d'une veille de fond : `normal` sur secteur, `battery` sur batterie. */
export const batteryAware = (normal: number, battery: number) => (usePower.getState().onBattery ? battery : normal);

/** Suit l'alimentation (toutes les minutes) et la sortie de veille ; renvoie la fonction d'arrêt. */
export function attachPower(): () => void {
  if (!isTauri()) return () => undefined;
  let stopped = false;
  let unlisten: (() => void) | undefined;
  const refresh = async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const s = await invoke<PowerState>("power_status").catch(() => null);
    if (s && !stopped) usePower.setState({ onBattery: s.onBattery, percent: s.percent ?? null });
  };
  void refresh();
  const timer = window.setInterval(() => void refresh(), 60_000);
  void import("@tauri-apps/api/event").then(({ listen }) =>
    listen("system-resumed", () => {
      void refresh();
      window.dispatchEvent(new Event(RESUMED));
    }).then((u) => (stopped ? u() : (unlisten = u))),
  );
  return () => {
    stopped = true;
    window.clearInterval(timer);
    unlisten?.();
  };
}
