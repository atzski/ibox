import type { Game } from "@/domain/types";
import { relativeDay } from "@/domain/text";
import { useLibrary } from "@/services/library";
import { CoverImage } from "@/components/game/CoverImage";

/** Dernier jeu lancé (vraie collection uniquement). */
export function useLastPlayed(): Game | undefined {
  return useLibrary((l) => {
    let best: Game | undefined;
    for (const g of l.realGames) if (g.lastPlayedAt && (!best || g.lastPlayedAt > best.lastPlayedAt!)) best = g;
    return best;
  });
}

/**
 * Pastille « dernier jeu joué » du profil : c'est aussi ce que vos amis
 * verront sur votre carte iNetbox.
 */
export function LastPlayedChip({ game, compact = false }: { game: Game; compact?: boolean }) {
  return (
    <div className={`flex min-w-0 items-center gap-3 rounded-2xl bg-white/75 shadow-xs backdrop-blur-sm ${compact ? "py-1.5 pr-4 pl-1.5" : "py-2 pr-5 pl-2"}`}>
      <CoverImage game={game} className={`${compact ? "w-9" : "w-11"} shrink-0`} rounded="rounded-[0.45rem]" sheen={false} />
      <div className="min-w-0">
        <div className="text-[0.66rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Dernier jeu · {relativeDay(game.lastPlayedAt!)}</div>
        <div className={`truncate font-bold text-ink ${compact ? "max-w-[14rem] text-[0.88rem]" : "max-w-[20rem] text-[0.98rem]"}`}>{game.title}</div>
      </div>
    </div>
  );
}
