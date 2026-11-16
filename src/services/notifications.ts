import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { IconName } from "@/components/ui/Icon";
import type { AppLink } from "./links";

/**
 * Centre de notifications d'iBox : ce qui s'est passé en arrière-plan
 * (nouveaux jeux, actualisation, images récupérées, erreurs). Gardé sur cet
 * ordinateur, 40 au plus.
 */
export interface Notice {
  id: string;
  at: string;
  icon: IconName;
  title: string;
  body?: string;
  tone: "info" | "ok" | "warn";
  read: boolean;
  /** Ancien format : remplacé par `link`. */
  action?: "update";
  /** Où mène un clic sur la notification. */
  link?: AppLink;
  /** Image (badge d'un succès RetroAchievements). */
  image?: string;
}

/** Destination d'une notification (anciennes notifications « update » comprises). */
export function linkOf(n: Pick<Notice, "action" | "link">): AppLink | undefined {
  return n.link ?? (n.action === "update" ? { kind: "update" } : undefined);
}

interface NotifState {
  items: Notice[];
  push: (n: Omit<Notice, "id" | "at" | "read">) => void;
  markAllRead: () => void;
  markRead: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

const MAX = 40;

export const useNotifications = create<NotifState>()(
  persist(
    (set) => ({
      items: [],
      push: (n) =>
        set((s) => {
          // même message répété de suite : on rafraîchit l'ancien plutôt que d'empiler
          const rest = s.items.filter((i) => !(i.title === n.title && i.body === n.body));
          const item: Notice = { ...n, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: new Date().toISOString(), read: false };
          return { items: [item, ...rest].slice(0, MAX) };
        }),
      markAllRead: () => set((s) => ({ items: s.items.map((i) => ({ ...i, read: true })) })),
      markRead: (id) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, read: true } : i)) })),
      remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      clear: () => set({ items: [] }),
    }),
    {
      name: "ibox.notifications",
      version: 1,
      migrate: (state) => ({
        items: (state as Partial<NotifState>).items?.filter((item) =>
          !(item.title === "Boutique PC" && item.body === "Aucune installation ni aucun raccourci compatible trouvé."),
        ) ?? [],
      }),
    },
  ),
);

export const notify = (n: Omit<Notice, "id" | "at" | "read">) => {
  // réglage lu sans dépendance circulaire (Paramètres › Notifications)
  try {
    const raw = localStorage.getItem("ibox.settings");
    const st = raw ? JSON.parse(raw)?.state : null;
    if (st?.notificationsEnabled === false) return;
    // fenêtres de téléchargement masquées (jaquettes, illustrations, jingles…)
    if (st?.downloadPopups === false && /télécharg|récupér|jingle|illustration|jaquette|image/i.test(`${n.title} ${n.body ?? ""}`)) return;
  } catch {
    /* réglages illisibles : on notifie */
  }
  useNotifications.getState().push(n);
  forwardToScreen(n);
};

/**
 * iBox n'est pas au premier plan (partie en cours, autre fenêtre) : la notification s'affiche
 * aussi en bas à droite de l'écran, par-dessus le jeu. Les amis ont déjà leurs propres fenêtres.
 */
function forwardToScreen(n: Omit<Notice, "id" | "at" | "read">) {
  const link = linkOf(n);
  if (link?.kind === "friends" || link?.kind === "update") return;
  if (typeof document === "undefined" || (document.visibilityState === "visible" && document.hasFocus())) return;
  void import("./native").then(({ isTauri }) => {
    if (!isTauri()) return;
    return import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("toast_notice", { title: n.title, body: n.body ?? null, icon: n.icon, tone: n.tone, link: link ?? null, image: n.image ?? null }));
  }).catch(() => undefined);
}
export const useUnreadCount = () => useNotifications((s) => s.items.filter((i) => !i.read).length);
