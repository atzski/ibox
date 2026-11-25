/**
 * Mode performance et mise en veille de l'interface (docs/STEAMDECK.md, « Mode performance »).
 *
 * - **Mode performance** : allège ce que WebKitGTK (Steam Deck, Linux) et les petits GPU rendent
 *   lentement : flous d'arrière-plan, grands flous de décor, grandes ombres, 3D à la définition de
 *   l'écran et dessinée seulement quand elle bouge. Activé d'office sur une console portable,
 *   réglable dans Paramètres › Affichage. Posé sur `<html data-perf="lite">` ; les allègements de
 *   style vivent dans `styles/performance.css`. L'apparence par défaut (mode éteint) ne change pas.
 * - **Veille de l'interface** : quand personne ne regarde iBox (fenêtre masquée, document caché,
 *   ou jeu en cours sans qu'iBox ait le focus : en Mode Jeu sa fenêtre reste « visible » derrière
 *   le jeu), animations CSS, scènes 3D et petites minuteries s'arrêtent et rendent le processeur
 *   et le GPU au jeu. Posé sur `<html data-asleep>`. Vaut pour tout le monde, Windows compris.
 */
import { create } from "zustand";
import { useSettings } from "./settings";
import { usePlatform, type PlatformInfo } from "./platform";
import { useLauncher } from "./launcher";

export type PerformanceChoice = "auto" | "on" | "off";

/** Console portable de jeu : Steam Deck reconnu, ou machine que Steam annonce comme telle. */
export const isHandheld = (p: Pick<PlatformInfo, "steamDeck" | "handheld">): boolean => p.steamDeck !== null || p.handheld === true;

/** Le mode performance est-il actif ? `auto` : seulement sur une console portable. */
export function resolvePerformance(choice: PerformanceChoice | undefined, handheld: boolean): boolean {
  if (choice === "on") return true;
  if (choice === "off") return false;
  return handheld;
}

/** Mode performance actif (réglage et appareil). */
export function usePerformanceMode(): boolean {
  const choice = useSettings((s) => s.performanceMode);
  const handheld = usePlatform(isHandheld);
  return resolvePerformance(choice, handheld);
}

/** Lecture hors React (services, gestionnaires d'événements). */
export const performanceMode = (): boolean => resolvePerformance(useSettings.getState().performanceMode, isHandheld(usePlatform.getState()));

// ——— Veille de l'interface ———

export interface SleepSignals {
  /** `document.hidden` : fenêtre réduite, onglet caché. */
  documentHidden: boolean;
  /** Fenêtre native masquée (iBox attend dans la zone de notification). */
  windowHidden: boolean;
  /** La fenêtre a le focus. */
  focused: boolean;
  /** Un jeu lancé par iBox est en cours. */
  playing: boolean;
}

/** L'interface peut-elle s'arrêter de s'animer ? */
export const shouldSleep = (s: SleepSignals): boolean => s.documentHidden || s.windowHidden || (s.playing && !s.focused);

export const useInterfaceSleep = create<{ asleep: boolean }>(() => ({ asleep: false }));

/** Lecture hors React. */
export const interfaceAsleep = (): boolean => useInterfaceSleep.getState().asleep;

const signals: SleepSignals = { documentHidden: false, windowHidden: false, focused: true, playing: false };

function refresh(): void {
  const asleep = shouldSleep(signals);
  if (asleep !== useInterfaceSleep.getState().asleep) useInterfaceSleep.setState({ asleep });
  if (typeof document === "undefined") return;
  if (asleep) document.documentElement.dataset.asleep = "";
  else delete document.documentElement.dataset.asleep;
}

/** Fenêtre native masquée ou montrée (`shellApi.onVisibility`). */
export function setWindowHidden(hidden: boolean): void {
  signals.windowHidden = hidden;
  refresh();
}

/** Suit le focus, la visibilité du document et le jeu en cours ; renvoie la fonction d'arrêt. */
export function attachInterfaceSleep(): () => void {
  const sync = () => {
    signals.documentHidden = document.hidden;
    signals.focused = document.hasFocus();
    refresh();
  };
  // un geste dans la fenêtre vaut focus : certains gestionnaires de fenêtres (gamescope) ne
  // l'annoncent pas toujours, et l'interface ne doit jamais rester figée sous la main
  const awake = () => {
    if (signals.focused) return;
    signals.focused = true;
    refresh();
  };
  const blur = () => {
    signals.focused = false;
    refresh();
  };
  signals.playing = useLauncher.getState().phase === "running";
  const offLauncher = useLauncher.subscribe((s) => {
    const playing = s.phase === "running";
    if (playing === signals.playing) return;
    signals.playing = playing;
    signals.focused = document.hasFocus();
    refresh();
  });
  sync();
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("focus", sync);
  window.addEventListener("blur", blur);
  window.addEventListener("pointerdown", awake, true);
  window.addEventListener("keydown", awake, true);
  return () => {
    offLauncher();
    document.removeEventListener("visibilitychange", sync);
    window.removeEventListener("focus", sync);
    window.removeEventListener("blur", blur);
    window.removeEventListener("pointerdown", awake, true);
    window.removeEventListener("keydown", awake, true);
    signals.playing = false;
    signals.focused = true;
    refresh();
  };
}
