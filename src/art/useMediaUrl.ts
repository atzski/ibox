import { useEffect, useState } from "react";
import type { Game } from "@/domain/types";
import { metadataApi, type MediaKind } from "@/services/metadata";
import { isTauri } from "@/services/native";

/**
 * Adresse locale (blob:) d'une image du cache d'un jeu, ou null si elle
 * n'existe pas. Libérée automatiquement quand le jeu ou l'image change.
 */
export function useMediaUrl(game: Game, kind: MediaKind): string | null {
  const ref = (game.media ?? []).find((m) => m.kind === kind && m.slot === 0);
  const stamp = ref ? `${game.dbId}|${kind}|${ref.addedAt}` : null;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!stamp || game.dbId === undefined || !isTauri()) {
      setUrl(null);
      return;
    }
    let alive = true;
    let made: string | null = null;
    metadataApi
      .read(game.dbId, kind, 0)
      .then((bytes) => {
        if (!alive) return;
        made = URL.createObjectURL(new Blob([bytes]));
        setUrl(made);
      })
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  return url;
}
