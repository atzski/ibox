/**
 * Écran du bas (second écran des consoles Android, AYN Thor) : ce qui passe entre les deux
 * écrans. Données seules, sans dépendance au reste d'iBox (la page du bas n'a pas d'IPC).
 *
 * - Haut → bas : `SecondState`, poussé par `services/secondScreen.ts` à chaque changement.
 * - Bas → haut : `SecondCommand`, relayé par le plugin (événement `second`).
 *
 * Conception : docs/ANDROID.md, « Second écran ».
 */

/** Panneaux de l'écran du bas pendant une partie. */
export type PlayPanel = "achievements" | "manual" | "notes" | "music";
export const PLAY_PANELS: PlayPanel[] = ["achievements", "manual", "notes", "music"];

export interface SecondScreenPrefs {
  /** Écran du bas utilisé (s'il existe). */
  enabled: boolean;
  /** Dans les menus : fiche du jeu choisi (raccourcis faute de jeu) ou raccourcis seuls. */
  menu: "game" | "shortcuts";
  /** Panneaux proposés pendant une partie, dans cet ordre. */
  play: Record<PlayPanel, boolean>;
  /** Jeux DS et 3DS : l'écran du bas est laissé à l'émulateur. */
  yieldDualScreen: boolean;
  /** Surface native (essais, sans interface) : auto = activité dès Android 10, sinon présentation. */
  surface?: "auto" | "activity" | "presentation";
}

export const DEFAULT_SECOND_PREFS: SecondScreenPrefs = {
  enabled: true,
  menu: "game",
  play: { achievements: true, manual: true, notes: true, music: true },
  yieldDualScreen: true,
};

/** Réglages complets à partir de ce qui est enregistré (champs absents : valeurs par défaut). */
export function secondPrefs(saved: Partial<SecondScreenPrefs> | undefined): SecondScreenPrefs {
  return {
    ...DEFAULT_SECOND_PREFS,
    ...saved,
    play: { ...DEFAULT_SECOND_PREFS.play, ...saved?.play },
  };
}

/** Consoles dont les émulateurs se servent eux-mêmes du second écran. */
export const DUAL_SCREEN_PLATFORMS = ["ds", "3ds", "wiiu"];

/** L'écran du bas doit-il se retirer pour ce jeu en cours ? */
export function yieldsScreen(platformId: string | undefined, prefs: SecondScreenPrefs): boolean {
  return !!platformId && prefs.yieldDualScreen && DUAL_SCREEN_PLATFORMS.includes(platformId);
}

export interface SecondGame {
  /** Identifiant du jeu dans l'interface (`Game.id`). */
  id: string;
  title: string;
  platformId: string;
  platform: string;
  /** Couleurs de la console (dégradé de la fiche). */
  tint: [string, string];
  year?: number;
  developer?: string;
  genre?: string;
  players?: string;
  summary?: string;
  playSeconds?: number;
  playCount?: number;
  lastPlayedAt?: string;
  favorite?: boolean;
  /** Jaquette réduite (adresse `data:`), envoyée une fois par jeu. */
  cover?: string;
  /** Pages du manuel, s'il est téléchargé. */
  manualPages?: number | null;
  hasManual?: boolean;
}

export interface SecondAchievement {
  id: number;
  title: string;
  description: string;
  points: number;
  badge?: string;
  earned: boolean;
  /** Débloqué pendant cette partie (annonce en direct). */
  fresh?: boolean;
}

export interface SecondAchievements {
  /** Pseudo RetroAchievements relié. */
  linked: boolean;
  earned: number;
  total: number;
  points: number;
  list: SecondAchievement[];
}

export interface SecondMusic {
  title: string;
  artist: string;
  playing: boolean;
  artwork?: string | null;
}

export interface SecondCollection {
  id: number;
  name: string;
  color: string;
  count: number;
}

export interface SecondState {
  v: 1;
  lang: "fr" | "en";
  dark: boolean;
  reduced: boolean;
  sound: { enabled: boolean; volume: number };
  prefs: SecondScreenPrefs;
  /** menus, lancement (animation, démarrage) ou partie en cours sur l'écran du haut. */
  phase: "menu" | "launching" | "playing";
  /** Assistant de premier lancement ouvert en haut : rien à montrer ni à toucher en bas. */
  setup?: boolean;
  /** Jeu choisi dans les menus, ou jeu en cours. */
  game: SecondGame | null;
  session: { startedAt?: number; emulator?: string } | null;
  achievements: SecondAchievements | null;
  music: SecondMusic | null;
  collections: SecondCollection[];
  /** Note du jeu (écrite en bas, gardée par la fenêtre principale). */
  note: string;
  /** Page du manuel demandée par l'écran du bas. */
  manualPage: { index: number; count: number; src: string } | null;
  /** Nombre de jeux de la bibliothèque (accroche des raccourcis). */
  libraryCount: number;
  /** Amis en ligne (iNetbox). */
  friendsOnline: number;
}

export type ShortcutTarget = "search" | "collections" | "friends" | "library" | "achievements" | "settings";

export type SecondCommand =
  | { type: "ready" }
  | { type: "open"; target: ShortcutTarget }
  | { type: "collection"; id: number }
  | { type: "game"; action: "open" | "play" | "favorite" }
  | { type: "return" }
  | { type: "manual"; index: number }
  | { type: "note"; gameId: string; text: string }
  | { type: "music"; action: "toggle" | "next" | "prev" };

const SHORTCUTS: ShortcutTarget[] = ["search", "collections", "friends", "library", "achievements", "settings"];

/** Commande reçue du bas, vérifiée (la page du bas est la nôtre, mais rien n'est supposé). */
export function parseCommand(raw: unknown): SecondCommand | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  switch (c.type) {
    case "ready":
    case "return":
      return { type: c.type };
    case "open":
      return SHORTCUTS.includes(c.target as ShortcutTarget) ? { type: "open", target: c.target as ShortcutTarget } : null;
    case "collection":
      return typeof c.id === "number" ? { type: "collection", id: c.id } : null;
    case "game":
      return c.action === "open" || c.action === "play" || c.action === "favorite" ? { type: "game", action: c.action } : null;
    case "manual":
      return typeof c.index === "number" && c.index >= 0 ? { type: "manual", index: Math.floor(c.index) } : null;
    case "note":
      return typeof c.gameId === "string" && typeof c.text === "string" ? { type: "note", gameId: c.gameId, text: c.text.slice(0, 4000) } : null;
    case "music":
      return c.action === "toggle" || c.action === "next" || c.action === "prev" ? { type: "music", action: c.action } : null;
    default:
      return null;
  }
}

/** Ce que montre l'écran du bas. */
export type SecondView =
  | { kind: "card" }
  | { kind: "shortcuts" }
  | { kind: "play"; panels: PlayPanel[] };

/** Vue de l'écran du bas selon le contexte de l'écran du haut et les réglages. */
export function viewOf(state: Pick<SecondState, "phase" | "game" | "prefs" | "achievements" | "music">): SecondView {
  if (state.phase !== "menu") {
    const panels = PLAY_PANELS.filter((p) => {
      if (!state.prefs.play[p]) return false;
      if (p === "manual") return !!state.game?.hasManual;
      if (p === "music") return !!state.music;
      return true;
    });
    return { kind: "play", panels };
  }
  return state.prefs.menu === "game" && state.game ? { kind: "card" } : { kind: "shortcuts" };
}

/** Temps de jeu lisible (« 3 h 20 », « 12 min », « Jamais joué »). */
export function playTime(seconds: number | undefined): string {
  if (!seconds || seconds < 60) return seconds ? "Moins d'une minute" : "Jamais joué";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** Durée de la partie en cours (« 5 min »), d'après son heure de début. */
export function sessionTime(startedAt: number | undefined, now: number): string {
  if (!startedAt) return "";
  const min = Math.max(0, Math.floor((now - startedAt) / 60_000));
  return min < 1 ? "Moins d'une minute" : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

/** Clavier tactile des notes (la fenêtre du bas ne prend jamais le focus : pas de clavier du système). */
export function keyboardRows(lang: "fr" | "en"): string[][] {
  const letters = lang === "fr" ? ["azertyuiop", "qsdfghjklm", "wxcvbn'-?"] : ["qwertyuiop", "asdfghjkl'", "zxcvbnm-?"];
  return [["1234567890"], ...letters.map((r) => [r])].map(([r]) => [...r]);
}

/** Touche appliquée au texte (`⇧` et la casse sont gérés par l'appelant). */
export function applyKey(text: string, key: string): string {
  if (key === "backspace") return [...text].slice(0, -1).join("");
  if (key === "enter") return `${text}\n`;
  if (key === "space") return `${text} `;
  return text + key;
}
