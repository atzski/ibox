import { AchievementsCard } from "@/components/achievements/RaParts";
import type { Game } from "@/domain/types";

/**
 * Succès d'une fiche de jeu (Steam pour les jeux PC, RetroAchievements pour les consoles) :
 * une carte qui ouvre la page du jeu dans l'univers des succès.
 */
export function Achievements({ game, inline = false }: { game: Game; inline?: boolean }) {
  return <AchievementsCard key={game.id} game={game} inline={inline} />;
}
