import { useEffect } from "react";
import type { Game } from "@/domain/types";
import { hasMedia } from "@/art/useMediaUrl";
import { focusAmbientGame, useShell } from "./shellState";

const IDLE_MS = 45_000;
const STEP_MS = 9_000;

/**
 * Mode vitrine de l'accueil : après un moment sans action, l'arrière-plan fait
 * défiler les jeux de la collection, comme un écran de console au repos. La
 * moindre action (clavier, souris, manette) le suspend aussitôt.
 */
export function useAttractMode(games: Game[], enabled: boolean): void {
  useEffect(() => {
    if (!enabled || games.length < 2) return;
    // les jeux qui ont un vrai visuel d'abord (fond ou jaquette)
    const pool = [...games].sort((a, b) => score(b) - score(a)).slice(0, 12);
    let idle: ReturnType<typeof setTimeout> | undefined;
    let cycle: ReturnType<typeof setInterval> | undefined;
    let i = 0;
    let showing = false;

    const start = () => {
      showing = true;
      const show = () => focusAmbientGame(pool[i++ % pool.length]);
      show();
      cycle = setInterval(show, STEP_MS);
    };
    const wake = () => {
      clearTimeout(idle);
      clearInterval(cycle);
      if (showing) {
        showing = false;
        // retour au jeu sélectionné (s'il y en a un), sinon aux couleurs d'accueil
        const focused = document.activeElement?.getAttribute("data-focus-id");
        if (!focused?.startsWith("game:")) useShell.setState({ ambientGame: null });
      }
      idle = setTimeout(start, IDLE_MS);
    };

    const events = ["keydown", "pointermove", "pointerdown", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    idle = setTimeout(start, IDLE_MS);
    return () => {
      clearTimeout(idle);
      clearInterval(cycle);
      events.forEach((e) => window.removeEventListener(e, wake));
    };
  }, [games, enabled]);
}

function score(g: Game): number {
  return (hasMedia(g, "hero") ? 2 : 0) + (hasMedia(g, "front") ? 1 : 0);
}
