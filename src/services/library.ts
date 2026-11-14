import { create } from "zustand";
import type { Game, PlatformId } from "@/domain/types";
import { DEMO_GAMES } from "@/domain/demoLibrary";
import { PC_DEMO_GAMES } from "@/domain/pcDemo";
import { isFamilyOnly, isHidden, pcApi, type PcSyncSummary } from "./pc";
import { requirePlatform, getPlatform } from "@/domain/platforms";
import { sortKey } from "@/domain/text";
import { isTauri } from "./native";
import {
  nativeLibrary,
  type FolderDto,
  type GamePatch,
  type GameRowDto,
  type ScanProgress,
  type ScanSummary,
} from "./nativeLibrary";
import { useSettings } from "./settings";
import { notify } from "./notifications";
import { metadataApi, type JobProgress, type JobSummary } from "./metadata";

/**
 * Collection de jeux.
 *
 * - Dans l'application Windows : jeux réels lus en base SQLite (commandes Rust).
 * - Les jeux de démonstration s'affichent tant qu'aucun vrai jeu n'est trouvé,
 *   ou toujours si le réglage « Afficher les jeux de démonstration » est activé.
 * - Dans un navigateur (aperçu de développement) : démonstration uniquement.
 */
export interface ScanState {
  running: boolean;
  progress?: ScanProgress;
  summary?: ScanSummary;
  error?: string;
  /** Horodatage de fin, pour l'affichage temporaire du résumé. */
  finishedAt?: number;
}

export interface MetaJobState {
  running: boolean;
  progress?: JobProgress;
  summary?: JobSummary;
  error?: string;
  finishedAt?: number;
}

interface LibraryState {
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  native: boolean;
  realGames: Game[];
  folders: FolderDto[];
  /** Jeux affichés (réels + démo selon la règle ci-dessus). */
  games: Game[];
  demoVisible: boolean;
  scan: ScanState;
  meta: MetaJobState;

  load: () => Promise<void>;
  reload: () => Promise<void>;
  /** Boutiques PC : synchronisation (jeux installés). */
  pcSync: { running: boolean; summaries?: PcSyncSummary[]; at?: number; error?: string };
  syncPc: () => Promise<PcSyncSummary[]>;
  addFolder: (path: string, platformId?: string | null) => Promise<FolderDto>;
  updateFolder: (id: number, platformId: string | null, enabled: boolean) => Promise<void>;
  removeFolder: (id: number) => Promise<void>;
  /** Retire un jeu dont le fichier est introuvable. */
  removeMissingGame: (dbId: number) => Promise<void>;
  startScan: (folderIds?: number[]) => Promise<ScanSummary | undefined>;
  cancelScan: () => Promise<void>;
  dismissScanResult: () => void;
  toggleFavorite: (game: Game) => Promise<void>;
  correctGame: (game: Game, patch: GamePatch) => Promise<void>;
  /** Récupère infos et images. Sans `gameIds` : les jeux jamais traités. */
  fetchMetadata: (gameIds?: number[] | null, opts?: { force?: boolean; refreshRefs?: boolean }) => Promise<JobSummary | undefined>;
  cancelMetadata: () => Promise<void>;
  dismissMetaResult: () => void;
}

/** Ligne SQLite → jeu affichable (habillage élégant aux couleurs de la console). */
export function rowToGame(row: GameRowDto): Game {
  const platform = getPlatform(row.platformId);
  const t = platform?.theme;
  return {
    id: `lib-${row.id}`,
    dbId: row.id,
    platformId: row.platformId,
    title: row.title,
    sortTitle: sortKey(row.title),
    year: row.year ?? undefined,
    publisher: row.publisher ?? undefined,
    developer: row.developer ?? undefined,
    genre: row.genre ?? undefined,
    players: row.players ?? undefined,
    region: row.region ?? undefined,
    description: row.description ?? undefined,
    filePath: row.filePath,
    addedAt: row.addedAt,
    lastPlayedAt: row.lastPlayedAt ?? undefined,
    favorite: row.favorite,
    missing: row.status === "missing",
    needsReview: row.idConfidence < 0.5,
    duplicate: row.duplicate,
    alternatives: row.alternatives,
    serial: row.serial ?? undefined,
    idMethod: row.idMethod,
    fileSize: row.fileSize,
    discCount: row.discCount,
    media: row.media ?? [],
    mediaStatus: row.mediaStatus,
    metaSource: row.metaSource,
    emulatorId: row.emulatorId,
    playCount: row.playCount,
    playSeconds: row.playSeconds,
    pcInstalls: row.pcInstalls ?? [],
    art: {
      motif: "placeholder",
      palette: t ? [t.soft, t.primary, t.deep, t.primary, "#ffffff"] : ["#EAF6FD", "#8CCDF1", "#2F7FB0", "#8CCDF1", "#ffffff"],
    },
  };
}

function visible(all: Game[], showDemo: boolean): { games: Game[]; demoVisible: boolean } {
  // outils et logiciels masqués par l'utilisateur (Steam…) : hors de la collection ;
  // jeux de la Famille Steam non installés : seulement si l'option est active
  const family = useSettings.getState().steamFamily !== false;
  const real = all.filter((g) => !isHidden(g) && (family || !isFamilyOnly(g)));
  const demoVisible = real.length === 0 || showDemo;
  return { games: demoVisible ? [...real, ...DEMO_GAMES] : real, demoVisible };
}

export const useLibrary = create<LibraryState>((set, get) => {
  const setReal = (realGames: Game[]) =>
    set({ realGames, ...visible(realGames, useSettings.getState().showDemoGames) });

  const refresh = async () => {
    const [rows, folders] = await Promise.all([nativeLibrary.listGames(), nativeLibrary.listFolders()]);
    set({ folders });
    setReal(rows.map(rowToGame));
  };

  return {
    status: "idle",
    native: isTauri(),
    realGames: [],
    folders: [],
    games: [],
    demoVisible: true,
    scan: { running: false },
    meta: { running: false },
    pcSync: { running: false },

    load: async () => {
      if (get().status === "loading") return;
      set({ status: "loading", error: undefined });
      try {
        if (get().native) await refresh();
        else setReal([]);
        set({ status: "ready" });
        // jeux PC des boutiques (Steam…) : lus en arrière-plan, sans bloquer l'accueil
        if (get().native) void get().syncPc();
      } catch (e) {
        setReal([]);
        set({ status: "error", error: message(e, "La collection n'a pas pu être chargée.") });
      }
    },

    reload: async () => {
      if (get().native) await refresh();
    },

    syncPc: async () => {
      if (!get().native || get().pcSync.running) return [];
      set({ pcSync: { running: true } });
      try {
        // boutiques lues par défaut, sauf celles que l'utilisateur a désactivées
        const prefs = useSettings.getState().pcConnectors;
        const enabled = PC_SYNC_SOURCES.filter((id) => prefs[id] !== false);
        if (prefs.steam !== false && useSettings.getState().steamFamily !== false) enabled.push("steam-family");
        const summaries = await pcApi.sync(enabled);
        await refresh();
        set({ pcSync: { running: false, summaries, at: Date.now() } });
        const added = summaries.reduce((n, s) => n + s.added, 0);
        if (added > 0) notify({ icon: "plus", tone: "ok", title: `${added} nouveau${added > 1 ? "x" : ""} jeu${added > 1 ? "x" : ""} PC`, body: summaries.filter((s) => s.added).map((s) => `${s.source} : ${s.added}`).join(" · ") });
        for (const s of summaries) if (s.warning) notify({ icon: "lock", tone: "warn", title: "Boutique PC", body: s.warning });
        // jaquettes, fonds et logos des nouveaux jeux
        const fresh = summaries.flatMap((s) => s.newGameIds);
        if (fresh.length && useSettings.getState().autoFetchMetadata) void get().fetchMetadata(fresh);
        return summaries;
      } catch (e) {
        set({ pcSync: { running: false, error: message(e, "Les boutiques PC n'ont pas pu être lues.") } });
        return [];
      }
    },

    addFolder: async (path, platformId = null) => {
      const folder = await nativeLibrary.addFolder(path, platformId);
      set({ folders: await nativeLibrary.listFolders() });
      return folder;
    },

    updateFolder: async (id, platformId, enabled) => {
      await nativeLibrary.updateFolder(id, platformId, enabled);
      set({ folders: await nativeLibrary.listFolders() });
    },

    removeFolder: async (id) => {
      await nativeLibrary.removeFolder(id);
      await refresh();
    },

    removeMissingGame: async (dbId) => {
      await nativeLibrary.removeMissingGame(dbId);
      await refresh();
    },

    startScan: async (folderIds) => {
      if (get().scan.running) return undefined;
      set({ scan: { running: true } });
      const unlisten = await nativeLibrary.onScanProgress((progress) =>
        set((s) => ({ scan: { ...s.scan, progress } })),
      );
      try {
        const summary = await nativeLibrary.scan(folderIds);
        await refresh();
        set({ scan: { running: false, summary, finishedAt: Date.now() } });
        if (summary.added > 0 || summary.missing > 0)
          notify({ icon: "folder", tone: summary.missing ? "warn" : "ok", title: "Collection actualisée", body: [summary.added && `${summary.added} ajouté${summary.added > 1 ? "s" : ""}`, summary.missing && `${summary.missing} introuvable${summary.missing > 1 ? "s" : ""}`].filter(Boolean).join(" · ") });
        // Jaquettes et infos des nouveaux jeux, en arrière-plan
        if (useSettings.getState().autoFetchMetadata && (summary.added > 0 || summary.updated > 0 || summary.moved > 0)) {
          void get().fetchMetadata(null);
        }
        return summary;
      } catch (e) {
        set({ scan: { running: false, error: message(e, "L'actualisation a échoué."), finishedAt: Date.now() } });
        await refresh().catch(() => undefined);
        return undefined;
      } finally {
        unlisten();
      }
    },

    cancelScan: async () => {
      await nativeLibrary.cancelScan();
    },

    dismissScanResult: () => set((s) => ({ scan: { running: s.scan.running, progress: s.scan.progress } })),

    toggleFavorite: async (game) => {
      if (game.dbId === undefined) {
        useSettings.getState().toggleFavorite(game.id);
        return;
      }
      const next = !game.favorite;
      // mise à jour optimiste, annulée en cas d'erreur
      const patch = (fav: boolean) => setReal(get().realGames.map((g) => (g.id === game.id ? { ...g, favorite: fav } : g)));
      patch(next);
      try {
        await nativeLibrary.setFavorite(game.dbId, next);
      } catch {
        patch(!next);
      }
    },

    fetchMetadata: async (gameIds = null, opts = {}) => {
      if (!get().native || get().meta.running) return undefined;
      set({ meta: { running: true } });
      const unlisten = await metadataApi.onProgress((progress) => set((s) => ({ meta: { ...s.meta, progress } })));
      try {
        const summary = await metadataApi.fetch(gameIds, opts);
        await refresh();
        set({ meta: { running: false, summary, finishedAt: Date.now() } });
        if (summary.images > 0) notify({ icon: "front", tone: "ok", title: "Jaquettes récupérées", body: `${summary.images} image${summary.images > 1 ? "s" : ""} pour ${summary.games} jeu${summary.games > 1 ? "x" : ""}` });
        return summary;
      } catch (e) {
        set({ meta: { running: false, error: message(e, "La récupération a échoué."), finishedAt: Date.now() } });
        await refresh().catch(() => undefined);
        return undefined;
      } finally {
        unlisten();
      }
    },

    cancelMetadata: async () => {
      await metadataApi.cancel();
    },

    dismissMetaResult: () => set((s) => ({ meta: { running: s.meta.running, progress: s.meta.progress } })),

    correctGame: async (game, p) => {
      if (game.dbId === undefined) throw new Error("Les jeux de démonstration ne peuvent pas être corrigés.");
      if (p.platformId) requirePlatform(p.platformId);
      await nativeLibrary.updateGame(game.dbId, p);
      await refresh();
      // Nouvelle console ou nouveau titre : nouvelle recherche de jaquette
      if ((p.platformId && p.platformId !== game.platformId) || (p.title && p.title !== game.title)) {
        void get().fetchMetadata([game.dbId]);
      }
    },
  };
});

/** Boutiques dont iBox sait lire les jeux. */
export const PC_SYNC_SOURCES = ["steam", "epic", "gog", "riot", "rsi", "ea", "battlenet", "rockstar", "ubisoft", "xbox"];

// Retour dans iBox (après une installation dans une boutique…) : les boutiques sont relues
if (typeof window !== "undefined") {
  window.addEventListener("focus", () => {
    const s = useLibrary.getState();
    if (s.native && s.status === "ready" && Date.now() - (s.pcSync.at ?? 0) > 20_000) void s.syncPc();
  });
}

// Le réglage « Afficher les jeux de démonstration » s'applique immédiatement
useSettings.subscribe((s, prev) => {
  if (s.steamFamily !== prev.steamFamily) {
    useLibrary.setState(visible(useLibrary.getState().realGames, s.showDemoGames));
    if (s.steamFamily) void useLibrary.getState().syncPc();
  }
  if (s.showDemoGames !== prev.showDemoGames) {
    useLibrary.setState(visible(useLibrary.getState().realGames, s.showDemoGames));
  }
});

function message(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export const useGame = (id: string) =>
  useLibrary((s) => s.games.find((g) => g.id === id) ?? PC_DEMO_GAMES.find((g) => g.id === id));

/** Favori : en base pour les vrais jeux, dans les réglages pour la démo. */
export function isFavorite(game: Game, demoFavorites: string[]): boolean {
  return game.dbId !== undefined ? !!game.favorite : demoFavorites.includes(game.id);
}

export function useIsFavorite(game: Game): boolean {
  const demoFavs = useSettings((s) => s.favorites);
  return isFavorite(game, demoFavs);
}

export function countByPlatform(games: Game[]): Map<PlatformId, number> {
  const m = new Map<PlatformId, number>();
  for (const g of games) m.set(g.platformId, (m.get(g.platformId) ?? 0) + 1);
  return m;
}

export function lastPlayed(games: Game[]): Game | undefined {
  return games
    .filter((g) => g.lastPlayedAt)
    .sort((a, b) => (b.lastPlayedAt! > a.lastPlayedAt! ? 1 : -1))[0];
}

export function recentlyAdded(games: Game[], limit = 8): Game[] {
  return [...games].sort((a, b) => (b.addedAt > a.addedAt ? 1 : -1)).slice(0, limit);
}
