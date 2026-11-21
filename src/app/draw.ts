import { useNav } from "./navigation";
import { useLibrary } from "@/services/library";
import { useSettings } from "@/services/settings";
import { sound } from "@/services/sound";

/**
 * « Au hasard » : iBox choisit un jeu à votre place. La demande peut venir de
 * partout (accueil, menu rapide, recherche, touche R) ; c'est toujours l'étagère
 * 3D qui joue le tirage, en faisant défiler ses boîtiers jusqu'au jeu tiré.
 */

/** Nom de l'événement écouté par l'étagère déjà affichée. */
export const DRAW_EVENT = "ibox:draw";

/** Une demande faite avant l'arrivée sur l'étagère l'attend quelques secondes, pas plus. */
const PENDING_MS = 4000;
let pendingAt = 0;

/** Une demande attend-elle l'étagère ? (sans la consommer) */
export function drawPending(): boolean {
  return pendingAt > 0 && Date.now() - pendingAt < PENDING_MS;
}

/** L'étagère qui s'affiche prend la demande en attente (une seule fois). */
export function takeDraw(): boolean {
  const waiting = drawPending();
  pendingAt = 0;
  return waiting;
}

export function requestDraw(): void {
  if (useLibrary.getState().games.length < 2) {
    sound.play("error");
    return;
  }
  const nav = useNav.getState();
  const route = nav.stack[nav.stack.length - 1];
  const settings = useSettings.getState();
  // bibliothèque d'une console (ou toute la collection) : le tirage reste dans ce qu'elle montre
  const inLibrary = route?.name === "library" && route.platformId !== "pc";
  if (inLibrary && settings.libraryView === "shelf") {
    window.dispatchEvent(new Event(DRAW_EVENT));
    return;
  }
  pendingAt = Date.now();
  if (inLibrary) {
    // vue Jaquettes : on passe sur l'étagère, qui tire en arrivant
    sound.play("view");
    settings.set("libraryView", "shelf");
    return;
  }
  sound.play("enter");
  settings.set("libraryView", "shelf");
  nav.go({ name: "library", platformId: "all" });
}
