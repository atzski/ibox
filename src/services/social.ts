import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./native";
import { call, useInetbox } from "./inetbox";
import { useSettings, type AvatarChoice } from "./settings";
import { useLibrary } from "./library";
import { getArtCanvas } from "@/art/covers";
import type { Game } from "@/domain/types";

/**
 * Social « vivant » : photo de profil visible des amis, jeux en commun (si
 * l'utilisateur partage sa bibliothèque), notifications en bas à droite.
 */

/** Clé d'un jeu, identique chez tous les amis : console + titre simplifié. */
export function gameKey(platformId: string, title: string) {
  const t = title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  return `${platformId}|${t}`.slice(0, 220);
}

/** Petite image JPEG carrée (photo de profil partagée). */
function square(source: CanvasImageSource, w: number, h: number, size = 96) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const side = Math.min(w, h);
  c.getContext("2d")!.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  return c.toDataURL("image/jpeg", 0.82);
}

/** Version partageable de la photo de profil (les images locales deviennent une miniature). */
export async function shareableAvatar(choice: AvatarChoice | null): Promise<AvatarChoice | null> {
  if (!choice) return null;
  if (choice.type === "image") {
    const img = new Image();
    img.src = choice.dataUrl;
    await img.decode();
    return { type: "image", dataUrl: square(img, img.naturalWidth, img.naturalHeight) };
  }
  if (choice.type === "game") {
    const game = useLibrary.getState().realGames.find((g) => g.id === choice.gameId);
    if (!game) return null;
    const canvas = await getArtCanvas(game, "front");
    return { type: "image", dataUrl: square(canvas, canvas.width, canvas.height) };
  }
  return choice;
}

let lastAvatar = "";
let lastLibrary = "";
let libraryTimer: number | undefined;
let appearanceRevision = 0;

const covers = new WeakMap<Game, Promise<string | undefined>>();
function featuredCover(game: Game) {
  const cached = covers.get(game);
  if (cached) return cached;
  const pending = getArtCanvas(game, "front").then((source) => {
    const canvas = document.createElement("canvas");
    for (const height of [224, 160, 112]) {
      canvas.height = height;
      canvas.width = Math.max(1, Math.round(height * source.width / source.height));
      canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
      const cover = canvas.toDataURL("image/jpeg", 0.75);
      if (cover.length <= 16000) return cover;
    }
  }).catch(() => { covers.delete(game); return undefined; });
  covers.set(game, pending);
  return pending;
}

async function syncAvatar() {
  const user = useInetbox.getState().user;
  if (!user || !useInetbox.getState().socialSupported) return;
  const revision = ++appearanceRevision;
  const settings = useSettings.getState();
  const games = useLibrary.getState().realGames;
  const featured = (settings.profileFeaturedGames ?? (settings.profileGame ? [settings.profileGame] : []))
    .flatMap((id) => games.find((game) => game.id === id) ?? []).slice(0, 3);
  if (!games.length && (settings.profileFeaturedGames?.length || settings.profileGame) && useLibrary.getState().status !== "ready") return;
  const [shared, featuredGames] = await Promise.all([
    shareableAvatar(settings.profileAvatar).catch(() => null),
    Promise.all(featured.map(async (game) => ({ title: game.title.slice(0, 160), platformId: game.platformId, cover: await featuredCover(game) }))),
  ]);
  if (revision !== appearanceRevision || useInetbox.getState().user?.id !== user.id) return;
  const appearance = user.privacy.publicProfile !== undefined
    ? { avatar: shared, bio: (settings.profileBio ?? "").trim().slice(0, 120), accent: settings.profileAccent ?? "#88CBF5" }
    : { avatar: shared };
  const payload = user.featuredGames !== undefined
    ? { ...appearance, banner: settings.profileBannerImage ?? null, featuredGames }
    : appearance;
  const json = JSON.stringify(payload);
  if (json === lastAvatar) return;
  lastAvatar = json;
  try {
    const next = await call<typeof user>("profile", payload);
    useInetbox.setState((s) => s.user?.id === user.id ? { user: { ...s.user, avatar: next.avatar } } : s);
  } catch { if (lastAvatar === json) lastAvatar = ""; }
}

function syncLibrary() {
  window.clearTimeout(libraryTimer);
  libraryTimer = window.setTimeout(() => {
    const user = useInetbox.getState().user;
    if (!user?.privacy.shareLibrary || !useInetbox.getState().socialSupported) { lastLibrary = ""; return; }
    const games = [...new Set(useLibrary.getState().realGames.map((g: Game) => gameKey(g.platformId, g.title)))].slice(0, 5000);
    const json = JSON.stringify(games);
    if (json === lastLibrary) return;
    lastLibrary = json;
    call("library", { games }).catch(() => { lastLibrary = ""; });
  }, 3000);
}

function syncToasts() {
  const s = useSettings.getState();
  void invoke("toast_enabled", { enabled: s.notificationsEnabled !== false && !s.doNotDisturb, friends: s.friendAlerts !== false }).catch(() => undefined);
}

/** Notification cliquée : iBox revient et ouvre ce qui la concerne. */
export interface ToastPayload {
  kind: "game" | "request" | "message" | "invite" | "update" | "notice";
  friendId: string;
  name: string;
  avatar?: AvatarChoice | null;
  gameTitle?: string;
  platformId?: string;
  body?: string;
  /** Clic sur « Accepter » d'une demande d'ami. */
  accept?: boolean;
  /** Notifications d'iBox (kind « notice ») : pictogramme, ton et destination. */
  icon?: import("@/components/ui/Icon").IconName;
  tone?: "info" | "ok" | "warn";
  link?: import("./links").AppLink | null;
  image?: string | null;
}
export type FriendsTarget = { view: "requests" } | { view: "chat"; friendId: string } | { view: "profile"; friendId: string } | { view: "list" };

function onToastClick(p: ToastPayload) {
  if (p.kind === "update" || p.kind === "notice") {
    const link = p.kind === "update" ? { kind: "update" as const } : p.link;
    if (link) void import("./links").then(({ openLink }) => openLink(link));
    return;
  }
  let target: FriendsTarget = { view: "list" };
  if (p.kind === "request") {
    if (p.accept) void useInetbox.getState().act("accept", undefined, p.friendId);
    else target = { view: "requests" };
  } else if (p.kind === "message") target = { view: "chat", friendId: p.friendId };
  else if (p.kind === "game") target = { view: "profile", friendId: p.friendId };
  window.dispatchEvent(new CustomEvent("ibox:open-friends", { detail: target }));
}

export function attachSocial() {
  if (!isTauri()) return () => undefined;
  syncToasts();
  const offSettings = useSettings.subscribe((s, p) => {
    if (s.notificationsEnabled !== p.notificationsEnabled || s.friendAlerts !== p.friendAlerts || s.doNotDisturb !== p.doNotDisturb) syncToasts();
    if (s.profileAvatar !== p.profileAvatar || s.profileBio !== p.profileBio || s.profileAccent !== p.profileAccent || s.profileBannerImage !== p.profileBannerImage || s.profileFeaturedGames !== p.profileFeaturedGames || s.profileGame !== p.profileGame) void syncAvatar();
  });
  const offSocial = useInetbox.subscribe((s, p) => {
    if (s.user?.id !== p.user?.id || s.socialSupported !== p.socialSupported || (s.user?.featuredGames === undefined) !== (p.user?.featuredGames === undefined)) { lastAvatar = ""; lastLibrary = ""; void syncAvatar(); }
    if (s.status === "online" && p.status !== "online") void syncAvatar();
    if (s.user?.privacy.shareLibrary !== p.user?.privacy.shareLibrary || s.socialSupported !== p.socialSupported) syncLibrary();
  });
  const offLibrary = useLibrary.subscribe((s, p) => {
    if (s.realGames !== p.realGames) syncLibrary();
    if (s.realGames !== p.realGames || (s.status === "ready" && p.status !== "ready")) void syncAvatar();
  });
  let offClick: (() => void) | undefined;
  void import("@tauri-apps/api/event").then(({ listen }) => listen<ToastPayload>("toast-click", (e) => onToastClick(e.payload))).then((off) => { offClick = off; });
  return () => { offSettings(); offSocial(); offLibrary(); offClick?.(); };
}
