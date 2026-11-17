import type { Game } from "@/domain/types";
import { useLibrary } from "./library";
import { raApi } from "./retro";
import { useSettings } from "./settings";
import { steamApi, steamAppId } from "./steamAchievements";

/**
 * Dernières données du tableau des succès, gardées en mémoire et sur disque : l'écran Succès
 * s'affiche aussitôt avec elles, puis se met à jour en arrière-plan.
 */
const memory = new Map<string, unknown>();
const PREFIX = "ibox.achievements.";
/** Au-delà, on ne garde que la mémoire (le stockage local est limité). */
const MAX_STORED = 400_000;

export function readCache<T>(key: string): T | undefined {
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as T;
    memory.set(key, value);
    return value;
  } catch {
    return undefined;
  }
}

export function writeCache(key: string, value: unknown): void {
  memory.set(key, value);
  try {
    const raw = JSON.stringify(value);
    // le tableau va sur disque ; les pages de jeu restent en mémoire (pas d'accumulation)
    if (!key.startsWith("game:") && raw.length <= MAX_STORED) localStorage.setItem(PREFIX + key, raw);
  } catch {
    /* stockage plein ou indisponible : la mémoire suffit */
  }
}

/** Jeux Steam suivis par le tableau : les 40 joués le plus récemment. */
export function steamIdsOf(games: Game[]): number[] {
  return [...games]
    .sort((a, b) => (b.lastPlayedAt ?? "").localeCompare(a.lastPlayedAt ?? ""))
    .map(steamAppId)
    .filter((x): x is number => !!x)
    .slice(0, 40);
}

/** Précharge le tableau des succès en tâche de fond (démarrage d'iBox, survol du menu). */
let last = 0;
export function prefetchAchievements(): void {
  if (Date.now() - last < 120_000) return;
  last = Date.now();
  const user = useSettings.getState().raUsername;
  const jobs: [string, () => Promise<unknown>][] = [];
  if (user) {
    jobs.push([`ra-profile:${user}`, () => raApi.profile(user, false)]);
    jobs.push([`ra-progress:${user}`, () => raApi.progress(user, false)]);
    jobs.push([`ra-recent:${user}`, () => raApi.recent(user, 60 * 24 * 30, false)]);
    jobs.push([`ra-awards:${user}`, () => raApi.awards(user, false)]);
  }
  const steam = steamIdsOf(useLibrary.getState().realGames.filter((g) => g.platformId === "pc" && steamAppId(g)));
  if (steam.length) jobs.push(["steam-summary", () => steamApi.summary(steam, false)]);
  for (const [key, load] of jobs) {
    load().then((v) => writeCache(key, v), () => undefined);
  }
}
