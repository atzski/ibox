import { useEffect, useState } from "react";
import type { Game } from "@/domain/types";
import { metadataApi, type MediaKind } from "@/services/metadata";
import { isTauri } from "@/services/native";

/**
 * Le jeu a-t-il cette image, à cet emplacement ? L'emplacement 0 est l'image principale (le
 * « Fond », le logo…) ; les autres servent à part : icône (logo 1) et bannière Android TV
 * (fond 1) d'une application Android, qui ne doivent jamais passer pour l'image principale.
 */
export function hasMedia(game: Game | undefined, kind: MediaKind, slot = 0): boolean {
  return (game?.media ?? []).some((m) => m.kind === kind && m.slot === slot);
}

/**
 * Adresse locale (blob:) d'une image du cache d'un jeu, ou null si elle
 * n'existe pas. Libérée automatiquement quand le jeu ou l'image change.
 */
export function useMediaUrl(game: Game | undefined, kind: MediaKind, slot = 0): string | null {
  const ref = (game?.media ?? []).find((m) => m.kind === kind && m.slot === slot);
  const stamp = ref ? `${game?.dbId}|${kind}|${slot}|${ref.addedAt}` : null;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!stamp || game?.dbId === undefined || !isTauri()) {
      setUrl(null);
      return;
    }
    let alive = true;
    let made: string | null = null;
    metadataApi
      .read(game.dbId, kind, slot)
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
