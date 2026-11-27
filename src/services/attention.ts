/**
 * Qui regarde iBox ? Tous les signaux d'attention en un seul endroit (docs/HANDHELD.md §3).
 *
 * Signaux : document caché (fenêtre réduite), fenêtre native masquée (zone de notification), focus
 * de la fenêtre, partie en cours (ou en lancement), Mode Jeu du Steam Deck. Deux conclusions :
 *
 * - **`asleep`** (veille de l'interface) : personne ne regarde. Fenêtre masquée, document caché,
 *   ou partie en cours sans focus (en Mode Jeu la fenêtre reste « visible » derrière le jeu).
 *   Animations CSS en pause (`<html data-asleep>`, `styles/performance.css`), scènes 3D à
 *   l'arrêt, manettes plus lues, relectures en pause. Un geste dans la fenêtre réveille.
 * - **`alone`** : Mode Jeu sans partie ni lancement. iBox est la seule fenêtre à l'écran : sa
 *   manette compte même si gamescope n'a pas rendu le focus à la fenêtre au retour d'un jeu.
 *
 * Ce module règle lui-même la lecture des manettes (`input/gamepad.ts`, `padPolicy`) ; les autres
 * s'abonnent à `useAttention` ou lisent `interfaceAsleep()`.
 */
import { create } from "zustand";
import { useLauncher, type LaunchPhase } from "./launcher";
import { usePlatform } from "./platform";
import { padPolicy, setPadPaused } from "@/input/gamepad";

export interface AttentionSignals {
  /** `document.hidden` : fenêtre réduite, onglet caché. */
  documentHidden: boolean;
  /** Fenêtre native masquée (iBox attend dans la zone de notification). */
  windowHidden: boolean;
  /** La fenêtre a le focus. */
  focused: boolean;
  /** Un jeu lancé par iBox est en cours. */
  playing: boolean;
  /** Un jeu se lance (animation, démarrage de l'émulateur). */
  launching?: boolean;
  /** Mode Jeu du Steam Deck (gamescope : une seule fenêtre à l'écran). */
  gameMode?: boolean;
}

/** Ancien nom (veille seule). */
export type SleepSignals = AttentionSignals;

export interface Attention {
  asleep: boolean;
  alone: boolean;
}

/** L'interface peut-elle s'arrêter de s'animer ? */
export const shouldSleep = (s: AttentionSignals): boolean => s.documentHidden || s.windowHidden || (s.playing && !s.focused);

/** Conclusions des signaux (pur, testé). */
export function attentionOf(s: AttentionSignals): Attention {
  return { asleep: shouldSleep(s), alone: s.gameMode === true && !s.playing && !s.launching };
}

export const useAttention = create<Attention>(() => ({ asleep: false, alone: false }));
/** Veille seule (composants : `useInterfaceSleep((s) => s.asleep)`). */
export const useInterfaceSleep = useAttention;

/** Lecture hors React. */
export const interfaceAsleep = (): boolean => useAttention.getState().asleep;

const signals: AttentionSignals = { documentHidden: false, windowHidden: false, focused: true, playing: false, launching: false, gameMode: false };

function refresh(): void {
  const next = attentionOf(signals);
  const prev = useAttention.getState();
  if (next.asleep !== prev.asleep || next.alone !== prev.alone) useAttention.setState(next);
  // manettes : plus lues pendant la veille ; seules à l'écran, lues même sans focus annoncé
  setPadPaused(next.asleep);
  padPolicy.trustVisible = next.alone;
  if (typeof document === "undefined") return;
  if (next.asleep) document.documentElement.dataset.asleep = "";
  else delete document.documentElement.dataset.asleep;
}

/** Fenêtre native masquée ou montrée (`shellApi.onVisibility`). */
export function setWindowHidden(hidden: boolean): void {
  signals.windowHidden = hidden;
  refresh();
}

const isPlaying = (phase: LaunchPhase) => phase === "running";
const isLaunching = (phase: LaunchPhase) => phase === "animating" || phase === "starting";

/** Suit focus, visibilité, partie en cours et Mode Jeu ; renvoie la fonction d'arrêt. */
export function attachAttention(): () => void {
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
  const phase = useLauncher.getState().phase;
  signals.playing = isPlaying(phase);
  signals.launching = isLaunching(phase);
  signals.gameMode = usePlatform.getState().gameMode;
  const offLauncher = useLauncher.subscribe((s) => {
    const playing = isPlaying(s.phase);
    const launching = isLaunching(s.phase);
    if (playing === signals.playing && launching === signals.launching) return;
    signals.playing = playing;
    signals.launching = launching;
    signals.focused = document.hasFocus();
    refresh();
  });
  const offPlatform = usePlatform.subscribe((p) => {
    if (p.gameMode === signals.gameMode) return;
    signals.gameMode = p.gameMode;
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
    offPlatform();
    document.removeEventListener("visibilitychange", sync);
    window.removeEventListener("focus", sync);
    window.removeEventListener("blur", blur);
    window.removeEventListener("pointerdown", awake, true);
    window.removeEventListener("keydown", awake, true);
    signals.playing = false;
    signals.launching = false;
    signals.focused = true;
    refresh();
    padPolicy.trustVisible = false;
  };
}
