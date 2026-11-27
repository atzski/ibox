import { create } from "zustand";
import { interfaceAsleep } from "./performance";
import { usePower } from "./power";
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
import { useSettings, type LibrarySort } from "./settings";
import { notify } from "./notifications";
import { capabilities } from "./capabilities";
import { usePlatform } from "./platform";
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
  /** `auto` : lancée par iBox (nouveaux jeux), pas par l'utilisateur ; une annulation l'arrête pour la session. */
  fetchMetadata: (gameIds?: number[] | null, opts?: { force?: boolean; refreshRefs?: boolean; auto?: boolean }) => Promise<JobSummary | undefined>;
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
    variantOf: row.variantOf ?? undefined,
    art: {
      motif: "placeholder",
      palette: t ? [t.soft, t.primary, t.deep, t.primary, "#ffffff"] : ["#EAF6FD", "#8CCDF1", "#2F7FB0", "#8CCDF1", "#ffffff"],
    },
  };
}

/**
 * Rassemble les versions sous leur fiche principale : seules les fiches principales restent
 * dans la liste ; elles portent leurs versions, le temps de jeu cumulé et la dernière partie.
 */
export function groupVariants(all: Game[]): Game[] {
  const byDb = new Map(all.filter((g) => g.dbId !== undefined).map((g) => [g.dbId!, g]));
  const children = new Map<number, Game[]>();
  for (const g of all) {
    if (g.variantOf === undefined || !byDb.has(g.variantOf)) continue;
    children.set(g.variantOf, [...(children.get(g.variantOf) ?? []), g]);
  }
  if (!children.size) return all;
  return all
    .filter((g) => g.variantOf === undefined || !byDb.has(g.variantOf))
    .map((g) => {
      const variants = g.dbId !== undefined ? children.get(g.dbId) : undefined;
      if (!variants) return g;
      const family = [g, ...variants];
      const last = family.map((v) => v.lastPlayedAt).filter(Boolean).sort().at(-1);
      return {
        ...g,
        variants,
        lastPlayedAt: last,
        playSeconds: family.reduce((n, v) => n + (v.playSeconds ?? 0), 0),
        playCount: family.reduce((n, v) => n + (v.playCount ?? 0), 0),
        // un doublon regroupé n'est plus signalé comme doublon
        duplicate: false,
      };
    });
}

function visible(all: Game[], showDemo: boolean): { games: Game[]; demoVisible: boolean } {
  // outils et logiciels masqués par l'utilisateur (Steam…) : hors de la collection ;
  // jeux de la Famille Steam non installés : seulement si l'option est active
  const family = useSettings.getState().steamFamily !== false;
  const real = all.filter((g) => !isHidden(g) && (family || !isFamilyOnly(g)));
  const demoVisible = real.length === 0 || showDemo;
  return { games: demoVisible ? [...real, ...DEMO_GAMES] : real, demoVisible };
}

/** Récupération des métadonnées annulée dans cette session (survit à un rechargement). */
const META_CANCELLED = "ibox.meta.cancelled";
function metaCancelled(): boolean {
  try {
    return sessionStorage.getItem(META_CANCELLED) === "1";
  } catch {
    return false;
  }
}
function setMetaCancelled(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(META_CANCELLED, "1");
    else sessionStorage.removeItem(META_CANCELLED);
  } catch {
    /* stockage indisponible : sans effet */
  }
}

export const useLibrary = create<LibraryState>((set, get) => {
  const setReal = (realGames: Game[]) =>
    set({ realGames, ...visible(realGames, useSettings.getState().showDemoGames) });

  const refresh = async () => {
    const [rows, folders] = await Promise.all([nativeLibrary.listGames(), nativeLibrary.listFolders()]);
    set({ folders });
    setReal(groupVariants(rows.map(rowToGame)));
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
        // Android : jeux et applications installés (console « Android »)
        if (get().native && capabilities().androidApps) void import("./androidApps").then((m) => m.syncAndroidApps());
      } catch (e) {
        setReal([]);
        set({ status: "error", error: message(e, "La collection n'a pas pu être chargée.") });
      }
    },

    reload: async () => {
      if (get().native) await refresh();
    },

    syncPc: async () => {
      // Android : pas de boutiques PC (sinon « Dossier Windows introuvable » au démarrage)
      if (!get().native || get().pcSync.running || !capabilities().pcGames) return [];
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
        if (added > 0) void import("./launcher").then(({ useLauncher }) => useLauncher.getState().adoptRunning());
        if (added > 0) notify({ icon: "plus", tone: "ok", title: `${added} nouveau${added > 1 ? "x" : ""} jeu${added > 1 ? "x" : ""} PC`, body: summaries.filter((s) => s.added).map((s) => `${s.source} : ${s.added}`).join(" · "), link: { kind: "library", platformId: "pc" } });
        for (const s of summaries) if (s.warning) notify({ icon: "lock", tone: "warn", title: "Boutique PC", body: s.warning, link: { kind: "settings", category: "pc" } });
        // jaquettes, fonds et logos des nouveaux jeux
        const fresh = summaries.flatMap((s) => s.newGameIds);
        if (fresh.length && useSettings.getState().autoFetchMetadata) void get().fetchMetadata(fresh, { auto: true });
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
        // .iso dont la console reste à préciser : la question se pose une fois le scan terminé
        void import("./isoQueue").then(({ useIsoQueue }) => useIsoQueue.getState().afterScan(summary.isoNew));
        if (summary.added > 0 || summary.missing > 0)
          notify({ icon: "folder", tone: summary.missing ? "warn" : "ok", title: "Collection actualisée", body: [summary.added && `${summary.added} ajouté${summary.added > 1 ? "s" : ""}`, summary.missing && `${summary.missing} introuvable${summary.missing > 1 ? "s" : ""}`].filter(Boolean).join(" · "), link: { kind: "library", platformId: "all" } });
        if (summary.added > 0) {
          const { duplicateGroups } = await import("@/components/game/Versions");
          const groups = duplicateGroups(get().realGames).length;
          if (groups > 0) notify({ icon: "copy", tone: "info", title: `${groups} jeu${groups > 1 ? "x" : ""} en plusieurs versions`, body: "Cliquez pour regrouper les doublons sur une seule fiche.", link: { kind: "duplicates" } });
        }
        // Jaquettes et infos des nouveaux jeux, en arrière-plan
        if (useSettings.getState().autoFetchMetadata && (summary.added > 0 || summary.updated > 0 || summary.moved > 0)) {
          void get().fetchMetadata(null, { auto: true });
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
      // Android : récupération annulée par l'utilisateur, iBox ne la relance pas de lui-même dans
      // cette session, même après un rechargement (changement de langue) ; la base LaunchBox, coupée
      // en plein téléchargement, repartait sinon aussitôt (D19, docs/ANDROID-RECETTE.md)
      const { auto, ...fetchOpts } = opts;
      if (auto && usePlatform.getState().android && metaCancelled()) return undefined;
      if (!auto) setMetaCancelled(false);
      set({ meta: { running: true } });
      const unlisten = await metadataApi.onProgress((progress) => set((s) => ({ meta: { ...s.meta, progress } })));
      try {
        const summary = await metadataApi.fetch(gameIds, fetchOpts);
        await refresh();
        set({ meta: { running: false, summary, finishedAt: Date.now() } });
        if (summary.images > 0) notify({ icon: "front", tone: "ok", title: "Jaquettes récupérées", body: `${summary.images} image${summary.images > 1 ? "s" : ""} pour ${summary.games} jeu${summary.games > 1 ? "x" : ""}`, link: { kind: "library", platformId: "all" } });
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
      setMetaCancelled(true);
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
export const PC_SYNC_SOURCES = ["steam", "epic", "gog", "heroic", "lutris", "riot", "rsi", "ea", "battlenet", "rockstar", "ubisoft", "xbox"];

// Retour dans iBox (après une installation dans une boutique…) : les boutiques sont relues
if (typeof window !== "undefined") {
  // désinstalleur externe terminé : la fiche est relue (et les boutiques resynchronisées)
  void import("./uninstall").then(({ uninstallApi }) => uninstallApi.onDone(() => {
    const s = useLibrary.getState();
    void s.reload().then(() => { if (s.native) void s.syncPc(); });
  }));

  window.addEventListener("focus", () => {
    const s = useLibrary.getState();
    if (s.native && s.status === "ready" && Date.now() - (s.pcSync.at ?? 0) > 20_000) void s.syncPc();
  });

  // Steam installe souvent pendant qu'iBox reste au premier plan (aucun retour de focus) : ses
  // manifestes sont relus toutes les 4 s, et la synchronisation relancée dès qu'un jeu change
  // d'état — « Installer » devient « Jouer » sans rien faire.
  let steamState: string | null = null;
  let steamTick = 0;
  window.setInterval(() => {
    // pendant une partie (interface en veille) : rien, la relecture reprend au retour dans iBox
    if (interfaceAsleep()) return;
    // sur batterie (Steam Deck) : toutes les 12 s seulement
    if (usePower.getState().onBattery && steamTick++ % 3 !== 0) return;
    const s = useLibrary.getState();
    // synchronisation déjà en cours : on réessaie au tour suivant (sinon le changement serait perdu)
    // Android : aucune boutique PC à surveiller
    if (!s.native || s.status !== "ready" || s.pcSync.running || useSettings.getState().pcConnectors.steam === false || !capabilities().pcGames) return;
    void pcApi.steamInstalled().then((ids) => {
      const next = ids.join(",");
      const changed = steamState !== null && next !== steamState;
      steamState = next;
      if (changed) void useLibrary.getState().syncPc();
    }, () => undefined);
  }, 4_000);
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

/** Fiche d'un jeu ; l'identifiant d'une version regroupée mène à sa fiche principale. */
export const useGame = (id: string) =>
  useLibrary((s) =>
    s.games.find((g) => g.id === id)
    ?? s.games.find((g) => g.variants?.some((v) => v.id === id))
    ?? PC_DEMO_GAMES.find((g) => g.id === id));

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

/**
 * Ordre de la bibliothèque selon le tri choisi. Un seul comparateur pour la grille,
 * l'étagère 3D et le passage d'une fiche à l'autre (Q / E) : l'ordre est le même partout.
 * « Joués récemment » : la dernière partie d'abord ; les jeux jamais lancés suivent, de A à Z.
 */
export function compareGames(sort: LibrarySort): (a: Game, b: Game) => number {
  const alpha = (a: Game, b: Game) => a.sortTitle.localeCompare(b.sortTitle);
  if (sort === "added") return (a, b) => b.addedAt.localeCompare(a.addedAt) || alpha(a, b);
  if (sort === "played")
    return (a, b) => {
      if (a.lastPlayedAt && b.lastPlayedAt) return b.lastPlayedAt.localeCompare(a.lastPlayedAt) || alpha(a, b);
      if (a.lastPlayedAt || b.lastPlayedAt) return a.lastPlayedAt ? -1 : 1;
      return alpha(a, b);
    };
  return alpha;
}

export function lastPlayed(games: Game[]): Game | undefined {
  return games
    .filter((g) => g.lastPlayedAt)
    .sort((a, b) => (b.lastPlayedAt! > a.lastPlayedAt! ? 1 : -1))[0];
}

export function recentlyAdded(games: Game[], limit = 8): Game[] {
  return [...games].sort((a, b) => (b.addedAt > a.addedAt ? 1 : -1)).slice(0, limit);
}
