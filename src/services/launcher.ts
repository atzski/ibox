import { create } from "zustand";
import { isTauri } from "./native";
import { usePlatform } from "./platform";
import { useSettings } from "./settings";
import { music } from "./music";
import { sound } from "./sound";

/**
 * Émulateurs et lancement des jeux (Rust › launcher::commands).
 * iBox ne télécharge aucun émulateur : l'utilisateur désigne ceux qu'il a installés.
 */
export interface Emulator {
  id: number;
  profileId: string;
  profileName: string;
  name: string;
  exePath: string;
  args: string[];
  fullscreen: boolean;
  cores: Record<string, string>;
  needsCore: boolean;
  platforms: string[];
  suggestedPlatforms: string[];
  available: boolean;
  /** managed : installé par iBox Platforms ; detected : trouvé sur Windows ; manual : ajouté à la main. */
  origin: "managed" | "detected" | "manual";
  packageId: string | null;
  version: string | null;
}

export interface Suggestion {
  exePath: string;
  profileId: string;
  name: string;
  platforms: string[];
}

export interface LaunchPlan {
  gameId: number;
  title: string;
  emulatorId: number | null;
  emulatorName: string;
  exe: string;
  args: string[];
  perGame: boolean;
  display: string;
}

export interface Running {
  gameId: number;
  title: string;
  emulatorName: string;
  startedAt: string;
  pid: number;
}

export interface Ended {
  gameId: number;
  title: string;
  seconds: number;
  exitCode: number | null;
  error: string | null;
  /** Lancé par une boutique : la boutique suit la partie. */
  detached?: boolean;
}

/** Jeu de boutique (Steam) que la boutique fait tourner et qu'iBox suit (`launch://store-game`). */
export interface StoreGame {
  gameId: number;
  title: string;
  /** Numéro du suivi natif : un arrêt ne vaut que pour le suivi qui l'a annoncé. */
  follow: number;
}

export interface StoreGameEvent extends StoreGame {
  running: boolean;
}

/**
 * Jeu de boutique suivi après un événement natif. Un arrêt sans numéro (`follow` 0, nouveau
 * lancement) efface tout ; l'arrêt d'un ancien suivi ne touche pas au jeu suivi depuis.
 */
export function nextStoreGame(current: StoreGame | null, e: StoreGameEvent): StoreGame | null {
  if (e.running) return { gameId: e.gameId, title: e.title, follow: e.follow };
  return current && e.follow !== 0 && e.follow !== current.follow ? current : null;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error("Disponible uniquement dans l'application Windows.");
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : "Erreur inattendue.");
  }
}

/** Le jeu est-il une application Android de la bibliothèque ? */
async function isAndroidAppId(gameId: number): Promise<boolean> {
  const { useLibrary } = await import("./library");
  return useLibrary.getState().realGames.some((g) => g.dbId === gameId && g.platformId === "android");
}

export const launcherApi = {
  list: () => call<Emulator[]>("emulators_list"),
  add: (exePath: string) => call<Emulator>("emulator_add", { exePath }),
  update: (id: number, patch: { name: string; args: string[]; fullscreen: boolean; cores: Record<string, string> }) =>
    call<Emulator>("emulator_update", { id, ...patch }),
  remove: (id: number) => call<void>("emulator_remove", { id }),
  cores: (id: number) => call<string[]>("emulator_cores", { id }),
  platformMap: () => call<Record<string, number>>("platform_emulators"),
  setPlatform: (platformId: string, emulatorId: number | null) => call<void>("platform_emulator_set", { platformId, emulatorId }),
  setGame: (gameId: number, emulatorId: number | null) => call<void>("game_emulator_set", { gameId, emulatorId }),
  splitArgs: (text: string) => call<string[]>("args_split", { text }),
  // applications Android (console « android ») : ouvertes par leur intent de lancement
  plan: async (gameId: number) => call<LaunchPlan>((await isAndroidAppId(gameId)) ? "android_app_plan" : "launch_plan", { gameId }),
  detect: () => call<Suggestion[]>("emulators_detect"),
  status: () => call<Running | null>("launch_status"),
  launch: async (gameId: number) => call<Running>((await isAndroidAppId(gameId)) ? "android_app_launch" : "game_launch", { gameId }),
  adoptRunning: () => call<Running | null>("game_adopt_running"),

  async pickExe(): Promise<string | null> {
    if (!isTauri()) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    // Linux (Steam Deck) : AppImage, ou tout fichier pour un lanceur Flatpak ou un programme sans
    // extension (le natif vérifie qu'il est exécutable). Windows : les .exe seulement.
    const linux = usePlatform.getState().os === "linux";
    const picked = await open({
      multiple: false,
      title: "Choisir le programme de l'émulateur",
      filters: linux
        ? [{ name: "AppImage", extensions: ["AppImage", "appimage"] }, { name: "Tous les fichiers", extensions: ["*"] }]
        : [{ name: "Programmes", extensions: ["exe"] }],
    });
    return typeof picked === "string" ? picked : null;
  },
};

/** Étapes d'un lancement, pour l'animation et les messages. */
export type LaunchPhase = "idle" | "animating" | "starting" | "running" | "error";

interface LauncherState {
  emulators: Emulator[];
  platformMap: Record<string, number>;
  loaded: boolean;
  phase: LaunchPhase;
  /** Jeu en cours de lancement ou en cours de partie. */
  current: { gameId: number; title: string; emulatorName?: string; startedAt?: number } | null;
  /**
   * Jeu Steam en cours, lancé depuis iBox et tenu par Steam (Linux). Il met l'interface au repos
   * derrière le jeu mais ne bloque pas « Jouer » : `phase` est déjà revenue à « idle ».
   */
  storeGame: StoreGame | null;
  error: string | null;
  lastEnded: Ended | null;

  load: () => Promise<void>;
  /** Demande de lancement : animation éventuelle, puis démarrage natif. */
  play: (gameId: number, title: string) => Promise<void>;
  dismiss: () => void;
  attach: () => Promise<() => void>;
  /** Jeu PC ajouté alors qu'il tourne déjà : suivi comme s'il avait été lancé par iBox. */
  adoptRunning: () => Promise<void>;
}

export const useLauncher = create<LauncherState>((set, get) => ({
  emulators: [],
  platformMap: {},
  loaded: false,
  phase: "idle",
  current: null,
  storeGame: null,
  error: null,
  lastEnded: null,

  load: async () => {
    if (!isTauri()) return;
    const [emulators, platformMap, running] = await Promise.all([launcherApi.list(), launcherApi.platformMap(), launcherApi.status()]);
    set({ emulators, platformMap, loaded: true });
    if (running) {
      set({ phase: "running", current: { gameId: running.gameId, title: running.title, emulatorName: running.emulatorName, startedAt: Date.parse(running.startedAt) } });
      music.setSuspended(true);
    }
  },

  play: async (gameId, title) => {
    if (get().phase === "animating" || get().phase === "starting" || get().phase === "running") return;
    // Vérification préalable : une erreur s'affiche tout de suite, sans animation
    try {
      await launcherApi.plan(gameId);
    } catch (e) {
      sound.play("error");
      set({ phase: "error", current: { gameId, title }, error: e instanceof Error ? e.message : String(e), lastEnded: null });
      return;
    }
    const { launchAnimation, motion } = useSettings.getState();
    const reduced = motion === "reduced" || (motion === "system" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    set({ phase: launchAnimation && !reduced ? "animating" : "starting", current: { gameId, title }, error: null, lastEnded: null });
    sound.play("launch");
    // L'animation (boîtier qui se ferme, disque mis en valeur) précède le démarrage
    if (launchAnimation && !reduced) await new Promise((r) => setTimeout(r, 1500));
    set({ phase: "starting" });
    try {
      const running = await launcherApi.launch(gameId);
      music.setSuspended(true);
      set({ phase: "running", current: { gameId, title, emulatorName: running.emulatorName, startedAt: Date.now() } });
    } catch (e) {
      sound.play("error");
      set({ phase: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },

  adoptRunning: async () => {
    if (!isTauri() || get().phase !== "idle") return;
    const running = await launcherApi.adoptRunning().catch(() => null);
    if (!running) return;
    music.setSuspended(true);
    set({ phase: "running", current: { gameId: running.gameId, title: running.title, emulatorName: running.emulatorName, startedAt: Date.parse(running.startedAt) }, error: null, lastEnded: null });
  },

  dismiss: () => set({ phase: get().phase === "running" ? "running" : "idle", error: null, lastEnded: null }),

  /** Écoute la fin des sessions (à appeler une fois au démarrage). */
  attach: async () => {
    if (!isTauri()) return () => undefined;
    const { listen } = await import("@tauri-apps/api/event");
    // jeu Steam suivi par le natif : la musique se tait et l'interface se repose pendant la partie
    const offStore = await listen<StoreGameEvent>("launch://store-game", (e) => {
      const storeGame = nextStoreGame(get().storeGame, e.payload);
      if (storeGame === get().storeGame) return;
      set({ storeGame });
      music.setSuspended(storeGame !== null || get().phase === "running");
    });
    const offEnded = await listen<Ended>("launch://ended", (e) => {
      music.setSuspended(get().storeGame !== null);
      const ended = e.payload;
      if (ended.error) {
        sound.play("error");
        set({ phase: "error", error: ended.error, current: null, lastEnded: ended });
      } else {
        set({ phase: "idle", current: null, lastEnded: ended });
      }
      // l'historique de jeu (dernière partie, temps de jeu) a changé
      void import("./library").then(({ useLibrary }) => useLibrary.getState().reload());
    });
    return () => {
      offStore();
      offEnded();
    };
  },
}));

/** « 1 h 25 », « 12 min », « quelques secondes ». */
export function formatPlayTime(seconds: number): string {
  if (seconds < 60) return "quelques secondes";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}
