import { useEffect, useSyncExternalStore } from "react";
import { create } from "zustand";
import type { Game, Platform } from "@/domain/types";
import { useSettings } from "@/services/settings";

/** Indication de commande affichée dans la barre du bas. */
export interface Hint {
  keys: string[];
  label: string;
}

interface ShellState {
  hints: Hint[];
  /** Console dont le thème colore l'arrière-plan (null = palette d'accueil). */
  ambientPlatform: Platform | null;
  /** Teintes d'ambiance optionnelles (ex. palette d'une jaquette). */
  ambientTint: [string, string] | null;
  /** Jeu dont le fond (ou la jaquette floutée) remplit l'arrière-plan. */
  ambientGame: Game | null;
  /** Fiche du jeu : fond net en haut de l'écran plutôt que flou. */
  ambientStage: boolean;
  title: string | null;
  set: (patch: Partial<Omit<ShellState, "set">>) => void;
}

export const useShell = create<ShellState>((set) => ({
  hints: [],
  ambientPlatform: null,
  ambientTint: null,
  ambientGame: null,
  ambientStage: false,
  title: null,
  set: (patch) => set(patch),
}));

/** Déclare l'habillage du shell pour l'écran courant. */
export function useScreenChrome(opts: {
  hints: Hint[];
  platform?: Platform | null;
  tint?: [string, string] | null;
  title?: string | null;
}) {
  const set = useShell((s) => s.set);
  const key = JSON.stringify(opts.hints) + (opts.platform?.id ?? "") + (opts.tint?.join() ?? "") + (opts.title ?? "");
  useEffect(() => {
    set({
      hints: opts.hints,
      ambientPlatform: opts.platform ?? null,
      ambientTint: opts.tint ?? null,
      title: opts.title ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, set]);
}

const darkMq = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
function subscribeDark(cb: () => void) {
  darkMq?.addEventListener("change", cb);
  return () => darkMq?.removeEventListener("change", cb);
}

/** true si l'interface est actuellement en mode sombre (réglage ou thème Windows). */
export function useIsDark(): boolean {
  const pref = useSettings((s) => s.theme);
  const system = useSyncExternalStore(subscribeDark, () => darkMq?.matches ?? false);
  return pref === "dark" || (pref === "system" && system);
}

const mq = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
function subscribeMq(cb: () => void) {
  mq?.addEventListener("change", cb);
  return () => mq?.removeEventListener("change", cb);
}

/** true si les animations doivent être réduites (réglage ou préférence système). */
export function useReducedMotion(): boolean {
  const pref = useSettings((s) => s.motion);
  const system = useSyncExternalStore(subscribeMq, () => mq?.matches ?? false);
  return pref === "reduced" || (pref === "system" && system);
}

let focusTimer: ReturnType<typeof setTimeout> | undefined;

/** Fin d'écran : l'arrière-plan revient aux couleurs de la console. */
export function clearAmbientGame(): void {
  clearTimeout(focusTimer);
  useShell.setState({ ambientGame: null, ambientStage: false });
}

/** Fiche d'un jeu : son fond s'affiche net, sans attendre. */
export function stageAmbientGame(game: Game): void {
  clearTimeout(focusTimer);
  useShell.setState({ ambientGame: game, ambientStage: true });
}

/**
 * Jeu sélectionné (jaquette focalisée ou survolée) : l'arrière-plan suit, avec
 * un court délai pour ne pas clignoter quand on fait défiler une rangée.
 */
export function focusAmbientGame(game: Game | null): void {
  clearTimeout(focusTimer);
  focusTimer = setTimeout(() => {
    if (useShell.getState().ambientGame?.id !== game?.id) useShell.setState({ ambientGame: game, ambientStage: false });
  }, 140);
}
