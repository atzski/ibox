import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isTauri } from "./native";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error("Disponible dans l'application Windows.");
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : "Erreur inattendue.");
  }
}

// ——— Statistiques ———

export interface Stats {
  totalSeconds: number;
  sessions: number;
  gamesPlayed: number;
  weekSeconds: number;
  streakDays: number;
  byPlatform: [string, number][];
  /** [identifiant du jeu en base, secondes] */
  topGames: [number, number][];
  days: [string, number][];
}

export const statsApi = { overview: () => call<Stats>("stats_overview") };

// ——— Collections ———

export interface Collection {
  id: number;
  name: string;
  color: string;
  /** Identifiants des jeux en base, le plus récemment ajouté d'abord. */
  gameIds: number[];
}

export const COLLECTION_COLORS = ["#8CCDF1", "#B9A6E8", "#9ADBB8", "#F7B6A0", "#F6D37C", "#F2A6C8", "#2F86E8", "#7A5AE8", "#2E9A58", "#F2683F", "#E040A0", "#344459"];

/** Personnalisation d'une collection : logo d'un jeu (iiDB / SteamGridDB), fond d'un jeu, style de carte. */
export interface SmartRule { kind: "unplayed" | "multiplayer" | "genre" | "platform"; value: string; source?: string }
export function supportsMultiplayer(game: { players?: string }) {
  return (game.players?.match(/\d+/g) ?? []).some((n) => Number(n) >= 2);
}
export function matchesSmartRule(rule: SmartRule, game: import("@/domain/types").Game) {
  switch (rule.kind) {
    case "unplayed": return !game.lastPlayedAt && !game.playCount && !game.pcInstalls?.some((install) => (install.playtimeMinutes ?? 0) > 0);
    case "multiplayer": return supportsMultiplayer(game) || /coop/i.test(game.genre ?? "");
    case "genre": return !!rule.value.trim() && (game.genre ?? "").toLowerCase().includes(rule.value.trim().toLowerCase()) &&
      (!rule.source || game.pcInstalls?.some((install) => install.source === rule.source));
    case "platform": return game.platformId === rule.value || game.pcInstalls?.some((install) => install.source === rule.value);
  }
}
export interface CollectionStyle {
  rule?: SmartRule;
  hideName?: boolean;
  gameOrder?: number[];
  logoGameId?: number;
  heroGameId?: number;
  look?: "fan" | "hero" | "grid";
  /** Image choisie dans une recherche iiDB / SteamGridDB (date d'enregistrement). */
  logoStamp?: number;
  /** Icône de licence iiDB : la carte n'affiche plus qu'elle. */
  iconStamp?: number;
  heroStamp?: number;
  logoSize?: "s" | "m" | "l";
  shade?: "light" | "medium" | "strong";
}
export const useCollectionStyles = create<{ styles: Record<number, CollectionStyle>; setStyle: (id: number, s: CollectionStyle) => void }>()(
  persist((set) => ({ styles: {}, setStyle: (id, s) => set((st) => ({ styles: { ...st.styles, [id]: s } })) }), { name: "ibox.collectionStyles" }),
);

interface CollectionsState {
  list: Collection[];
  loaded: boolean;
  load: () => Promise<void>;
  create: (name: string, color: string) => Promise<number>;
  update: (id: number, name: string, color: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
  setGame: (id: number, gameId: number, member: boolean) => Promise<void>;
}

export const useCollections = create<CollectionsState>((set) => ({
  list: [],
  loaded: false,
  load: async () => {
    if (!isTauri()) return set({ loaded: true });
    set({ list: await call<Collection[]>("collections_list"), loaded: true });
  },
  create: async (name, color) => {
    const list = await call<Collection[]>("collection_create", { name, color });
    set({ list });
    return list[list.length - 1].id;
  },
  update: async (id, name, color) => set({ list: await call<Collection[]>("collection_update", { id, name, color }) }),
  remove: async (id) => set({ list: await call<Collection[]>("collection_delete", { id }) }),
  setGame: async (id, gameId, member) => set({ list: await call<Collection[]>("collection_set_game", { id, gameId, member }) }),
}));

// ——— Sauvegardes de jeu ———

export interface SaveItem {
  path: string;
  folder: boolean;
  size: number;
  modified: string | null;
  source: string;
}

export const savesApi = {
  list: (gameId: number) => call<{ items: SaveItem[]; backups: string[] }>("saves_list", { gameId }),
  backup: (gameId: number) => call<number>("saves_backup", { gameId }),
  reveal: (gameId: number, path?: string) => call<void>("saves_reveal", { gameId, path: path ?? null }),
};

export function formatDuration(seconds: number): string {
  if (seconds > 0 && seconds < 60) return "< 1 min";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${m.toString().padStart(2, "0")}` : `${h} h`;
}
