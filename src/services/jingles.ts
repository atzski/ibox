import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./native";
import { useSettings } from "./settings";
import { music } from "./music";
import { create } from "zustand";
import { notify } from "./notifications";
import { useLibrary } from "./library";

/**
 * Jingles des jeux (sons iiDB), joués à l'ouverture d'une fiche, comme sur
 * une console portable. Une courte attente évite d'enchaîner les sons quand on
 * passe vite d'un jeu à l'autre.
 */
const DELAY_MS = 450;
let timer: number | undefined;
let current: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let restoreMusic: (() => void) | null = null;
/**
 * Change à chaque arrêt : un son encore en chemin (lecture du fichier) pour une
 * fiche qu'on vient de quitter n'a plus le droit de démarrer sur la suivante.
 */
let request = 0;

export function stopJingle() {
  request++;
  window.clearTimeout(timer);
  if (current) {
    // fondu de sortie doux (~0,9 s) plutôt qu'un arrêt net
    const el = current;
    const from = el.volume;
    const t0 = performance.now();
    const FADE = 900;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / FADE);
      el.volume = Math.max(0, from * (1 - k) * (1 - k));
      if (k < 1) requestAnimationFrame(step);
      else el.pause();
    };
    requestAnimationFrame(step);
  }
  current = null;
  if (currentUrl) { const u = currentUrl; window.setTimeout(() => URL.revokeObjectURL(u), 1500); currentUrl = null; }
  restoreMusic?.();
  restoreMusic = null;
}

/** Écoute immédiate (fiche d'un jeu), même si les jingles automatiques sont coupés. */
export function previewJingle(gameDbId: number) {
  playJingle(gameDbId, true);
}

/**
 * Les jingles sont des musiques de jeux, mixées bien plus fort que les sons d'iBox :
 * leur volume est atténué pour rester au niveau de l'interface (100 % du réglage ≈ 45 %).
 */
export const JINGLE_GAIN = 0.45;
export const DEFAULT_JINGLE_VOLUME = 0.6;

export function playJingle(gameDbId?: number, force = false) {
  stopJingle();
  const s = useSettings.getState();
  // jingles : leur propre réglage (indépendant des effets sonores), actif tant qu'il n'est pas coupé
  if (!isTauri() || gameDbId === undefined || (!force && s.gameSounds === false)) return;
  const mine = request;
  timer = window.setTimeout(async () => {
    try {
      const bytes = await invoke<ArrayBuffer>("game_sound", { gameId: gameDbId });
      if (mine !== request) return; // fiche quittée pendant la lecture du fichier
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
      const el = new Audio(url);
      el.volume = Math.min(1, Math.max(0, (useSettings.getState().jingleVolume ?? DEFAULT_JINGLE_VOLUME) * JINGLE_GAIN));
      current = el;
      currentUrl = url;
      restoreMusic = music.duck();
      el.onended = () => { if (current === el) stopJingle(); };
      await el.play();
    } catch (e) {
      // pas de son pour ce jeu : rien (autre erreur : visible dans la console)
      if (!String(e).includes("aucun son")) console.warn("jingle", e);
    }
  }, force ? 0 : DELAY_MS);
}

export interface JingleReport { downloaded: number; missing: number; cancelled: boolean }
/** Téléchargement en cours, suivi par Paramètres → Son (même si on quitte la page). */
interface JingleSync { running: boolean; phase: string; done: number; total: number; last: JingleReport | null; error: string | null; start: (quiet?: boolean) => Promise<void> }
export const useJingleSync = create<JingleSync>((set, get) => ({
  running: false, phase: "", done: 0, total: 0, last: null, error: null,
  start: async (quiet = false) => {
    if (get().running) return;
    set({ running: true, phase: "resolve", done: 0, total: 0, error: null });
    if (!quiet) notify({ icon: "sound", tone: "info", title: "Jingles des jeux", body: "Téléchargement lancé.", link: { kind: "settings", category: "sound" } });
    const { listen } = await import("@tauri-apps/api/event");
    const off = await listen<{ phase: string; done: number; total: number }>("games-art-progress", (e) => set({ phase: e.payload.phase, done: e.payload.done, total: e.payload.total }));
    try {
      const r = await jinglesApi.sync();
      useSettings.getState().set("gameSounds", true);
      set({ last: r });
      if (!quiet || r.downloaded) notify({ icon: "sound", tone: "ok", title: r.downloaded ? `${r.downloaded} jingle${r.downloaded > 1 ? "s" : ""} téléchargé${r.downloaded > 1 ? "s" : ""}` : "Aucun nouveau jingle", body: r.missing ? `${r.missing} jeu${r.missing > 1 ? "x" : ""} sans son dans iiDB.` : undefined, link: { kind: "settings", category: "sound" } });
    } catch (e) {
      set({ error: String(e) });
      if (!quiet) notify({ icon: "sound", tone: "warn", title: "Jingles des jeux", body: String(e), link: { kind: "settings", category: "sound" } });
    } finally {
      off();
      set({ running: false });
    }
  },
}));

export const jinglesApi = {
  sync: () => invoke<JingleReport>("sounds_sync"),
  status: () => invoke<[number, number]>("sounds_status"),
  clear: () => invoke<void>("sounds_clear"),
};

/**
 * Jingles activés : chaque jeu ajouté à la bibliothèque reçoit le sien
 * automatiquement (recherche iiDB discrète, quelques secondes après l'ajout).
 * Rien ne se télécharge sans l'accord donné dans Paramètres → Son.
 */
export function attachAutoJingles() {
  if (!isTauri()) return () => undefined;
  let known: Set<number> | null = null;
  let timer: number | undefined;
  const off = useLibrary.subscribe((s, p) => {
    if (s.realGames === p.realGames) return;
    const ids = new Set(s.realGames.flatMap((g) => (g.dbId === undefined ? [] : [g.dbId])));
    const added = known ? [...ids].some((id) => !known!.has(id)) : false;
    known = ids;
    if (!added) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const on = useSettings.getState().gameSounds;
      if (on === false) return;
      // accord explicite, ou jingles déjà téléchargés auparavant
      const accepted = on === true || ((await jinglesApi.status().catch(() => [0, 0] as [number, number]))[0] > 0);
      if (accepted) void useJingleSync.getState().start(true);
    }, 5000);
  });
  return () => { off(); window.clearTimeout(timer); };
}
