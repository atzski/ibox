import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { IconName } from "@/components/ui/Icon";

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
}

interface NotifState {
  items: Notice[];
  push: (n: Omit<Notice, "id" | "at" | "read">) => void;
  markAllRead: () => void;
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
    if (raw && JSON.parse(raw)?.state?.notificationsEnabled === false) return;
  } catch {
    /* réglages illisibles : on notifie */
  }
  useNotifications.getState().push(n);
};
export const useUnreadCount = () => useNotifications((s) => s.items.filter((i) => !i.read).length);
