/**
 * Rythme d'une scène React Three Fiber en `frameloop="demand"` : ce composant demande les images.
 *
 * - `fps` : plafond d'images par seconde (`null` : rythme de l'écran). Les animations (`useFrame`)
 *   continuent, au rythme choisi.
 * - `idle` : rendu à la demande. La scène n'est plus dessinée une fois posée (aucun signe de vie
 *   depuis `SETTLE_MS`, voir `activity.ts`) et reprend au premier geste. À réserver aux scènes sans
 *   mouvement perpétuel (l'étagère).
 *
 * Voir `services/graphics.ts`.
 */
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { onSceneActivity, scenesActive, wakeScenes } from "./activity";

export function FrameCap({ fps, idle = false }: { fps: number | null; idle?: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const step = fps ? 1000 / fps : 0;
    // calé sur l'affichage (pas de minuterie qui dérive) : une image tous les `step` ms
    const tick = (now: number) => {
      if (idle && !scenesActive(performance.now())) {
        raf = 0;
        return;
      }
      if (now - last >= step - 1) {
        last = now;
        invalidate();
      }
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    // une scène qui s'ouvre (ou change de rythme) a toujours quelque chose à poser
    if (idle) wakeScenes();
    start();
    const off = idle ? onSceneActivity(start) : undefined;
    return () => {
      cancelAnimationFrame(raf);
      off?.();
    };
  }, [fps, idle, invalidate]);
  return null;
}
