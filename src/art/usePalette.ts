import { useEffect, useState } from "react";
import type { Game } from "@/domain/types";
import { basePalette, type Palette } from "./assets";
import { artKey, getPalette } from "./covers";

/** Palette d'un jeu pour teinter l'interface : celle de la vraie jaquette dès qu'elle est chargée. */
export function useArtPalette(game: Game): Palette {
  const [palette, setPalette] = useState<Palette>(() => basePalette(game));
  const key = artKey(game);
  useEffect(() => {
    let alive = true;
    void getPalette(game).then((p) => alive && setPalette(p));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return palette;
}
