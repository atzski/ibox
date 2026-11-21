import { useEffect } from "react";
import { useNav } from "@/app/navigation";
import type { Game } from "@/domain/types";
import { input } from "@/input/InputController";
import { compareGames, useLibrary } from "@/services/library";
import { useSettings, type LibrarySort } from "@/services/settings";
import { sound } from "@/services/sound";

/** Jeux de la même console, dans l'ordre de la bibliothèque (tri choisi). */
export function siblingsOf(game: Game, games: Game[], sort: LibrarySort): Game[] {
  return games
    .filter((g) => g.platformId === game.platformId && !!g.isDemo === !!game.isDemo)
    .sort(compareGames(sort));
}

/**
 * Fiche d'un jeu : Q / E (LB / RB) passent au jeu précédent / suivant de la
 * même console, comme on feuillette une collection.
 */
export function useGameSiblings(game: Game | undefined): void {
  const id = game?.id;
  useEffect(() => {
    if (!game) return;
    return input.onTab((d) => {
      const list = siblingsOf(game, useLibrary.getState().games, useSettings.getState().librarySort);
      const i = list.findIndex((g) => g.id === game.id);
      if (list.length < 2 || i < 0) return "quiet";
      const next = list[(i + d + list.length) % list.length];
      sound.play("move");
      useNav.getState().replace({ name: "game", gameId: next.id });
      return "quiet";
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
}
