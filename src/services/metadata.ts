import { isTauri } from "./native";
import { useSettings, type Region } from "./settings";

/**
 * Commandes natives des métadonnées et jaquettes (Rust › metadata::commands).
 * Les clés API ne transitent qu'à l'enregistrement : l'interface ne les relit jamais.
 */
export type MediaKind = "front" | "back" | "spine" | "full" | "disc" | "logo" | "title" | "screenshot" | "hero";
export type ProviderId = "libretro" | "steamgriddb" | "gametdb" | "libretro-db" | "launchbox";

/** Sources ajoutées après coup : actives tant que l'utilisateur ne les a pas coupées. */
const NEW_PROVIDERS: Partial<Record<ProviderId, boolean>> = { launchbox: true };

export interface MediaRef {
  kind: MediaKind;
  slot: number;
  source: "libretro" | "steamgriddb" | "user" | string;
  width: number | null;
  height: number | null;
  addedAt: string;
}

export interface Candidate {
  provider: "libretro" | "steamgriddb" | "iidb" | "launchbox" | "gametdb";
  kind: MediaKind;
  url: string;
  thumb: string;
  label: string;
  width: number | null;
  height: number | null;
  score: number;
  /** Jeu SteamGridDB d'origine : son fond et son logo sont ajoutés avec la jaquette. */
  sourceGame: number | null;
}

export interface JobProgress {
  phase: "refs" | "games";
  done: number;
  total: number;
  current: string | null;
}

export interface JobSummary {
  games: number;
  metadata: number;
  images: number;
  ambiguous: number;
  notFound: number;
  errors: string[];
}

export interface MetadataStatus {
  steamgriddbKey: boolean;
  sources: { id: string; fetchedAt: string; items: number }[];
  cacheBytes: number;
  mediaCount: number;
}

export interface FetchOptions {
  providers: ProviderId[];
  region: Region;
}

/** Options courantes, d'après les réglages de l'utilisateur. */
export function currentFetchOptions(): FetchOptions {
  const s = useSettings.getState();
  return {
    providers: (Object.entries({ ...NEW_PROVIDERS, ...s.metadataProviders }) as [ProviderId, boolean][]).filter(([, on]) => on).map(([id]) => id),
    region: s.preferredRegion,
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

export const metadataApi = {
  fetch: (gameIds: number[] | null, opts: { force?: boolean; refreshRefs?: boolean } = {}) =>
    call<JobSummary>("metadata_fetch", {
      gameIds,
      force: opts.force ?? false,
      refreshRefs: opts.refreshRefs ?? false,
      options: currentFetchOptions(),
    }),
  cancel: () => call<void>("metadata_cancel"),
  status: () => call<MetadataStatus>("metadata_status"),
  /** Propositions ; `query` : autre nom ou lien d'une page SteamGridDB. */
  candidates: (gameId: number, kind: MediaKind, query?: string) =>
    call<Candidate[]>("media_candidates", { gameId, kind, options: currentFetchOptions(), query: query?.trim() || null }),
  apply: (gameId: number, kind: MediaKind, c: Candidate) =>
    call<MediaRef>("media_apply", { gameId, kind, url: c.url, provider: c.provider, sourceGame: c.sourceGame ?? null }),
  importFile: (gameId: number, kind: MediaKind, path: string) => call<MediaRef>("media_import", { gameId, kind, path }),
  /** Image depuis un lien direct (https) collé par l'utilisateur. */
  importUrl: (gameId: number, kind: MediaKind, url: string) => call<MediaRef>("media_import_url", { gameId, kind, url }),
  remove: (gameId: number, kind: MediaKind, slot = 0) => call<void>("media_remove", { gameId, kind, slot }),
  /** Octets d'une image du cache. */
  read: (gameId: number, kind: MediaKind, slot = 0) => call<ArrayBuffer>("media_read", { gameId, kind, slot }),
  clearCache: () => call<number>("media_clear_cache"),
  setKey: (provider: "steamgriddb", key: string) => call<void>("provider_key_set", { provider, key }),
  deleteKey: (provider: "steamgriddb") => call<void>("provider_key_delete", { provider }),

  async onProgress(cb: (p: JobProgress) => void): Promise<() => void> {
    if (!isTauri()) return () => undefined;
    const { listen } = await import("@tauri-apps/api/event");
    return listen<JobProgress>("meta://progress", (e) => cb(e.payload));
  },

  /** Sélecteur d'image locale (PNG, JPEG, WebP). */
  async pickImage(): Promise<string | null> {
    if (!isTauri()) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      title: "Choisir une image",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    return typeof picked === "string" ? picked : null;
  },
};

export function formatBytes(bytes: number): string {
  const units = ["o", "Ko", "Mo", "Go"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: v < 10 && u > 0 ? 1 : 0 })} ${units[u]}`;
}
