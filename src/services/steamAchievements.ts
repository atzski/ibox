import { isTauri } from "./native";
import type { Game } from "@/domain/types";
import type { RaAchievement, RaGameDetail } from "./retro";

/**
 * Succès Steam, présentés comme ceux de RetroAchievements (même écran, mêmes médailles).
 * La clé Steam reste dans le coffre Windows ; les lectures passent par le côté natif.
 */

interface SteamRow {
  id: string;
  title: string;
  description: string;
  hidden: boolean;
  earned: boolean;
  unlockedAt?: number;
  icon?: string;
  iconGray?: string;
  percent?: number | null;
}

export interface SteamProgress {
  appid: number;
  earned: number;
  total: number;
  lastAt: number;
}

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error("Les succès Steam sont disponibles dans l’application Windows.");
  const { invoke: call } = await import("@tauri-apps/api/core");
  return call<T>(cmd, args);
}

const cache = new Map<string, { at: number; value: Promise<unknown> }>();
function cached<T>(key: string, ttl: number, load: () => Promise<T>, force = false): Promise<T> {
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

const iso = (seconds?: number) => (seconds ? new Date(seconds * 1000).toISOString() : undefined);

/** Identifiant Steam d'un jeu PC de la bibliothèque (installation Steam). */
export function steamAppId(game: Game): number | undefined {
  const id = Number(game.pcInstalls?.find((i) => i.source === "steam")?.externalId);
  return id > 0 ? id : undefined;
}

export const steamApi = {
  game: (appid: number, fallbackTitle = "", force = false) =>
    cached(`steam|${appid}`, 120_000, async (): Promise<RaGameDetail> => {
      const r = await invoke<{ title?: string | null; items: SteamRow[] }>("steam_achievements", { appid });
      const achievements: RaAchievement[] = r.items.map((a, i) => ({
        id: i + 1,
        title: a.title,
        description: a.description || (a.hidden ? "Succès secret : il se dévoile une fois obtenu." : ""),
        points: 0,
        trueRatio: 0,
        numAwarded: 0,
        numAwardedHardcore: 0,
        displayOrder: i,
        earnedAt: a.earned ? iso(a.unlockedAt) ?? new Date(0).toISOString() : undefined,
        image: a.icon,
        imageLocked: a.iconGray ?? a.icon,
        percent: a.percent ?? undefined,
        hidden: a.hidden,
      }));
      const earned = achievements.filter((a) => a.earnedAt).length;
      return {
        source: "steam",
        id: appid,
        title: r.title || fallbackTitle,
        console: "Steam",
        icon: `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/capsule_231x87.jpg`,
        boxArt: `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
        players: 0,
        achievements,
        earned,
        earnedHardcore: earned,
        points: achievements.length,
        pointsEarned: earned,
        award: earned > 0 && earned === achievements.length ? "mastered" : null,
      };
    }, force),

  summary: (appids: number[], force = false) =>
    cached(`steam-summary|${appids.join(",")}`, 600_000, () => invoke<SteamProgress[]>("steam_achievements_summary", { appids }), force),
};
