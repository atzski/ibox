import { useNav } from "@/app/navigation";

/**
 * Destinations d'iBox : ce vers quoi mène une notification (dans iBox ou dans la fenêtre
 * en bas à droite de l'écran). Sérialisables : elles voyagent avec la notification.
 */
export type AppLink =
  | { kind: "game"; gameId: string }
  | { kind: "library"; platformId: string }
  | { kind: "settings"; category?: string }
  | { kind: "duplicates" }
  | { kind: "update" }
  | { kind: "achievements"; gameId?: string }
  | { kind: "friends"; view?: "list" | "requests"; friendId?: string };

/** Ouvre la destination d'une notification. */
export function openLink(link: AppLink) {
  const nav = useNav.getState();
  const current = nav.stack[nav.stack.length - 1];
  switch (link.kind) {
    case "game":
      if (!(current.name === "game" && current.gameId === link.gameId)) nav.go({ name: "game", gameId: link.gameId });
      return;
    case "library":
      nav.go({ name: "library", platformId: link.platformId });
      return;
    case "settings":
      window.dispatchEvent(new CustomEvent("ibox:settings-category", { detail: link.category }));
      if (current.name !== "settings") nav.go({ name: "settings", category: link.category });
      return;
    case "duplicates":
      window.dispatchEvent(new Event("ibox:open-duplicates"));
      return;
    case "update":
      openLink({ kind: "settings", category: "system" });
      void import("./updater").then(({ useUpdater }) => useUpdater.getState().install());
      return;
    case "achievements":
      if (current.name !== "achievements") nav.go({ name: "achievements", gameId: link.gameId });
      else window.dispatchEvent(new CustomEvent("ibox:achievements-game", { detail: link.gameId }));
      return;
    case "friends":
      window.dispatchEvent(new CustomEvent("ibox:open-friends", {
        detail: link.friendId ? { view: "profile", friendId: link.friendId } : { view: link.view ?? "list" },
      }));
      return;
  }
}
