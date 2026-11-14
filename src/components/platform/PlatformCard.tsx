import { motion } from "motion/react";
import type { Platform } from "@/domain/types";
import { PlatformGlyph } from "./PlatformGlyph";
import { platformCardBackground, themeVars } from "@/theme/platformTheme";
import { sound } from "@/services/sound";
import { cardEnter } from "@/components/game/GameCard";
import { usePlatformArt } from "@/services/platformArt";
import { trimStyle, useImageInfo } from "@/art/imageTone";

/**
 * Carte d'une console. Composition commune à toutes les machines :
 * - fond : illustration panoramique de la console (iiDB), sinon son dégradé ;
 * - tuile d'icône en haut à gauche (l'icône iiDB entière, ou la silhouette iBox) ;
 * - logo (ou nom) et nombre de jeux en bas, sur un voile choisi d'après la
 *   tonalité du logo : sombre (couleur profonde de la console) pour un logo
 *   clair, clair pour un logo foncé. Le logo n'est jamais recoloré.
 * Au focus : la carte se soulève, l'illustration avance à peine, le logo s'affirme.
 */
export function PlatformCard({
  platform,
  count,
  onOpen,
  size = "row",
  autoFocus,
}: {
  platform: Platform;
  count: number;
  onOpen: () => void;
  size?: "row" | "grid";
  autoFocus?: boolean;
}) {
  const dims = size === "row" ? "w-[15rem] h-[11rem]" : "w-full h-[12.5rem]";
  const hero = usePlatformArt(platform.id, "platform_hero");
  const icon = usePlatformArt(platform.id, "platform_icon");
  const logo = usePlatformArt(platform.id, "platform_logo");
  const logoInfo = useImageInfo(logo);
  const tone = logoInfo.tone;
  const t = platform.theme;
  const games = count > 0 ? `${count} jeu${count > 1 ? "x" : ""}` : "Aucun jeu";
  // logo clair : voile et texte « nuit » aux couleurs profondes de la console
  const night = tone === "light";
  const deep = `color-mix(in oklab, ${t.deep} 78%, #101522)`;
  const background = hero
    ? deep
    : night
      ? `linear-gradient(150deg, color-mix(in oklab, ${t.deep} 70%, ${t.primary}) 0%, ${deep} 100%)`
      : platformCardBackground(platform);

  return (
    <motion.div variants={cardEnter} className="shrink-0" style={themeVars(platform)}>
      <button
        data-focusable
        data-focus-id={`platform:${platform.id}`}
        data-autofocus={autoFocus || undefined}
        onClick={() => {
          sound.play("select");
          onOpen();
        }}
        aria-label={`${platform.name}, ${games}`}
        className={`ibox-focusable ibox-lift ibox-bubble group relative isolate flex ${dims} flex-col justify-between overflow-hidden rounded-lg p-4 text-left shadow-sm [--ring-radius:var(--radius-lg)]`}
        style={{ background, color: night || (hero && !logo) ? "#ffffff" : "var(--accent-text)" }}
      >
        {hero && (
          <img
            src={hero}
            alt=""
            draggable={false}
            className="absolute inset-0 -z-10 h-full w-full object-cover transition-transform duration-700 ease-[var(--ease-out-soft)] group-hover:scale-[1.05] group-focus:scale-[1.05]"
          />
        )}
        {(hero || logo) && (
          <span
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background: night || (hero && !logo)
                ? `linear-gradient(180deg, transparent 30%, color-mix(in oklab, ${deep} 72%, transparent) 70%, color-mix(in oklab, ${deep} 92%, transparent) 100%)`
                : `linear-gradient(180deg, transparent 30%, color-mix(in oklab, ${t.soft} 80%, transparent) 68%, color-mix(in oklab, ${t.soft} 96%, transparent) 100%)`,
            }}
          />
        )}
        {!hero && !logo && (
          <>
            <span className="pointer-events-none absolute -top-10 -right-8 h-36 w-36 rounded-full bg-white/45 blur-2xl" />
            <span className="pointer-events-none absolute right-4 bottom-3 opacity-20 transition-transform duration-500 ease-[var(--ease-bounce)] group-hover:scale-110 group-focus:scale-110">
              <PlatformGlyph glyph={platform.glyph} size={size === "row" ? 92 : 108} strokeWidth={1.8} />
            </span>
          </>
        )}

        {icon ? (
          <img
            src={icon}
            alt=""
            draggable={false}
            className="relative h-[3.25rem] w-[3.25rem] object-contain drop-shadow-[0_6px_10px_rgba(10,20,40,0.35)] transition-transform duration-300 ease-[var(--ease-bounce)] group-hover:-rotate-6 group-focus:-rotate-6 group-focus:scale-110"
          />
        ) : (
          <span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-white/85 text-accent-text shadow-xs transition-transform duration-300 ease-[var(--ease-bounce)] group-hover:-rotate-6 group-focus:-rotate-6 group-focus:scale-110">
            <PlatformGlyph glyph={platform.glyph} size={30} />
          </span>
        )}

        <span className="relative">
          {logo ? (
            <>
              <img
                src={logo}
                alt=""
                draggable={false}
                style={trimStyle(logoInfo)}
                className={`block max-h-[2.7rem] max-w-[88%] origin-left object-contain object-left transition-transform duration-300 ease-[var(--ease-bounce)] group-hover:scale-[1.04] group-focus:scale-[1.06] ${night ? "drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]" : ""}`}
              />
              <span className="sr-only">{platform.shortName}</span>
            </>
          ) : (
            <span className="block font-display text-[1.25rem] leading-tight font-semibold [text-shadow:0_1px_8px_rgba(0,0,0,0.25)]">{platform.shortName}</span>
          )}
          <span className="mt-1 block text-[0.82rem] font-bold opacity-85">
            {games}
            {size === "grid" && ` · ${platform.year}`}
          </span>
        </span>
      </button>
    </motion.div>
  );
}
