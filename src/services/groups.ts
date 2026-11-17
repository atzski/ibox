import { create } from "zustand";
import { call } from "./inetbox";
import type { AvatarChoice } from "./settings";

/**
 * Groupes de discussion iNetbox : messages privés à plusieurs (10 membres au
 * plus). Liste relue à l'ouverture du panneau des amis et toutes les 15 s tant
 * qu'il reste ouvert ; la conversation se relève dans sa propre vue.
 */
export interface GroupMember {
  id: string;
  displayName: string;
  avatar: AvatarChoice | null;
}

export interface ChatGroup {
  id: string;
  name: string;
  createdBy: string | null;
  createdAt: number;
  members: GroupMember[];
  unread: number;
  lastAt: number | null;
  lastBody: string | null;
  lastFrom: string | null;
}

export interface GroupMessage {
  id: string;
  fromId: string | null;
  displayName: string | null;
  mine: boolean;
  body: string;
  createdAt: number;
}

/** Membres au plus dans un groupe (vous compris), comme le serveur. */
export const GROUP_MAX_MEMBERS = 10;

interface GroupsState {
  groups: ChatGroup[];
  /** Le serveur iNetbox connaît les groupes (sinon : pas de bouton qui mènerait à rien). */
  supported: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  upsert: (g: ChatGroup) => void;
  remove: (id: string) => void;
  markRead: (id: string) => void;
}

export const useGroups = create<GroupsState>((set) => ({
  groups: [],
  supported: false,
  loaded: false,
  load: async () => {
    try {
      const r = await call<{ items: ChatGroup[] }>("groups");
      set({ groups: r.items, supported: true, loaded: true });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      // ancien serveur (route inconnue) : fonctionnalité masquée ; sinon on garde la liste connue
      if (code === "NOT_FOUND") set({ supported: false, loaded: true });
      else set({ loaded: true });
    }
  },
  upsert: (g) =>
    set((s) => ({ groups: [g, ...s.groups.filter((x) => x.id !== g.id)].sort((a, b) => (b.lastAt ?? b.createdAt) - (a.lastAt ?? a.createdAt)) })),
  remove: (id) => set((s) => ({ groups: s.groups.filter((g) => g.id !== id) })),
  markRead: (id) => set((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, unread: 0 } : g)) })),
}));

/** « Léa, Tom et 3 autres ». */
export function membersLabel(members: GroupMember[], selfId: string | undefined, max = 3): string {
  const names = members.filter((m) => m.id !== selfId).map((m) => m.displayName);
  if (names.length <= max) return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(", ")} et ${names.length - max} autre${names.length - max > 1 ? "s" : ""}`;
}
