import { useEffect, useState } from "react";
import { useThree } from "@react-three/fiber";
import { SRGBColorSpace, Texture } from "three";
import type { Game } from "@/domain/types";
import { useManual } from "@/services/manuals";
import { manualCover } from "@/services/manualPdf";

/** Couverture du manuel d'un jeu en texture (null : pas de manuel, ou pas encore prête). */
export function useManualTexture(game: Game): Texture | null {
  const manual = useManual(game.dbId);
  const gl = useThree((s) => s.gl);
  const [texture, setTexture] = useState<Texture | null>(null);
  const key = manual ? `${manual.gameId}|${manual.addedAt}` : null;

  useEffect(() => {
    if (!manual) {
      setTexture(null);
      return;
    }
    let alive = true;
    let made: Texture | null = null;
    let url: string | null = null;
    void manualCover(manual.gameId, manual.addedAt).then((blob) => {
      if (!alive || !blob) return;
      url = URL.createObjectURL(blob);
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        if (!alive) return;
        made = new Texture(img);
        made.colorSpace = SRGBColorSpace;
        made.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
        made.needsUpdate = true;
        setTexture(made);
      };
      img.src = url;
    });
    return () => {
      alive = false;
      made?.dispose();
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, gl]);

  return texture;
}
