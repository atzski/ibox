/**
 * Plafond d'images par seconde d'une scène React Three Fiber : la scène passe en
 * `frameloop="demand"` et ce composant demande une image à intervalle régulier. Les animations
 * (`useFrame`) continuent, au rythme choisi. Voir `services/graphics.ts`.
 */
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

export function FrameCap({ fps }: { fps: number }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const step = 1000 / fps;
    // calé sur l'affichage (pas de minuterie qui dérive) : une image tous les `step` ms
    const tick = (now: number) => {
      if (now - last >= step - 1) {
        last = now;
        invalidate();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fps, invalidate]);
  return null;
}
