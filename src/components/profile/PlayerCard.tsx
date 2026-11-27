import { compat } from "@/theme/cssCompat";
import type { ReactNode } from "react";
import { Avatar } from "./Avatar";
import { getPlatform } from "@/domain/platforms";
import type { AvatarChoice } from "@/services/settings";
import { useLibrary } from "@/services/library";
import { CoverImage } from "@/components/game/CoverImage";
import type { FeaturedGame } from "@/services/inetbox";

/**
 * Carte de joueur : bannière, photo, nom, statut, bio et jeux favoris.
 * Sert à l'aperçu du profil public et au profil d'un ami.
 */
export function PlayerCard({ name, avatar, bio, accent, banner, games, status, actions }: {
  name: string; avatar: AvatarChoice | null; bio?: string; accent?: string | null;
  banner?: string | null; games?: FeaturedGame[];
  status?: ReactNode; actions?: ReactNode;
}) {
  const tint = accent ?? "#88CBF5";
  const library = useLibrary((s) => s.realGames);
  return (
    <div
      className="isolate overflow-hidden rounded-[1.8rem] bg-cream-deep text-center shadow-[0_18px_40px_-22px_rgba(30,40,70,0.55)] ring-1 ring-ink/10"
      style={{ background: compat(`linear-gradient(180deg, color-mix(in oklab, ${tint} 14%, var(--ibox-cream-deep)), var(--ibox-cream-deep) 55%)`) }}
    >
      {/* bannière */}
      <div aria-hidden className="relative h-40 overflow-hidden" style={{ background: compat(`linear-gradient(125deg, ${tint}, color-mix(in oklab, ${tint} 35%, #F6E9FF) 60%, #FFEFE6)`) }}>
        {banner && <img src={banner} alt="" className="h-full w-full scale-105 object-cover" />}
        <span className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,transparent_40%,rgba(10,15,30,0.35))]" />
        <span className="absolute inset-x-0 bottom-0 h-16" style={{ background: compat(`linear-gradient(180deg, transparent, color-mix(in oklab, ${tint} 14%, var(--ibox-cream-deep)))`) }} />
      </div>
      <div className="relative px-5 pb-6">
        {/* photo avec halo à la couleur du profil */}
        <span className="relative mx-auto -mt-16 inline-block rounded-full p-1.5" style={{ background: `conic-gradient(from 200deg, ${tint}, #ffffff, ${tint})`, boxShadow: `0 10px 30px -8px ${tint}` }}>
          <span className="block rounded-full ring-4 ring-[var(--ibox-cream-deep)]">
            <Avatar size={108} choice={avatar} name={name} />
          </span>
        </span>
        <h3 data-no-i18n className="mt-2 break-words font-display text-[1.9rem] leading-tight text-ink">{name}</h3>
        {status && (
          <p className="mx-auto mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-[0.82rem] font-bold text-ink-soft shadow-xs">
            <span className="size-2 rounded-full" style={{ background: tint }} />
            {status}
          </p>
        )}
        {bio && (
          <p data-no-i18n className="relative mx-auto mt-3 max-w-[22rem] break-words rounded-2xl bg-white/75 px-4 py-2.5 text-[0.92rem] text-ink shadow-xs">
            <span aria-hidden className="absolute -top-2 left-4 font-display text-[2rem] leading-none" style={{ color: tint }}>“</span>
            {bio}
          </p>
        )}
        {actions}
        {!!games?.length && (
          <div className="mt-5 text-left">
            <h4 className="mb-2 flex items-center gap-2 text-[0.7rem] font-extrabold tracking-[0.14em] text-ink-soft uppercase">
              <span className="h-px flex-1 bg-ink/10" />Jeux favoris<span className="h-px flex-1 bg-ink/10" />
            </h4>
            <div className="grid grid-cols-3 gap-2.5">
              {games.slice(0, 6).map((game, index) => {
                const owned = library.find((g) => g.platformId === game.platformId && g.title.toLowerCase() === game.title.toLowerCase());
                const platform = getPlatform(game.platformId);
                return (
                  <div key={index} className="group overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-ink/5" title={game.title}>
                    <div className="relative aspect-[3/4] overflow-hidden">
                      {game.cover ? <img src={game.cover} alt="" loading="lazy" className="h-full w-full object-cover" /> : owned ? <CoverImage game={owned} /> : (
                        <div className="flex h-full items-end p-2" style={{ background: `linear-gradient(150deg, ${platform?.theme.primary ?? tint}, ${platform?.theme.deep ?? "#344459"})` }}>
                          <span data-no-i18n className="line-clamp-3 font-display text-[0.85rem] leading-tight text-white drop-shadow">{game.title}</span>
                        </div>
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <span data-no-i18n className="block truncate text-[0.72rem] font-bold text-ink">{game.title}</span>
                      <span className="block truncate text-[0.66rem] text-ink-soft">{platform?.shortName ?? platform?.name}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
