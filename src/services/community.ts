import { useEffect, useState } from "react";
import { isTauri } from "./native";
import { call } from "./inetbox";
import type { AvatarChoice } from "./settings";

/**
 * Communauté : captures prises avec l'overlay (Alt+E en jeu), gardées sur ce PC
 * par profil, et partagées sur iNetbox seulement sur demande.
 */
export interface LocalCapture { name: string; kind: "screenshot" | "clip"; game?: string | null; platformId?: string | null; at: number; size: number }
export interface SharedCapture {
  id: string; kind: "screenshot" | "clip"; game: string | null; platformId: string | null; caption: string;
  size: number; createdAt: number; hasThumb?: boolean; authorId: string; authorName: string; avatar: AvatarChoice | null; mine: boolean;
  reactions?: Partial<Record<ReactionKey, number>>; myReaction?: ReactionKey | null; commentCount?: number;
}
export interface ShareComment {
  id: string; body: string; createdAt: number; authorId: string; authorName: string; avatar: AvatarChoice | null; mine: boolean; canDelete: boolean;
}

/** Réactions de la Communauté : clés stables côté serveur, émoji et nom côté iBox. */
export const REACTIONS = [
  { key: "love", emoji: "❤️", label: "J’adore" },
  { key: "fire", emoji: "🔥", label: "Le feu" },
  { key: "lol", emoji: "😂", label: "Trop drôle" },
  { key: "wow", emoji: "😮", label: "Waouh" },
  { key: "gg", emoji: "🏆", label: "GG" },
  { key: "clap", emoji: "👏", label: "Bravo" },
] as const;
export type ReactionKey = (typeof REACTIONS)[number]["key"];
export type ReactionSummary = { reactions: Partial<Record<ReactionKey, number>>; myReaction: ReactionKey | null };

/** Petits mots tout prêts pour commenter d'un clic (ou d'un bouton de manette). */
export const QUICK_COMMENTS = ["GG ! 🏆", "Trop fort 🔥", "Magnifique ✨", "Haha 😂", "Quel moment ! 😮", "On s’en fait une ? 🎮"];

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const captures = {
  list: () => (isTauri() ? invoke<LocalCapture[]>("captures_list") : Promise.resolve([])),
  remove: (name: string) => invoke<void>("captures_delete", { name }),
  folder: () => invoke<void>("captures_folder"),
  share: (name: string, caption?: string) => invoke<{ id: string }>("community_share", { name, caption: caption ?? null }),
  settings: (clips: boolean, hotkey: boolean) => (isTauri() ? invoke<void>("capture_settings", { clips, hotkey }) : Promise.resolve()),
};

export const community = {
  feed: () => call<{ items: SharedCapture[] }>("shares").then((r) => r.items),
  remove: (id: string) => call<void>("deleteShare", undefined, id),
  react: (id: string, emoji: ReactionKey | null) =>
    emoji ? call<ReactionSummary>("react", { emoji }, id) : call<ReactionSummary>("unreact", undefined, id),
  comments: (id: string) => call<{ items: ShareComment[] }>("comments", undefined, id).then((r) => r.items),
  comment: (id: string, body: string) => call<{ id: string }>("comment", { body }, id),
  removeComment: (id: string) => call<void>("deleteComment", undefined, id),
};

/**
 * Adresse locale (blob) d'une capture du PC ou d'un partage, libérée au démontage.
 * `thumb` : miniature légère du partage (fil), gardée en cache disque comme l'image.
 */
export function useCaptureUrl(source: { local: string } | { shared: string; thumb?: boolean } | null): string | null {
  const key = source ? ("local" in source ? `l:${source.local}` : `s:${source.shared}:${source.thumb ? 1 : 0}`) : "";
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!source || !isTauri()) return;
    let alive = true;
    let made: string | null = null;
    void (async () => {
      try {
        const bytes = "local" in source
          ? await invoke<ArrayBuffer>("captures_read", { name: source.local })
          : await invoke<ArrayBuffer>("community_media", { id: source.shared, thumb: !!source.thumb });
        if (!alive) return;
        const name = "local" in source ? source.local : "";
        const head = new Uint8Array(bytes.slice(0, 3));
        const type = name.endsWith(".gif") || head[0] === 0x47 ? "image/gif" : head[0] === 0xff ? "image/jpeg" : "image/png";
        made = URL.createObjectURL(new Blob([bytes], { type }));
        setUrl(made);
      } catch {
        if (alive) setUrl(null);
      }
    })();
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return url;
}

export function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`;
}
