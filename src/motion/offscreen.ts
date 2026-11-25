/**
 * Animations coupées hors écran : un conteneur sorti de la zone visible (accueil défilé plus bas)
 * reçoit `data-offscreen`, et `styles/performance.css` y met en pause toutes les animations CSS.
 * Rien ne change à l'écran : ce qui est visible s'anime comme avant, ce qui ne l'est pas cesse
 * d'occuper le processeur et la carte graphique.
 */
import { useCallback, useState } from "react";

/**
 * Renvoie la référence à poser sur le conteneur et son état (`true` : hors écran), pour arrêter
 * aussi les minuteries qui l'animent.
 */
export function useOffscreenPause<T extends HTMLElement>(): [(el: T | null) => void | (() => void), boolean] {
  const [off, setOff] = useState(false);
  const ref = useCallback((el: T | null) => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      const hidden = !entries[entries.length - 1].isIntersecting;
      if (hidden) el.dataset.offscreen = "";
      else delete el.dataset.offscreen;
      setOff(hidden);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      delete el.dataset.offscreen;
      setOff(false);
    };
  }, []);
  return [ref, off];
}
