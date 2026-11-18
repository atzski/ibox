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
  importFile: (gameId: number, path: string) => call<ManualInfo>("manual_import", { gameId, path }),
  remove: (gameId: number) => call<void>("manual_remove", { gameId }),
  search: (gameId: number) => call<ManualSearch>("manual_search", { gameId, options: manualOptions() }),
  apply: (gameId: number, token: string) => call<ManualInfo>("manual_apply", { gameId, token }),
  auto: (gameId: number, force = false) => call<ManualAuto>("manual_auto", { gameId, options: manualOptions(), force }),
  status: () => call<ManualStatus>("manual_status"),
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
