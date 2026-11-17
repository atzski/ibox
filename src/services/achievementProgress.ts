import { invoke } from "@tauri-apps/api/core";
import { sortKey } from "@/domain/text";

export const RA_SYSTEM: Record<string, number> = { snes: 3, n64: 2, gb: 4, gba: 5, gbc: 6, ds: 18, "3ds": 62, gamecube: 16, wii: 19, ps1: 12, ps2: 21, psp: 41, megadrive: 1, nes: 7, mastersystem: 11, gamegear: 15, jaguar: 17, atari2600: 25, saturn: 39, dreamcast: 40 };
type Progress = { id: number; system: number; title: string; earned: number; total: number };
let cache: { user: string; expires: number; request: Promise<Progress[]> } | undefined;

export function syncRaProgress(user: string, force = false) {
  if (!force && cache?.user === user && cache.expires > Date.now()) return cache.request;
  const request = invoke<Progress[]>("achievements_ra_progress", { username: user });
  cache = { user, expires: Date.now() + 300_000, request };
  void request.catch(() => { if (cache?.request === request) cache = undefined; });
  return request;
}

export function matchRaProgress(rows: Progress[], platform: string, title: string) {
  const matches = rows.filter((row) => row.system === RA_SYSTEM[platform] && sortKey(row.title) === sortKey(title));
  return matches.length === 1 ? matches[0] : undefined;
}
