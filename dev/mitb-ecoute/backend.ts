// Le « natif » de la page d'écoute : ce que Rust répond au panneau dans iBox, refait ici. Les
// commandes de lecture vont au vrai pont (`bridge.js`, chargé par `player.ts`) ; la file, la
// playlist et la recherche, que le pont demande d'ordinaire à YouTube Music, sont servies sur
// place à partir des morceaux d'essai. `vite.config.mjs` branche `invoke` et `listen` ici.
import type { MusicState, NowPlaying, Playlist, QueueItem, Track } from "@/services/musicBox";
import { formatTime } from "@/services/musicBox";
import { bridge, bridgeState, player } from "./player";
import { artwork, type Song } from "./songs";

type Handler = (e: { payload: unknown }) => void;
const handlers = new Map<string, Set<Handler>>();
export function emit(event: string, payload: unknown = null) {
  handlers.get(event)?.forEach((h) => h({ payload }));
}
export async function listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<() => void> {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(handler as Handler);
  return () => void handlers.get(event)!.delete(handler as Handler);
}

/** État commun, traduit de celui du pont comme le fait `ytm.rs` (`now_playing`). */
export function snapshot(): MusicState {
  const v = bridgeState();
  const now: NowPlaying | null = v.videoId
    ? {
        source: "youtube", app: "YouTube Music", id: v.videoId, title: v.title ?? "", artist: v.artist ?? "", album: v.album, artwork: v.artwork,
        positionMs: Math.round(v.position * 1000), durationMs: Math.round(v.duration * 1000), playing: v.playerState === 1 || v.playerState === 3,
        volume: v.volume == null ? null : Math.min(100, Math.round(v.volume)), canSeek: true, liked: null, shuffle: v.shuffle,
        repeat: v.repeat === "none" || v.repeat === "all" || v.repeat === "one" ? v.repeat : null,
      }
    : null;
  return { now, at: Date.now(), youtube: true };
}
// comme `overlay.rs` : l'état part vers le panneau deux fois par seconde
setInterval(() => emit("music://state", snapshot()), 500);

const wait = (ms: number) => new Promise((f) => setTimeout(f, ms));
const LIST: Playlist = { id: "VLPL-essai", playlistId: "PL-essai", title: "Morceaux d’essai", subtitle: `${player.songs.length} titres calculés sur place`, thumbnail: artwork(player.songs[0]) };
const ARTIST = { id: "UCf_gP4AMRSgAfyzbkeS9k4g", name: "Travis Scott", subtitle: "94,2 M auditeurs/mois", thumbnail: null };
const track = (s: Song): Track => ({ videoId: s.id, title: s.title, artist: s.artist, album: "Morceaux d’essai", duration: formatTime(s.dur * 1000), thumbnail: artwork(s) });
// chaque titre d’essai porte deux artistes : le premier mène à la page d’artiste enregistrée, le second n’a pas de page
const queue = (): QueueItem[] => player.songs.map((s, i) => ({ videoId: s.id, title: s.title, artist: `${s.artist}, Invité`, artists: [{ name: s.artist, id: ARTIST.id }, { name: "Invité", id: null }], duration: formatTime(s.dur * 1000), thumbnail: artwork(s), selected: i === player.index, playlistId: "PL-essai", index: i }));

/** Commandes que le vrai pont sait faire sans YouTube Music. */
const TO_BRIDGE = new Set(["state", "toggle", "play", "pause", "next", "prev", "seek", "volume", "fade", "autoplay", "shuffle", "repeat", "like", "playItem"]);

async function ytm(cmd: string, arg: Record<string, unknown> | null): Promise<unknown> {
  if (TO_BRIDGE.has(cmd)) return bridge(cmd, arg);
  switch (cmd) {
    case "queue": return queue();
    case "playlists": return [LIST];
    case "playlist": return player.songs.map(track);
    case "playlistPage": {
      // « Tous les titres » de l'artiste enregistré : une longue liste fictive (rien n'y joue)
      if (String(arg?.id ?? "").startsWith("VLOLAK")) return { tracks: Array.from({ length: 64 }, (_, i) => ({ ...track(player.songs[i % player.songs.length]), videoId: `essai-artiste-${i}`, title: `Titre d’essai ${i + 1}` })), next: null };
      return { tracks: player.songs.map(track), next: null };
    }
    case "search": {
      const q = String(arg?.query ?? "").toLowerCase();
      // un artiste à ouvrir : la page publique enregistrée pour les tests (images en ligne)
      if (arg?.kind === "artists") return "travis scott".includes(q) || q.includes("travis") ? [ARTIST] : [];
      return arg?.kind && arg.kind !== "songs" ? [] : player.songs.filter((s) => s.title.toLowerCase().includes(q)).map(track);
    }
    case "artist": {
      const [parse, json] = await Promise.all([fetch("/__parse.txt").then((r) => r.text()), fetch("/__artiste.json").then((r) => r.json())]);
      return (new Function(`${parse}; return ytmParse;`)() as { artistPage: (j: unknown) => unknown }).artistPage(json);
    }
    case "lyrics": return null;
  }
  throw "commande-inconnue";
}

/** Fond du verre du panneau : dans iBox, une capture du jeu ; ici, un simple dégradé sombre. */
async function backdrop(): Promise<ArrayBuffer> {
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = 180;
  const g = c.getContext("2d")!;
  const paint = g.createLinearGradient(0, 0, 320, 180);
  paint.addColorStop(0, "#1c2440");
  paint.addColorStop(1, "#0d1220");
  g.fillStyle = paint;
  g.fillRect(0, 0, 320, 180);
  const blob = await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("fond"))), "image/jpeg", 0.8));
  return blob.arrayBuffer();
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  switch (cmd) {
    case "music_state": return snapshot() as T;
    case "music_control": {
      // comme `music::control` : positions en ms côté panneau, en secondes côté pont
      const action = String(args?.action), value = Number(args?.value ?? 0);
      await bridge(action, action === "seek" ? { seconds: value / 1000 } : action === "volume" ? { value } : null);
      await wait(action === "next" || action === "prev" ? 450 : 120);
      return snapshot() as T;
    }
    case "music_ytm_call": return (await ytm(String(args?.cmd), (args?.arg as Record<string, unknown>) ?? null)) as T;
    case "music_backdrop": return (await backdrop()) as T;
    case "music_close": window.dispatchEvent(new CustomEvent("ecoute:ferme")); return null as T;
  }
  return null as T;
}
