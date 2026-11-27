import { AchievementsCard } from "@/components/achievements/RaParts";
import type { Game } from "@/domain/types";

/**
 * Succès d'un jeu (consoles via RetroAchievements, PC via Steam) : sur la fiche,
 * une carte (ou une pastille compacte) qui ouvre la page du jeu dans l'univers des succès.
 */
export function Achievements({ game, inline = false, compact = false, ringOnly = false }: { game: Game; inline?: boolean; compact?: boolean; ringOnly?: boolean }) {
  return <AchievementsCard key={game.id} game={game} inline={inline} compact={compact} ringOnly={ringOnly} />;
}
