import { create } from "zustand";
import { isTauri } from "./native";
import { useSettings } from "./settings";

/**
 * Manuels de jeu (carnets feuilletables) : commandes natives (Rust › manuals)
 * et état partagé « quel jeu a un manuel ». Les PDF restent sur le disque ;
 * les sources ne sont nommées que dans les paramètres.
 */
export type ManualSource = "steam" | "screenscraper" | "archive";
export const MANUAL_SOURCES: ManualSource[] = ["steam", "screenscraper", "archive"];

export interface ManualInfo {
  gameId: number;
  source: ManualSource | "user";
  region: string | null;
  size: number;
  pages: number | null;
  addedAt: string;
}

export interface ManualCandidate {
  token: string;
  title: string;
  region: string | null;
  size: number | null;
  /** Confiance de la correspondance (0..1). */
  score: number;
}

export interface ManualSearch {
  candidates: ManualCandidate[];
  errors: string[];
}

export interface ManualAuto {
  status: "found" | "none" | "skipped" | "error";
  manual: ManualInfo | null;
  error: string | null;
}

export interface ManualStatus {
  screenscraperAvailable: boolean;
  screenscraperLogin: string | null;
  count: number;
  cacheBytes: number;
}

export interface FetchProgress {
  done: number;
  total: number;
  found: number;
  current: string | null;
  running: boolean;
}

export interface ScreenScraperUser {
  login: string;
  level: string | null;
  maxThreads: number | null;
  requestsToday: number | null;
  maxRequestsPerDay: number | null;
}

/** Correspondance appliquée sans demander (même seuil que la partie native). */
export const SURE_MATCH = 0.9;

export function manualOptions() {
  const s = useSettings.getState();
  return {
    sources: MANUAL_SOURCES.filter((id) => s.manualSources?.[id] !== false),
    region: s.preferredRegion,
    language: s.language ?? "fr",
  };
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

export const manualsApi = {
  list: () => call<ManualInfo[]>("manual_list"),
  read: (gameId: number) => call<ArrayBuffer>("manual_read", { gameId }),
  cover: (gameId: number) => call<ArrayBuffer>("manual_cover", { gameId }),
  saveCover: (gameId: number, jpegBase64: string, pages: number | null) => call<void>("manual_cover_save", { gameId, jpeg: jpegBase64, pages }),
  /** Page déjà rendue (JPEG, vide si absente du cache disque). */
  page: (gameId: number, page: number, width: number) => call<ArrayBuffer>("manual_page", { gameId, page, width }),
  savePage: (gameId: number, page: number, width: number, jpegBase64: string) => call<void>("manual_page_save", { gameId, page, width, jpeg: jpegBase64 }),
  layout: (gameId: number) => call<string | null>("manual_layout", { gameId }),
  saveLayout: (gameId: number, layout: string) => call<void>("manual_layout_save", { gameId, layout }),
  importFile: (gameId: number, path: string) => call<ManualInfo>("manual_import", { gameId, path }),
  remove: (gameId: number) => call<void>("manual_remove", { gameId }),
  search: (gameId: number) => call<ManualSearch>("manual_search", { gameId, options: manualOptions() }),
  apply: (gameId: number, token: string) => call<ManualInfo>("manual_apply", { gameId, token }),
  auto: (gameId: number, force = false) => call<ManualAuto>("manual_auto", { gameId, options: manualOptions(), force }),
  status: () => call<ManualStatus>("manual_status"),
  /** Manuels de toute la collection ; `force` : réinterroge aussi les jeux restés sans manuel. */
  fetchAll: (force = false) => call<FetchProgress>("manual_fetch_all", { options: manualOptions(), force }),
  cancelAll: () => call<void>("manual_fetch_cancel"),
  running: () => call<boolean>("manual_fetch_running"),
  clearDownloaded: () => call<number>("manual_clear_downloaded"),
  linkScreenScraper: (login: string, password: string) => call<ScreenScraperUser>("screenscraper_account_set", { login, password }),
  screenScraperInfo: () => call<ScreenScraperUser | null>("screenscraper_account_info"),
  unlinkScreenScraper: () => call<void>("screenscraper_account_delete"),

  async pickPdf(): Promise<string | null> {
    if (!isTauri()) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: false, title: "Choisir le manuel (PDF)", filters: [{ name: "PDF", extensions: ["pdf"] }] });
    return typeof picked === "string" ? picked : null;
  },
};

interface ManualsStore {
  byGame: Record<number, ManualInfo>;
  /** Incrémenté à chaque changement : invalide les couvertures et documents en cache. */
  revision: number;
  loaded: boolean;
  load: () => Promise<void>;
}

export const useManuals = create<ManualsStore>((set) => ({
  byGame: {},
  revision: 0,
  loaded: false,
  load: async () => {
    if (!isTauri()) return;
    try {
      const list = await manualsApi.list();
      set((s) => ({ byGame: Object.fromEntries(list.map((m) => [m.gameId, m])), revision: s.revision + 1, loaded: true }));
    } catch {
      set({ loaded: true });
    }
  },
}));

let watching = false;
/** Charge la liste une fois et la tient à jour (événement natif `manual://changed`). */
export function watchManuals(): void {
  if (watching || !isTauri()) return;
  watching = true;
  watchJob();
  void useManuals.getState().load();
  void import("@tauri-apps/api/event").then(({ listen }) => listen("manual://changed", () => void useManuals.getState().load()));
}

/** Manuel d'un jeu (null s'il n'en a pas). */
export function useManual(dbId: number | undefined): ManualInfo | null {
  return useManuals((s) => (dbId === undefined ? null : (s.byGame[dbId] ?? null)));
}

/** Région d'un manuel, en clair. */
export function regionLabel(region: string | null): string | null {
  if (!region) return null;
  const names: Record<string, string> = {
    fr: "Français",
    eu: "Europe",
    uk: "Royaume-Uni",
    us: "États-Unis",
    ca: "Canada",
    wor: "International",
    jp: "Japon",
    de: "Allemand",
    es: "Espagnol",
    sp: "Espagnol",
    it: "Italien",
    nl: "Néerlandais",
    pt: "Portugais",
    br: "Brésil",
    kr: "Coréen",
    cn: "Chinois",
    au: "Australie",
  };
  return names[region] ?? region.toUpperCase();
}

/** Recherche automatique à l'ouverture d'une fiche (silencieuse, une fois par session et par jeu). */
const tried = new Set<number>();
export function autoFetchManual(dbId: number | undefined): void {
  if (dbId === undefined || !isTauri() || tried.has(dbId)) return;
  if (useSettings.getState().manualAutoFetch === false) return;
  if (useManuals.getState().byGame[dbId]) return;
  tried.add(dbId);
  void manualsApi.auto(dbId).catch(() => undefined);
}

/* ——— récupération de toute la collection ——— */

interface ManualJob {
  progress: FetchProgress | null;
  /** Dernier résultat terminé (affiché dans les paramètres). */
  last: FetchProgress | null;
  error: string | null;
  run: (force?: boolean) => Promise<void>;
}

export const useManualJob = create<ManualJob>((set, get) => ({
  progress: null,
  last: null,
  error: null,
  run: async (force = false) => {
    if (!isTauri() || get().progress?.running) return;
    set({ error: null, progress: { done: 0, total: 0, found: 0, current: null, running: true } });
    try {
      const last = await manualsApi.fetchAll(force);
      set({ progress: null, last });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // déjà en cours (lancé ailleurs) : la progression arrive par l'événement
      if (/déjà en cours/i.test(msg)) return;
      set({ progress: null, error: msg });
    }
  },
}));

let jobWatch = false;
function watchJob(): void {
  if (jobWatch || !isTauri()) return;
  jobWatch = true;
  void import("@tauri-apps/api/event").then(({ listen }) =>
    listen<FetchProgress>("manual://progress", (e) => {
      const p = e.payload;
      useManualJob.setState(p.running ? { progress: p } : { progress: null, last: p.total ? p : useManualJob.getState().last });
    }),
  );
}

/**
 * Au démarrage : quand iBox est au repos, range dans chaque boîte le manuel
 * qui lui correspond (correspondances sûres seulement). Relancé quand de
 * nouveaux jeux arrivent dans la collection.
 */
export function scheduleManualFetch(gameCount: () => number, subscribe: (cb: () => void) => () => void): () => void {
  if (!isTauri()) return () => undefined;
  watchManuals();
  watchJob();
  let timer = window.setTimeout(start, 25_000);
  let known = gameCount();
  function start() {
    if (useSettings.getState().manualAutoFetch === false) return;
    void useManualJob.getState().run(false);
  }
  const off = subscribe(() => {
    const n = gameCount();
    if (n > known) {
      window.clearTimeout(timer);
      timer = window.setTimeout(start, 20_000);
    }
    known = n;
  });
  return () => {
    window.clearTimeout(timer);
    off();
  };
}
