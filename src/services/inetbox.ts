import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./native";
import { useLauncher } from "./launcher";
import { notify } from "./notifications";
import { useSettings } from "./settings";
import { getPlatform } from "@/domain/platforms";
import type { AvatarChoice } from "./settings";

export interface AchievementHighlight { source: "Steam" | "RetroAchievements"; title: string; earned: number; total: number }
export interface FeaturedGame { title: string; platformId: string; cover?: string }
export interface InetUser {
  id: string; username: string; displayName: string; friendCode: string;
  avatar?: AvatarChoice | null;
  featuredGames?: FeaturedGame[];
  achievementHighlight?: AchievementHighlight | null;
  privacy: { shareOnline: boolean; shareGame: boolean; shareLibrary?: boolean; publicProfile?: boolean };
}
export interface InetFriend {
  id: string; displayName: string; status: "online" | "offline" | "away";
  gameTitle: string | null; platformId: string | null;
  avatar?: AvatarChoice | null; favorite?: boolean;
}
export interface InetInvitation { id: string; displayName: string; outgoing: boolean; avatar?: AvatarChoice | null; publicProfile?: boolean }
/** Messages non lus d'un ami. */
export interface Unread { friendId: string; displayName: string; unread: number; lastAt: number; lastBody: string }
/** Invitation à jouer reçue d'un ami (valable 30 minutes). */
export interface GameInvite { id: string; fromId: string; fromName: string; gameTitle: string; platformId: string; createdAt: number }
interface Snapshot { user: InetUser; friends: InetFriend[]; invitations: InetInvitation[]; blocks: { id: string; displayName: string }[]; gameInvites: GameInvite[]; gameInvitesSupported: boolean; unread?: Unread[]; socialSupported?: boolean }
interface InetError { code: string; message: string; retryAfterSeconds?: number }
type Action = "login" | "register" | "profile" | "invite" | "accept" | "remove" | "block" | "unblock" | "deleteAccount" | "logout" | "logoutAll" | "gameInvite" | "dismissInvite" | "favorite" | "unfavorite" | "sendMessage";
interface State extends Omit<Snapshot, "user" | "unread" | "socialSupported"> {
  user: InetUser | null;
  unread: Unread[];
  socialSupported: boolean;
  status: "signedOut" | "connecting" | "online" | "offline";
  busy: boolean;
  presenceCooling: boolean;
  error: string | null;
  message: string | null;
  open: boolean;
  server: string;
  local: boolean;
  initialized: boolean;
  show: () => void;
  close: () => void;
  restore: () => Promise<void>;
  refresh: () => Promise<void>;
  act: (action: Action, body?: object, id?: string) => Promise<boolean>;
}
const empty = { user: null, friends: [], invitations: [], blocks: [], gameInvites: [], gameInvitesSupported: false, unread: [] as Unread[], socialSupported: false };
let epoch = 0;
let loading = false;
let retryAt = 0;
let failures = 0;
let nextPresence = 0;
let presenceTimer: ReturnType<typeof setTimeout> | undefined;
const nextAction = new Map<Action, number>();
const actionDelay: Partial<Record<Action, number>> = {
  login: 6500, register: 6500, deleteAccount: 6500, profile: 4500,
  invite: 3500, gameInvite: 6500,
};
const reads = new Map<string, Promise<unknown>>();
const sharedReads = new Set(["activity", "snapshot", "conversation", "friendProfile", "commonGames", "owners"]);
let nextMessage = 0;

function failure(e: unknown): InetError {
  if (e && typeof e === "object" && "message" in e && "code" in e) return e as InetError;
  return { code: "INTERNAL_ERROR", message: "iNetbox est momentanément indisponible." };
}
export async function call<T>(action: string, body?: object, id?: string): Promise<T> {
  if (!isTauri()) throw { code: "DESKTOP_ONLY", message: "iNetbox est disponible dans l’application Windows." };
  if (action === "sendMessage") {
    if (Date.now() < nextMessage) throw { code: "LOCAL_COOLDOWN", message: "Attendez un instant avant d’envoyer un autre message." };
    nextMessage = Date.now() + 2200;
  }
  const args = { action, body: body ?? null, id: id ?? null };
  if (!sharedReads.has(action)) return invoke<T>("inetbox_call", args);
  const key = JSON.stringify(args);
  const active = reads.get(key);
  if (active) return active as Promise<T>;
  const request = invoke<T>("inetbox_call", args);
  reads.set(key, request);
  try { return await request; }
  finally { reads.delete(key); }
}
function handleError(e: unknown, preserveSession = false) {
  const error = failure(e);
  if (error.code === "UNAUTHENTICATED" && !preserveSession) {
    useInetbox.setState({ ...empty, status: "signedOut", error: error.message });
    return;
  }
  if (["NETWORK_ERROR", "SERVICE_ERROR", "RATE_LIMITED"].includes(error.code)) {
    failures++;
    retryAt = Date.now() + Math.max(error.retryAfterSeconds ?? 0, Math.min(120, 15 * 2 ** failures)) * 1000;
    useInetbox.setState({ status: "offline", error: error.message });
  } else useInetbox.setState({ error: error.message });
}

// Session and social data are deliberately not persisted by Zustand.
export const useInetbox = create<State>((set, get) => ({
  ...empty, status: "signedOut", busy: false, presenceCooling: false, error: null, message: null, open: false,
  server: "", local: true, initialized: false,
  show: () => { set({ open: true, message: null }); if (get().user) void get().refresh(); },
  close: () => set({ open: false }),
  restore: async () => {
    if (loading || get().busy || !isTauri()) return;
    loading = true;
    const generation = epoch;
    set({ status: "connecting" });
    try {
      const info = await call<{ url: string; local: boolean }>("info");
      const user = await call<InetUser | null>("restore");
      if (generation !== epoch) return;
      set({ server: info.url, local: info.local, user, status: user ? "online" : "signedOut", error: null });
      failures = 0; retryAt = 0;
    } catch (e) { if (generation === epoch) handleError(e); }
    finally { loading = false; set({ initialized: true }); }
    if (get().user && get().status === "online") await get().refresh();
  },
  refresh: async () => {
    if (loading || get().busy || !get().user || Date.now() < retryAt) return;
    loading = true;
    const generation = epoch;
    try {
      const data = await call<Snapshot>("snapshot");
      if (generation === epoch) {
        set({ ...data, status: "online", error: null });
        failures = 0; retryAt = 0;
      }
    } catch (e) { if (generation === epoch) handleError(e); }
    finally { loading = false; }
  },
  act: async (action, body, id) => {
    if (get().busy) return false;
    const presence = action === "profile" && !!body && ("shareOnline" in body || "shareGame" in body);
    const hiding = action === "profile" && !!body &&
      (("shareOnline" in body && body.shareOnline === false && get().user?.privacy.shareOnline === true) ||
        ("shareGame" in body && body.shareGame === false && get().user?.privacy.shareGame === true));
    const now = Date.now();
    const logout = action === "logout" || action === "logoutAll";
    if (!logout && (now < retryAt || (!hiding && (presence ? now < nextPresence : now < (nextAction.get(action) ?? 0))))) return false;
    if (presence) {
      nextPresence = now + 9000;
      clearTimeout(presenceTimer);
      set({ presenceCooling: true });
      presenceTimer = setTimeout(() => set({ presenceCooling: false }), 9000);
    } else if (actionDelay[action]) nextAction.set(action, now + actionDelay[action]!);
    ++epoch;
    set({ busy: true, error: null, message: null });
    let success = false;
    try {
      const data = await call<unknown>(action, body, id);
      if (action === "logout" || action === "logoutAll" || action === "deleteAccount") {
        nextAction.clear();
        nextPresence = nextMessage = 0;
        clearTimeout(presenceTimer);
        set({ ...empty, status: "signedOut", presenceCooling: false, message: action === "deleteAccount" ? "Compte supprimé." : (data as { revoked: boolean }).revoked
          ? "Vous êtes déconnecté." : "Session retirée de ce PC. Le serveur est injoignable : la révocation distante reste à faire depuis un appareil connecté." });
      } else if (["login", "register", "profile"].includes(action)) {
        set({ user: data as InetUser, status: "online" });
        if (presence || action !== "profile") void call("heartbeat").catch(() => undefined);
      } else set({ message: action === "invite" || action === "gameInvite" ? "Invitation envoyée." : ["dismissInvite", "favorite", "unfavorite", "sendMessage"].includes(action) ? null : "Modification enregistrée." });
      failures = 0; retryAt = 0; success = true;
    } catch (e) { handleError(e, action === "deleteAccount" || action === "login" || action === "register"); }
    finally { set({ busy: false }); }
    if (success && get().user && action !== "profile") await get().refresh();
    return success;
  },
}));

/**
 * Activité des amis en direct : à chaque actualisation, ce qui a changé devient
 * une notification (ami qui se connecte, qui lance un jeu, invitation à jouer).
 * Rien n'est annoncé au premier chargement, seulement les changements.
 */
let seenFriends: Map<string, InetFriend> | null = null;
let seenInvites: Set<string> | null = null;
function announce(state: State) {
  if (!state.user) {
    seenFriends = null;
    seenInvites = null;
    return;
  }
  const alerts = useSettings.getState().friendAlerts !== false;
  const friends = new Map(state.friends.map((f) => [f.id, f]));
  const invites = new Set(state.gameInvites.map((i) => i.id));
  if (seenFriends && alerts) {
    for (const f of state.friends) {
      const before = seenFriends.get(f.id);
      if (!before) continue;
      const platform = f.platformId ? getPlatform(f.platformId)?.shortName : undefined;
      if (f.gameTitle && f.gameTitle !== before.gameTitle) {
        notify({ icon: "gamepad", tone: "info", title: `${f.displayName} joue à ${f.gameTitle}`, body: platform });
      } else if (before.status === "offline" && f.status !== "offline") {
        notify({ icon: "user", tone: "info", title: `${f.displayName} est en ligne` });
      }
    }
  }
  if (seenInvites) {
    for (const i of state.gameInvites) {
      if (seenInvites.has(i.id)) continue;
      const platform = getPlatform(i.platformId)?.shortName;
      notify({ icon: "play", tone: "ok", title: `${i.fromName} vous invite à jouer`, body: `${i.gameTitle}${platform ? ` · ${platform}` : ""} — ouvrez Amis pour répondre.` });
    }
  }
  seenFriends = friends;
  seenInvites = invites;
}

export function attachInetbox() {
  const offAnnounce = useInetbox.subscribe((state, prev) => {
    if (state.friends !== prev.friends || state.gameInvites !== prev.gameInvites || state.user !== prev.user) announce(state);
  });
  void useInetbox.getState().restore();
  const timer = setInterval(() => {
    const state = useInetbox.getState();
    if (Date.now() < retryAt) return;
    // connecté : l'actualisation native (toutes les 25 s) envoie l'état des amis
    if (!state.user && state.status === "offline") void state.restore();
  }, 30000);
  let offSnapshot: (() => void) | undefined;
  if (isTauri()) {
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<Snapshot>("inetbox-snapshot", (e) => {
        const state = useInetbox.getState();
        if (!state.user || state.busy || loading || e.payload.user?.id !== state.user.id) return;
        useInetbox.setState({ ...e.payload, status: "online", error: null });
        failures = 0; retryAt = 0;
      }),
    ).then((off) => { offSnapshot = off; });
  }
  const off = useLauncher.subscribe((state, previous) => {
    if (state.phase !== previous.phase && useInetbox.getState().user) void call("heartbeat").catch(() => undefined);
  });
  return () => { clearInterval(timer); off(); offAnnounce(); offSnapshot?.(); };
}
