import { create } from "zustand";
import { isTauri } from "./native";
import { useSettings } from "./settings";
import { notify } from "./notifications";
import { RA_SYSTEM, matchRaProgress, syncRaProgress } from "./achievementProgress";
import type { Game } from "@/domain/types";

/**
 * Univers RetroAchievements : profil, progression, succès des jeux, maîtrises, amis suivis
 * et succès débloqués en direct pendant une partie. La clé reste dans le coffre Windows ;
 * l'interface ne fait que des lectures, filtrées côté natif.
 */

export const RA_MEDIA = "https://media.retroachievements.org";
export const raMedia = (path?: string | null) => (path ? (path.startsWith("http") ? path : `${RA_MEDIA}${path.startsWith("/") ? "" : "/"}${path}`) : undefined);
export const raBadge = (name?: string | null, locked = false) => (name ? `${RA_MEDIA}/Badge/${name}${locked ? "_lock" : ""}.png` : undefined);
export const raUserPic = (user: string) => `${RA_MEDIA}/UserPic/${encodeURIComponent(user)}.png`;

export interface RaAchievement {
  id: number;
  title: string;
  description: string;
  points: number;
  trueRatio: number;
  badge?: string;
  /** Joueurs l'ayant obtenu (toutes difficultés). */
  numAwarded: number;
  numAwardedHardcore: number;
  displayOrder: number;
  type?: "progression" | "win_condition" | "missable" | null;
  earnedAt?: string;
  earnedHardcoreAt?: string;
}

export interface RaGameDetail {
  id: number;
  title: string;
  console: string;
  icon?: string;
  boxArt?: string;
  players: number;
  achievements: RaAchievement[];
  earned: number;
  earnedHardcore: number;
  points: number;
  pointsEarned: number;
  award?: string | null;
}

export interface RaGameProgress {
  id: number;
  title: string;
  icon?: string;
  consoleId: number;
  console: string;
  earned: number;
  earnedHardcore: number;
  total: number;
  lastAt?: string;
  award?: string | null;
}

export interface RaRecent {
  id: number;
  title: string;
  description: string;
  points: number;
  badge?: string;
  date: string;
  hardcore: boolean;
  gameId: number;
  gameTitle: string;
  gameIcon?: string;
  console?: string;
}

export interface RaProfile {
  user: string;
  pic: string;
  motto?: string;
  memberSince?: string;
  points: number;
  softcorePoints: number;
  truePoints: number;
  rank?: number;
  ranked?: number;
  status?: string;
  richPresence?: string;
  lastGame?: { id: number; title: string; icon?: string; console?: string };
}

export interface RaAward {
  gameId: number;
  title: string;
  console: string;
  icon?: string;
  kind: "mastered" | "completed" | "beaten" | "beaten-softcore" | "other";
  at: string;
}

export interface RaFollow {
  user: string;
  points: number;
  softcorePoints: number;
  followsMe: boolean;
}

export interface RaRank {
  user: string;
  points: number;
  achievements: number;
  lastAt?: string;
}

type Json = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : 0);
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const opt = (v: unknown) => (typeof v === "string" && v ? v : undefined);

async function call<T = Json>(endpoint: string, params: Record<string, string | number> = {}): Promise<T> {
  if (!isTauri()) throw new Error("RetroAchievements est disponible dans l’application Windows.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>("ra_api", { endpoint, params });
}

/** Petit cache par requête (les écrans se rouvrent souvent). */
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
function cached<T>(key: string, ttlMs: number, load: () => Promise<T>, force = false): Promise<T> {
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}
export const clearRaCache = () => cache.clear();

export function parseGame(raw: Json, id: number): RaGameDetail {
  const list = Object.values((raw.Achievements as Record<string, Json> | null) ?? {}).map((a): RaAchievement => ({
    id: num(a.ID),
    title: str(a.Title),
    description: str(a.Description),
    points: num(a.Points),
    trueRatio: num(a.TrueRatio),
    badge: opt(a.BadgeName),
    numAwarded: num(a.NumAwarded),
    numAwardedHardcore: num(a.NumAwardedHardcore),
    displayOrder: num(a.DisplayOrder),
    type: (opt(a.type) as RaAchievement["type"]) ?? null,
    earnedAt: opt(a.DateEarned),
    earnedHardcoreAt: opt(a.DateEarnedHardcore),
  })).sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);
  return {
    id,
    title: str(raw.Title),
    console: str(raw.ConsoleName),
    icon: raMedia(opt(raw.ImageIcon)),
    boxArt: raMedia(opt(raw.ImageBoxArt)),
    players: num(raw.NumDistinctPlayers),
    achievements: list,
    earned: list.filter((a) => a.earnedAt).length,
    earnedHardcore: list.filter((a) => a.earnedHardcoreAt).length,
    points: list.reduce((n, a) => n + a.points, 0),
    pointsEarned: list.filter((a) => a.earnedAt).reduce((n, a) => n + a.points, 0),
    award: opt(raw.HighestAwardKind) ?? null,
  };
}

function awardKind(type: string, extra: unknown): RaAward["kind"] {
  if (/mastery|completion/i.test(type)) return num(extra) === 1 ? "mastered" : "completed";
  if (/beaten/i.test(type)) return num(extra) === 1 ? "beaten" : "beaten-softcore";
  return "other";
}

export const raApi = {
  profile: (user: string, force = false) =>
    cached(`profile|${user}`, 120_000, async (): Promise<RaProfile> => {
      const s = await call<Json>("API_GetUserSummary", { u: user, g: 1, a: 1 });
      const last = s.LastGame as Json | null;
      return {
        user: str(s.User) || user,
        pic: raMedia(opt(s.UserPic)) ?? raUserPic(user),
        motto: opt(s.Motto),
        memberSince: opt(s.MemberSince),
        points: num(s.TotalPoints),
        softcorePoints: num(s.TotalSoftcorePoints),
        truePoints: num(s.TotalTruePoints),
        rank: num(s.Rank) || undefined,
        ranked: num(s.TotalRanked) || undefined,
        status: opt(s.Status),
        richPresence: opt(s.RichPresenceMsg),
        lastGame: last ? { id: num(last.ID), title: str(last.Title), icon: raMedia(opt(last.ImageIcon)), console: opt(last.ConsoleName) } : undefined,
      };
    }, force),

  progress: (user: string, force = false) =>
    cached(`progress|${user}`, 300_000, async (): Promise<RaGameProgress[]> => {
      const out: RaGameProgress[] = [];
      for (let page = 0; page < 6; page++) {
        const r = await call<Json>("API_GetUserCompletionProgress", { u: user, c: 500, o: out.length });
        const rows = (r.Results as Json[] | undefined) ?? [];
        out.push(...rows.map((g) => ({
          id: num(g.GameID),
          title: str(g.Title),
          icon: raMedia(opt(g.ImageIcon)),
          consoleId: num(g.ConsoleID),
          console: str(g.ConsoleName),
          earned: num(g.NumAwarded),
          earnedHardcore: num(g.NumAwardedHardcore),
          total: num(g.MaxPossible),
          lastAt: opt(g.MostRecentAwardedDate),
          award: opt(g.HighestAwardKind) ?? null,
        })));
        if (!rows.length || out.length >= num(r.Total)) break;
      }
      return out.sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
    }, force),

  recent: (user: string, minutes = 60 * 24 * 30, force = false) =>
    cached(`recent|${user}|${minutes}`, 60_000, async (): Promise<RaRecent[]> => {
      const rows = await call<Json[]>("API_GetUserRecentAchievements", { u: user, m: Math.min(minutes, 60 * 24 * 90) });
      return (Array.isArray(rows) ? rows : []).map((a) => ({
        id: num(a.AchievementID),
        title: str(a.Title),
        description: str(a.Description),
        points: num(a.Points),
        badge: opt(a.BadgeName),
        date: str(a.Date),
        hardcore: num(a.HardcoreMode) === 1,
        gameId: num(a.GameID),
        gameTitle: str(a.GameTitle),
        gameIcon: raMedia(opt(a.GameIcon)),
        console: opt(a.ConsoleName),
      }));
    }, force),

  awards: (user: string, force = false) =>
    cached(`awards|${user}`, 600_000, async (): Promise<RaAward[]> => {
      const r = await call<Json>("API_GetUserAwards", { u: user });
      return ((r.VisibleUserAwards as Json[] | undefined) ?? [])
        .filter((a) => num(a.AwardData) > 0)
        .map((a) => ({
          gameId: num(a.AwardData),
          title: str(a.Title),
          console: str(a.ConsoleName),
          icon: raMedia(opt(a.ImageIcon)),
          kind: awardKind(str(a.AwardType), a.AwardDataExtra),
          at: str(a.AwardedAt),
        }))
        .sort((a, b) => b.at.localeCompare(a.at));
    }, force),

  follows: (force = false) =>
    cached("follows", 600_000, async (): Promise<RaFollow[]> => {
      const r = await call<Json>("API_GetUsersIFollow", { c: 100 });
      return ((r.Results as Json[] | undefined) ?? []).map((f) => ({
        user: str(f.User),
        points: num(f.Points),
        softcorePoints: num(f.PointsSoftcore),
        followsMe: !!f.IsFollowingMe,
      })).sort((a, b) => b.points - a.points);
    }, force),

  game: (id: number, user: string, force = false) =>
    cached(`game|${id}|${user}`, 90_000, async () => parseGame(await call<Json>("API_GetGameInfoAndUserProgress", { g: id, u: user, a: 1 }), id), force),

  ranking: (id: number) =>
    cached(`rank|${id}`, 600_000, async (): Promise<RaRank[]> => {
      const rows = await call<Json[]>("API_GetGameRankAndScore", { g: id, t: 1 });
      return (Array.isArray(rows) ? rows : []).map((r) => ({
        user: str(r.User),
        points: num(r.TotalScore),
        achievements: num(r.NumAchievements),
        lastAt: opt(r.LastAward),
      }));
    }),
};

/** Lien d'un jeu de la bibliothèque vers son identifiant RetroAchievements (choisi ou retrouvé). */
export const raLinkKey = (game: Game) => `ibox.raGame.${game.id}`;
export function linkedRaId(game: Game): number | undefined {
  try {
    const id = Number(localStorage.getItem(raLinkKey(game)));
    return id > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}
export function setLinkedRaId(game: Game, id: number) {
  try { localStorage.setItem(raLinkKey(game), String(id)); } catch { /* stockage indisponible */ }
}
export async function resolveRaId(game: Game): Promise<number | undefined> {
  const linked = linkedRaId(game);
  if (linked) return linked;
  const user = useSettings.getState().raUsername;
  if (!user || !RA_SYSTEM[game.platformId]) return undefined;
  return matchRaProgress(await syncRaProgress(user), game.platformId, game.title)?.id;
}

/** Jeu de la bibliothèque correspondant à un jeu RetroAchievements (lien choisi, sinon titre). */
export function libraryGameFor(games: Game[], raId: number, title?: string, consoleId?: number): Game | undefined {
  const linked = games.find((g) => linkedRaId(g) === raId);
  if (linked || !title) return linked;
  const system = Object.entries(RA_SYSTEM).find(([, id]) => id === consoleId)?.[0];
  const key = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return games.find((g) => (!system || g.platformId === system) && g.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === key);
}

/** Rareté lisible d'un succès (part des joueurs du jeu qui l'ont obtenu). */
export function rarity(a: RaAchievement, players: number): { percent: number; label: string; tier: "common" | "uncommon" | "rare" | "ultra" } {
  const percent = players > 0 ? (a.numAwarded / players) * 100 : 0;
  const tier = percent >= 40 ? "common" : percent >= 15 ? "uncommon" : percent >= 4 ? "rare" : "ultra";
  const label = { common: "Courant", uncommon: "Peu courant", rare: "Rare", ultra: "Ultra rare" }[tier];
  return { percent, label, tier };
}

// ——— Succès débloqués en direct ———

interface LiveState {
  /** Succès débloqués depuis le lancement d'iBox (les plus récents d'abord). */
  unlocked: RaRecent[];
  /** Dernier succès débloqué, pour l'animation de l'écran des succès. */
  last?: RaRecent;
}
export const useRaLive = create<LiveState>(() => ({ unlocked: [] }));

/**
 * Pendant une partie (et quelques minutes après), iBox regarde les succès débloqués :
 * chacun est annoncé par une notification cliquable, affichée par-dessus le jeu.
 */
export function startRaWatch(isPlaying: () => boolean, onPlayingChange: (fn: (playing: boolean) => void) => () => void): () => void {
  const seen = new Set<number>();
  let primed = false;
  let lastPlay = 0;
  let timer: number | undefined;

  const tick = async () => {
    const user = useSettings.getState().raUsername;
    if (!user || !isTauri()) return;
    if (!isPlaying() && Date.now() - lastPlay > 5 * 60_000) return;
    try {
      const rows = await raApi.recent(user, 30, true);
      const fresh = rows.filter((r) => !seen.has(r.id));
      rows.forEach((r) => seen.add(r.id));
      if (!primed) { primed = true; return; }
      for (const a of fresh.slice(0, 5).reverse()) {
        useRaLive.setState((s) => ({ unlocked: [a, ...s.unlocked].slice(0, 50), last: a }));
        notify({
          icon: "trophy",
          tone: "ok",
          title: `Succès débloqué : ${a.title}`,
          body: `${a.gameTitle} · ${a.points} point${a.points > 1 ? "s" : ""}${a.hardcore ? " · Hardcore" : ""}`,
          image: raBadge(a.badge),
          link: { kind: "achievements", gameId: `ra-${a.gameId}` },
        });
      }
      if (fresh.length) clearRaCache();
    } catch {
      /* hors ligne ou clé absente : on réessaiera */
    }
  };

  const schedule = () => {
    window.clearInterval(timer);
    timer = window.setInterval(() => void tick(), 45_000);
  };
  const off = onPlayingChange((playing) => {
    if (playing) {
      lastPlay = Date.now();
      // amorce : les succès déjà obtenus ne sont pas réannoncés
      if (!primed) void tick();
    } else {
      lastPlay = Date.now();
    }
  });
  schedule();
  return () => { window.clearInterval(timer); off(); };
}
