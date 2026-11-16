import { create } from "zustand";
import { isTauri } from "@/services/native";
import type { GuestProfile } from "@/services/remotePlay";

/**
 * Remote Play entre amis iNetbox (expérimental). Toute la signalisation est native
 * (`remote_play::online`) : clé d'appareil, signatures, épinglage des clés, jeton d'invitation.
 * L'interface ne voit ni jeton iNetbox ni adresse IP.
 */

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export type Trust = "firstContact" | "newDevice" | "known" | "verified";

export interface OnlineStatus {
  role: "host" | "guest";
  stage: "inviting" | "connecting" | "live" | "ended" | "failed";
  peerId: string;
  peerName: string;
  mode: "watch" | "play";
  profile: GuestProfile | "fullControl" | null;
  source: string | null;
  safetyCode: string | null;
  trust: Trust | null;
  error: string | null;
  rejected: number;
  sessionId: string | null;
  expiresAt: number | null;
}

export interface IncomingInvite {
  id: string;
  fromId: string;
  fromName: string;
  mode: "watch" | "play";
  expiresAt: number;
}

export type SourceItem =
  | { kind: "monitor"; id: number; name: string; width: number; height: number; primary: boolean }
  | { kind: "window"; id: number; title: string; pid: number; width: number; height: number };

export interface Sources {
  items: SourceItem[];
  game: number | null;
  gameTitle: string | null;
}

export type SourceChoice = { kind: "primary" } | { kind: "monitor"; id: number } | { kind: "window"; id: number };

export interface GuestJoin {
  sessionId: string;
  offer: string;
  hostName: string;
  mode: "watch" | "play";
  safetyCode: string;
  trust: Trust;
  stunServers: string[];
}

export const onlineApi = {
  invite: (friendId: string, friendName: string, profile: GuestProfile, source: SourceChoice, confirmed = false) =>
    invoke<OnlineStatus>("remote_play_invite", { args: { friendId, friendName, profile, source, confirmed } }),
  stop: () => invoke<void>("remote_play_online_stop"),
  emergencyStop: () => invoke<void>("remote_play_emergency_stop"),
  status: () => invoke<OnlineStatus | null>("remote_play_online_status"),
  sources: () => invoke<Sources>("remote_play_sources"),
  accept: (inviteId: string) => invoke<GuestJoin>("remote_play_accept", { inviteId }),
  answer: (sdp: string) => invoke<void>("remote_play_answer", { sdp }),
  candidates: (candidates: string[]) => invoke<void>("remote_play_candidates", { candidates }),
  guestState: (connected: boolean) => invoke<void>("remote_play_guest_state", { connected }),
  decline: (inviteId: string) => invoke<void>("remote_play_decline", { inviteId }),
  invites: () => invoke<IncomingInvite[]>("remote_play_invites"),
  setAccept: (accept: boolean) => invoke<boolean>("remote_play_set_accept", { accept }),
};

/** Texte affiché pour la confiance dans l'appareil du pair. */
export function trustLabel(t: Trust | null): string {
  switch (t) {
    case "firstContact":
      return "Premier contact : comparez ce code de vive voix.";
    case "newDevice":
      return "Nouvel appareil de cet ami : comparez ce code de vive voix.";
    case "verified":
      return "Appareil déjà vérifié.";
    case "known":
      return "Appareil déjà rencontré.";
    default:
      return "";
  }
}

/** Libellé du type de connexion (`TransportStats.path`). */
export function pathLabel(path: string | null | undefined): string {
  switch (path) {
    case "internet":
      return "P2P Internet";
    case "lan":
      return "Réseau local";
    case "loopback":
      return "Ce PC";
    default:
      return "—";
  }
}

export function natLabel(nat: string | null | undefined): string {
  switch (nat) {
    case "open":
      return "sans NAT";
    case "consistent":
      return "NAT compatible";
    case "symmetric":
      return "NAT symétrique";
    case "noResponse":
      return "STUN sans réponse";
    default:
      return "—";
  }
}

/** Le pair choisi peut-il recevoir l'invitation ? (spectateur/joueur seulement sans confirmation) */
export function needsConfirmation(profile: GuestProfile): boolean {
  return profile === "collaborator";
}

interface OnlineStore {
  status: OnlineStatus | null;
  invites: IncomingInvite[];
  /** Invitation ouverte dans la fenêtre d'acceptation. */
  open: IncomingInvite | null;
  setOpen: (i: IncomingInvite | null) => void;
}

export const useRemotePlayOnline = create<OnlineStore>((set) => ({
  status: null,
  invites: [],
  open: null,
  setOpen: (open) => set({ open }),
}));

/** Abonnement aux évènements natifs (fenêtre principale et indicateur). */
export function attachRemotePlayOnline(): () => void {
  if (!isTauri()) return () => undefined;
  const offs: Promise<() => void>[] = [];
  void onlineApi.status().then((status) => useRemotePlayOnline.setState({ status }), () => undefined);
  void onlineApi.invites().then((invites) => useRemotePlayOnline.setState({ invites }), () => undefined);
  const events = import("@tauri-apps/api/event");
  offs.push(events.then(({ listen }) => listen<OnlineStatus>("remote-play-online", (e) => useRemotePlayOnline.setState({ status: e.payload }))));
  offs.push(
    events.then(({ listen }) =>
      listen<IncomingInvite[]>("remote-play-invites", (e) => {
        const open = useRemotePlayOnline.getState().open;
        useRemotePlayOnline.setState({ invites: e.payload, open: open && e.payload.some((i) => i.id === open.id) ? open : null });
      }),
    ),
  );
  return () => offs.forEach((p) => void p.then((off) => off()));
}

/** Clic sur la notification d'invitation : ouvre la fenêtre Accepter / Refuser. */
export function openInvite(inviteId: string) {
  const s = useRemotePlayOnline.getState();
  const found = s.invites.find((i) => i.id === inviteId);
  if (found) {
    s.setOpen(found);
    return;
  }
  void onlineApi.invites().then((invites) => {
    useRemotePlayOnline.setState({ invites, open: invites.find((i) => i.id === inviteId) ?? null });
  });
}
