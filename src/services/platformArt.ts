import { create } from "zustand";
import { useEffect, useState } from "react";
import { PLATFORMS } from "@/domain/platforms";
import { isTauri } from "./native";
import { notify } from "./notifications";

/**
 * iBox Asset Manager — illustrations des consoles (côté interface).
 *
 * Les composants n'appellent jamais iiDB eux-mêmes : ils lisent le catalogue
 * local (`usePlatformArt`) et ce service parle aux commandes natives, qui
 * téléchargent, valident et mettent en cache. Sans image, chaque composant
 * garde son propre habillage iBox.
 */
export type PlatformSlot = "platform_icon" | "platform_logo" | "platform_hero" | "platform_border";
export const PLATFORM_SLOTS: PlatformSlot[] = ["platform_icon", "platform_logo", "platform_hero", "platform_border"];
export const SLOT_LABEL: Record<PlatformSlot, string> = {
  platform_icon: "Icône",
  platform_logo: "Logo",
  platform_hero: "Illustration",
  platform_border: "Bordure",
};

export interface PlatformArt {
  platformId: string;
  slot: PlatformSlot;
  provider: "iidb" | "user";
  assetId: number | null;
  revision: string | null;
  width: number | null;
  height: number | null;
  /** auto : recommandé · manual : choisi dans une galerie · user : fichier importé */
  choice: "auto" | "manual" | "user";
  addedAt: string;
}

export interface PlatformLink {
  platformId: string;
  status: "matched" | "needs_choice" | "not_found" | "manual";
  remoteId: number | null;
  remoteName: string | null;
  candidates: [number, string][];
}

export interface IidbAccess {
  tier: string;
  requestsPerSecond: number;
  monthlyUsage: number;
  monthlySoftLimit: number;
  limitExceeded: boolean;
}

export interface Artwork {
  id: number;
  type: string;
  url: string;
  revision: string;
  region?: string | null;
  thumbnailUrl?: string | null;
  resolution?: string | null;
  displayName?: string | null;
  isAnimated?: boolean;
}

export interface GalleryPage {
  items: Artwork[];
  nextCursor: string | null;
  total: number;
}

export interface SyncReport {
  platforms: number;
  matched: number;
  needsChoice: number;
  notFound: number;
  downloaded: number;
  upToDate: number;
  keptManual: number;
  failed: number;
  errors: string[];
}

export interface AssetsStatus {
  connected: boolean;
  linked: number;
  assets: number;
  cacheBytes: number;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Identifiant de système envoyé à iiDB (normalisé côté serveur), et nom affiché. */
const CONSOLE_IDS: Record<string, string> = { gamecube: "gc", ps1: "psx" };
export const lookups = () =>
  PLATFORMS.map((p) => ({ id: p.id, consoleId: CONSOLE_IDS[p.id] ?? p.id, title: p.id === "pc" ? "PC" : p.name }));

export const artApi = {
  status: () => call<AssetsStatus>("assets_status"),
  connect: (key: string) => call<IidbAccess>("iidb_connect", { key }),
  access: () => call<IidbAccess>("iidb_access"),
  disconnect: () => call<void>("iidb_disconnect"),
  sync: () => call<SyncReport>("platform_art_sync", { lookups: lookups() }),
  list: () => call<[PlatformArt[], PlatformLink[]]>("platform_art_list"),
  read: (platformId: string, slot: PlatformSlot) => call<ArrayBuffer>("platform_art_read", { platformId, slot }),
  gallery: (platformId: string, slot: PlatformSlot, cursor?: string | null) =>
    call<GalleryPage>("platform_art_gallery", { platformId, slot, cursor: cursor ?? null }),
  choose: (platformId: string, slot: PlatformSlot, asset: Artwork) => call<PlatformArt>("platform_art_choose", { platformId, slot, asset }),
  import: (platformId: string, slot: PlatformSlot, path: string) => call<PlatformArt>("platform_art_import", { platformId, slot, path }),
  reset: (platformId: string, slot: PlatformSlot) => call<void>("platform_art_reset", { platformId, slot }),
  search: (q: string) => call<[number, string][]>("iidb_search_platforms", { q }),
  link: (platformId: string, remoteId: number, remoteName: string) =>
    call<void>("platform_link_choose", { platformId, remoteId, remoteName }),
  pickImage: async (): Promise<string | null> => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: false, directory: false, filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }] });
    return typeof picked === "string" ? picked : null;
  },
  onProgress: async (cb: (p: { done: number; total: number; current: string }) => void) => {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<{ done: number; total: number; current: string }>("platform-art-progress", (e) => cb(e.payload));
  },
};

interface ArtState {
  rows: PlatformArt[];
  links: PlatformLink[];
  loaded: boolean;
  sync: { running: boolean; progress?: { done: number; total: number; current: string }; report?: SyncReport; error?: string };
  refresh: () => Promise<void>;
  runSync: () => Promise<SyncReport | undefined>;
}

export const usePlatformArtStore = create<ArtState>((set, get) => ({
  rows: [],
  links: [],
  loaded: false,
  sync: { running: false },
  refresh: async () => {
    if (!isTauri()) return set({ loaded: true });
    try {
      const [rows, links] = await artApi.list();
      set({ rows, links, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  runSync: async () => {
    if (get().sync.running) return undefined;
    set({ sync: { running: true } });
    const unlisten = await artApi.onProgress((progress) => set((s) => ({ sync: { ...s.sync, progress } })));
    try {
      const report = await artApi.sync();
      await get().refresh();
      set({ sync: { running: false, report } });
      if (report.downloaded > 0) notify({ icon: "sparkle", tone: "ok", title: "Illustrations des consoles", body: `${report.downloaded} image${report.downloaded > 1 ? "s" : ""} iiDB`, link: { kind: "library", platformId: "all" } });
      return report;
    } catch (e) {
      set({ sync: { running: false, error: e instanceof Error ? e.message : String(e) } });
      return undefined;
    } finally {
      unlisten();
    }
  },
}));

// Adresses locales (blob:) partagées entre composants, par image et par version.
const urls = new Map<string, Promise<string | null>>();

function urlFor(row: PlatformArt): Promise<string | null> {
  const key = `${row.platformId}|${row.slot}|${row.addedAt}`;
  let p = urls.get(key);
  if (!p) {
    p = artApi
      .read(row.platformId, row.slot)
      .then((bytes) => URL.createObjectURL(new Blob([bytes])))
      .catch(() => null);
    urls.set(key, p);
  }
  return p;
}

/** Illustration d'une console pour un emplacement (null : habillage iBox). */
export function usePlatformArt(platformId: string, slot: PlatformSlot): string | null {
  const row = usePlatformArtStore((s) => s.rows.find((r) => r.platformId === platformId && r.slot === slot));
  const [url, setUrl] = useState<string | null>(null);
  const stamp = row ? `${row.platformId}|${row.slot}|${row.addedAt}` : null;
  useEffect(() => {
    if (!row) {
      setUrl(null);
      return;
    }
    let alive = true;
    void urlFor(row).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
  return url;
}

/** Dimensions connues d'une illustration (choix de mise en page). */
export function usePlatformArtRow(platformId: string, slot: PlatformSlot): PlatformArt | undefined {
  return usePlatformArtStore((s) => s.rows.find((r) => r.platformId === platformId && r.slot === slot));
}

// ——— Jeux ———

export interface GameSyncReport {
  resolved: number;
  matched: number;
  needsChoice: number;
  notFound: number;
  downloaded: number;
  failed: number;
  cancelled: boolean;
  errors: string[];
}
export interface GameSyncProgress {
  phase: "resolve" | "artwork" | "download" | "done";
  done: number;
  total: number;
  current: string;
}
export interface GameLinkStats {
  matched: number;
  needsChoice: number;
  notFound: number;
  unresolved: number;
  iidbImages: number;
}
export interface GameCandidate {
  id: number;
  name: string;
  year: number | null;
  platform: string | null;
}

export const gameArtApi = {
  sync: () => call<GameSyncReport>("games_art_sync"),
  cancel: () => call<void>("games_art_cancel"),
  stats: () => call<GameLinkStats>("games_art_stats"),
  candidates: (gameId: number, query?: string) => call<GameCandidate[]>("game_link_candidates", { gameId, query: query ?? null }),
  choose: (gameId: number, parentId: number, name: string) => call<void>("game_link_choose", { gameId, parentId, name }),
  onProgress: async (cb: (p: GameSyncProgress) => void) => {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<GameSyncProgress>("games-art-progress", (e) => cb(e.payload));
  },
};

interface GameArtState {
  running: boolean;
  progress?: GameSyncProgress;
  report?: GameSyncReport;
  error?: string;
  run: (onDone?: () => Promise<void>) => Promise<void>;
}

/** Récupération des illustrations des jeux (une à la fois, annulable). */
export const useGameArtSync = create<GameArtState>((set, get) => ({
  running: false,
  run: async (onDone) => {
    if (get().running) return;
    set({ running: true, error: undefined, report: undefined, progress: undefined });
    // consoles d'abord : leur identifiant iiDB oriente le choix des illustrations des jeux
    await usePlatformArtStore.getState().runSync();
    const unlisten = await gameArtApi.onProgress((progress) => set({ progress }));
    try {
      const report = await gameArtApi.sync();
      set({ running: false, report });
      if (report.downloaded > 0 || report.needsChoice > 0) notify({ icon: "download", tone: "ok", title: "Images des jeux (iiDB)", body: `${report.downloaded} ajoutée${report.downloaded > 1 ? "s" : ""}${report.needsChoice ? ` · ${report.needsChoice} jeux à associer` : ""}`, link: { kind: "settings", category: "images" } });
    } catch (e) {
      set({ running: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      unlisten();
      await onDone?.();
    }
  },
}));

export const IIDB_CREDIT = "Illustrations de consoles : iiDB (iisu.network) et leurs auteurs ; marques © leurs propriétaires.";
