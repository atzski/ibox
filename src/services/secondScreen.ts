/**
 * Second écran des consoles Android (AYN Thor), côté fenêtre principale.
 *
 * L'écran du bas (`components/second/SecondScreen.tsx`) est une simple vue : cette fenêtre lui
 * pousse ce qu'il affiche (`SecondState`, plugin `ibox-android`, `second_screen_push`) et
 * exécute ses commandes tactiles (événement `second`). Base, Rust et réglages restent uniques.
 * Sans second écran, ou réglage coupé, rien n'est envoyé et rien ne change.
 *
 * Conception : docs/ANDROID.md, « Second écran ».
 */
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Game } from "@/domain/types";
import { getPlatform } from "@/domain/platforms";
import { useShell } from "@/app/shellState";
import { useNav } from "@/app/navigation";
import { useCommands } from "@/input/commands";
import { capabilities } from "./capabilities";
import { useSettings } from "./settings";
import { isFavorite, useLibrary } from "./library";
import { useLauncher } from "./launcher";
import { useCollections } from "./extras";
import { useManuals } from "./manuals";
import { useNowPlaying } from "./nowPlaying";
import { useInetbox } from "./inetbox";
import { raApi, raBadge, resolveRaId, useRaLive } from "./retro";
import { normalizeBlocks } from "./homeLayout";
import { sound } from "./sound";
import {
  parseCommand,
  secondPrefs,
  yieldsScreen,
  type SecondAchievements,
  type SecondCommand,
  type SecondGame,
  type SecondScreenPrefs,
  type SecondState,
} from "@/components/second/model";

export interface SecondDisplay {
  id: number;
  name: string;
  width: number;
  height: number;
  density: number;
  presentation: boolean;
  target: boolean;
}

export interface SecondStatus {
  available: boolean;
  displays: SecondDisplay[];
  enabled: boolean;
  active: boolean;
  surface?: "activity" | "presentation" | null;
  bridge: boolean;
  displayId?: number | null;
}

interface SecondStore {
  status: SecondStatus | null;
}

/** État du second écran vu par Android (Paramètres › Second écran). */
export const useSecondScreen = create<SecondStore>(() => ({ status: null }));

export const secondScreenApi = {
  status: () => invoke<SecondStatus>("second_screen_status"),
  configure: (enabled: boolean, yielded: boolean, mode = "auto") => invoke<SecondStatus>("second_screen_configure", { enabled, mode, yielded }),
  push: (state: string) => invoke<void>("second_screen_push", { state }),
};

/** Réglages de l'écran du bas (Paramètres). */
export const useSecondPrefs = (): SecondScreenPrefs => secondPrefs(useSettings((s) => s.secondScreen));
export function setSecondPrefs(patch: Partial<SecondScreenPrefs>): void {
  const s = useSettings.getState();
  s.set("secondScreen", { ...secondPrefs(s.secondScreen), ...patch });
}

// ——— Notes des jeux (écrites en bas, gardées ici) ———

const NOTES_KEY = "ibox.gameNotes";
function readNotes(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(NOTES_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}
export function gameNote(gameId: string): string {
  return readNotes()[gameId] ?? "";
}
function saveNote(gameId: string, text: string) {
  const all = readNotes();
  if (text.trim()) all[gameId] = text;
  else delete all[gameId];
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(all)); } catch { /* stockage plein */ }
}

// ——— Construction de l'état ———

const covers = new Map<string, Promise<string | undefined>>();

/** Jaquette réduite pour l'écran du bas (JPEG en `data:`, environ 40 Ko). */
function coverOf(game: Game): Promise<string | undefined> {
  const key = `${game.id}|${game.media?.find((m) => m.kind === "front")?.addedAt ?? ""}`;
  let p = covers.get(key);
  if (!p) {
    p = import("@/art/covers")
      .then(({ getArtCanvas }) => getArtCanvas(game, "front"))
      .then((canvas) => {
        const w = 420;
        const h = Math.round((canvas.height / canvas.width) * w) || w;
        const out = document.createElement("canvas");
        out.width = w;
        out.height = h;
        out.getContext("2d")?.drawImage(canvas, 0, 0, w, h);
        return out.toDataURL("image/jpeg", 0.86);
      })
      .catch(() => undefined);
    covers.set(key, p);
    if (covers.size > 40) covers.delete(covers.keys().next().value as string);
  }
  return p;
}

function gameOf(game: Game, cover: string | undefined): SecondGame {
  const platform = getPlatform(game.platformId);
  const manual = game.dbId !== undefined ? useManuals.getState().byGame[game.dbId] : undefined;
  return {
    id: game.id,
    title: game.title,
    platformId: game.platformId,
    platform: platform?.name ?? game.platformId,
    tint: platform ? [platform.theme.primary, platform.theme.deep] : ["#B9A6E8", "#6A54B4"],
    year: game.year,
    developer: game.developer ?? game.publisher,
    genre: game.genre,
    players: game.players,
    summary: game.description,
    playSeconds: game.playSeconds,
    playCount: game.playCount,
    lastPlayedAt: game.lastPlayedAt,
    favorite: isFavorite(game, useSettings.getState().favorites),
    cover,
    hasManual: !!manual,
    manualPages: manual?.pages ?? null,
  };
}

/** Jeu concerné : celui en cours, sinon celui choisi dans les menus. */
function currentGame(): Game | null {
  const { current } = useLauncher.getState();
  const games = useLibrary.getState().games;
  if (current) return games.find((g) => g.dbId === current.gameId) ?? null;
  return useShell.getState().ambientGame;
}

function phase(): SecondState["phase"] {
  const p = useLauncher.getState().phase;
  return p === "running" ? "playing" : p === "animating" || p === "starting" ? "launching" : "menu";
}

// ——— Succès de la partie en cours ———

let achievements: { gameId: string; data: SecondAchievements } | null = null;
let achievementsFor: string | null = null;

async function loadAchievements(game: Game, force: boolean) {
  const user = useSettings.getState().raUsername;
  achievementsFor = game.id;
  if (!user) {
    achievements = { gameId: game.id, data: { linked: false, earned: 0, total: 0, points: 0, list: [] } };
    return schedule();
  }
  try {
    const raId = await resolveRaId(game);
    if (!raId) {
      achievements = { gameId: game.id, data: { linked: true, earned: 0, total: 0, points: 0, list: [] } };
      return schedule();
    }
    const detail = await raApi.game(raId, user, force);
    const fresh = new Set(useRaLive.getState().unlocked.filter((a) => a.gameId === raId).map((a) => a.id));
    const list = detail.achievements.map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      points: a.points,
      badge: raBadge(a.badge, !(a.earnedAt || fresh.has(a.id))),
      earned: !!(a.earnedAt || fresh.has(a.id)),
      fresh: fresh.has(a.id),
    }));
    // fraîchement débloqués d'abord, puis à obtenir, puis obtenus
    list.sort((a, b) => Number(!!b.fresh) - Number(!!a.fresh) || Number(a.earned) - Number(b.earned));
    if (achievementsFor !== game.id) return;
    achievements = {
      gameId: game.id,
      data: { linked: true, earned: list.filter((a) => a.earned).length, total: list.length, points: list.filter((a) => a.earned).reduce((n, a) => n + a.points, 0), list: list.slice(0, 60) },
    };
    schedule();
  } catch {
    /* hors ligne : la liste reviendra à la prochaine annonce */
  }
}

// ——— Manuel ———

let manualPage: SecondState["manualPage"] = null;

async function showManualPage(index: number) {
  const game = currentGame();
  const manual = game?.dbId !== undefined ? useManuals.getState().byGame[game.dbId] : undefined;
  if (!game || !manual) return;
  try {
    const { pageRatios, renderPage } = await import("./manualPdf");
    const count = (await pageRatios(manual.gameId, manual.addedAt)).length;
    const n = Math.min(Math.max(0, index), Math.max(0, count - 1));
    const page = await renderPage(manual.gameId, manual.addedAt, n, 1000);
    const src = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(page.blob);
    });
    manualPage = { index: n, count, src };
    schedule();
  } catch (e) {
    console.warn("iBox : page du manuel pour l'écran du bas", e);
  }
}

// ——— Envoi ———

let timer: number | undefined;
let lastSent = "";
let running = false;

function schedule() {
  if (!running) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void send(), 120);
}

async function send() {
  const s = useSettings.getState();
  const prefs = secondPrefs(s.secondScreen);
  const status = useSecondScreen.getState().status;
  if (!prefs.enabled || !status?.available) return;
  // assistant ouvert : l'accueil derrière lui choisit déjà un jeu, qui n'a rien à faire en bas (D15)
  const setup = !s.setupDone;
  const game = setup ? null : currentGame();
  const cover = game ? await coverOf(game) : undefined;
  const music = useNowPlaying.getState();
  const now = music.enabled ? music.state?.now : null;
  const launcher = useLauncher.getState();
  const dark = document.documentElement.dataset.theme === "dark";
  const state: SecondState = {
    v: 1,
    lang: s.language === "en" ? "en" : "fr",
    dark,
    reduced: document.documentElement.dataset.motion === "reduced",
    sound: { enabled: s.soundEnabled, volume: s.soundVolume },
    prefs,
    phase: phase(),
    setup,
    game: game ? gameOf(game, cover) : null,
    session: launcher.current ? { startedAt: launcher.current.startedAt, emulator: launcher.current.emulatorName } : null,
    achievements: game && achievements?.gameId === game.id ? achievements.data : null,
    music: now ? { title: now.title, artist: now.artist, playing: now.playing, artwork: now.artwork } : null,
    collections: useCollections.getState().list.map((c) => ({ id: c.id, name: c.name, color: c.color, count: c.gameIds.length })),
    note: game ? gameNote(game.id) : "",
    manualPage: game && manualPage ? manualPage : null,
    libraryCount: useLibrary.getState().games.length,
    friendsOnline: useInetbox.getState().status === "online" ? useInetbox.getState().friends.filter((f) => f.status !== "offline").length : 0,
  };
  const json = JSON.stringify(state);
  if (json === lastSent) return;
  lastSent = json;
  await secondScreenApi.push(json).catch(() => undefined);
}

// ——— Commandes du bas ———

function openCollection(id: number) {
  const s = useSettings.getState();
  s.set("homeBlocks", normalizeBlocks(s.homeBlocks).map((b) => (b.id === "collections" ? { ...b, visible: true } : b)));
  const nav = useNav.getState();
  const away = nav.stack.length > 1;
  if (away) nav.home();
  window.setTimeout(() => window.dispatchEvent(new CustomEvent("ibox:open-collection", { detail: id })), away ? 650 : 16);
}

/** Exécute un toucher de l'écran du bas sur l'écran du haut. */
export function runSecondCommand(cmd: SecondCommand): void {
  const nav = useNav.getState();
  const playing = useLauncher.getState().phase === "running";
  switch (cmd.type) {
    case "ready":
      lastSent = "";
      return schedule();
    case "open":
      // pendant une partie, iBox est derrière l'émulateur : rien à ouvrir en haut
      if (playing) return;
      if (cmd.target === "search") useCommands.getState().setSearch(true);
      else if (cmd.target === "friends") window.dispatchEvent(new CustomEvent("ibox:open-friends"));
      else if (cmd.target === "library" || cmd.target === "collections") nav.go({ name: "library", platformId: "all" });
      else if (cmd.target === "achievements") nav.go({ name: "achievements" });
      else if (cmd.target === "settings") nav.go({ name: "settings" });
      return;
    case "collection":
      if (!playing) openCollection(cmd.id);
      return;
    case "game": {
      const game = currentGame();
      if (!game || playing) return;
      if (cmd.action === "open") nav.go({ name: "game", gameId: game.id });
      else if (cmd.action === "play" && game.dbId !== undefined) void useLauncher.getState().play(game.dbId, game.title);
      else if (cmd.action === "favorite") void useLibrary.getState().toggleFavorite(game).then(schedule);
      return;
    }
    case "return":
      // iBox revient déjà au premier plan (Kotlin) ; la session se clôt comme au retour habituel
      sound.play("home");
      return;
    case "manual":
      return void showManualPage(cmd.index);
    case "note":
      saveNote(cmd.gameId, cmd.text);
      return schedule();
    case "music":
      return void useNowPlaying.getState().control(cmd.action).then(schedule, () => undefined);
  }
}

// ——— Démarrage ———

/** Réglages envoyés l'un après l'autre (deux appels concurrents pourraient arriver dans le désordre). */
let configuring: Promise<void> = Promise.resolve();
function configure(): Promise<void> {
  configuring = configuring.then(applyConfig, applyConfig);
  return configuring;
}

async function applyConfig() {
  const s = useSettings.getState();
  const prefs = secondPrefs(s.secondScreen);
  const game = currentGame();
  const { phase: launch } = useLauncher.getState();
  // iBox quitté (accueil d'Android, autre application) hors d'une partie : l'écran du bas est rendu
  // au système ; pendant une partie, il reste (sauf jeux DS et 3DS)
  const away = document.hidden && (launch === "idle" || launch === "error");
  const yielded = away || (launch === "running" && yieldsScreen(game?.platformId, prefs));
  const status = await secondScreenApi.configure(prefs.enabled, yielded, prefs.surface ?? "auto").catch(() => null);
  if (status) useSecondScreen.setState({ status });
  lastSent = "";
  schedule();
}

/**
 * Écran du bas (Android). Appelé une fois au démarrage (App) ; sans capacité `secondScreen`
 * (bureau, Steam Deck), ne fait rien.
 */
export function startSecondScreen(): () => void {
  if (!capabilities().secondScreen) return () => undefined;
  running = true;
  const offs: Array<() => void> = [];
  let stopped = false;

  void (async () => {
    const { addPluginListener } = await import("@tauri-apps/api/core");
    const listener = await addPluginListener<{ type: string; status?: SecondStatus; command?: unknown }>("ibox-android", "second", (e) => {
      if (e.type === "displays" && e.status) {
        const had = useSecondScreen.getState().status?.active;
        useSecondScreen.setState({ status: e.status });
        if (e.status.active && !had) lastSent = "";
        schedule();
      } else if (e.type === "command") {
        const cmd = parseCommand(e.command);
        if (cmd) runSecondCommand(cmd);
      }
    });
    if (stopped) return void listener.unregister();
    offs.push(() => void listener.unregister());
    await configure();
  })().catch((e) => console.warn("iBox : second écran indisponible", e));

  // ce qui change l'écran du bas
  let lastPrefs = JSON.stringify(secondPrefs(useSettings.getState().secondScreen));
  offs.push(
    useSettings.subscribe((s) => {
      const p = JSON.stringify(secondPrefs(s.secondScreen));
      if (p !== lastPrefs) {
        lastPrefs = p;
        void configure();
      } else schedule();
    }),
  );
  offs.push(useShell.subscribe((s, prev) => s.ambientGame !== prev.ambientGame && schedule()));
  offs.push(useLibrary.subscribe((s, prev) => s.games !== prev.games && schedule()));
  offs.push(useCollections.subscribe(schedule));
  offs.push(useManuals.subscribe(schedule));
  offs.push(useNowPlaying.subscribe(schedule));
  offs.push(useInetbox.subscribe((s, prev) => s.friends !== prev.friends && schedule()));
  offs.push(
    useLauncher.subscribe((s, prev) => {
      if (s.phase === prev.phase && s.current === prev.current) return;
      manualPage = null;
      const game = currentGame();
      if (s.phase === "running" && game) void loadAchievements(game, false);
      if (s.phase === "running" || prev.phase === "running") void configure();
      else schedule();
    }),
  );
  // visibilité stable seulement : une pause brève (iBox ramené devant son écran) ne ferme rien
  let visibilityTimer: number | undefined;
  const onVisibility = () => {
    window.clearTimeout(visibilityTimer);
    visibilityTimer = window.setTimeout(() => void configure(), 800);
  };
  document.addEventListener("visibilitychange", onVisibility);
  offs.push(() => {
    window.clearTimeout(visibilityTimer);
    document.removeEventListener("visibilitychange", onVisibility);
  });
  // un succès annoncé en direct : la liste est relue
  offs.push(
    useRaLive.subscribe((s, prev) => {
      const game = currentGame();
      if (s.last !== prev.last && game) void loadAchievements(game, true);
    }),
  );
  return () => {
    stopped = true;
    running = false;
    window.clearTimeout(timer);
    offs.forEach((off) => off());
  };
}
