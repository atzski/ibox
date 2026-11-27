import { compat } from "@/theme/cssCompat";
import { EASE, SPRING } from "@/motion/tokens";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import type { Platform } from "@/domain/types";
import { Icon } from "@/components/ui/Icon";
import { PlatformGlyph } from "./PlatformGlyph";
import { usePlatformArt } from "@/services/platformArt";
import { useReducedMotion } from "@/app/shellState";
import { trimStyle, useImageInfo } from "@/art/imageTone";

/**
 * En-tête d'une page de console. Avec une illustration panoramique (iiDB) :
 * bandeau large, image recadrée sans déformation, icône, logo et compteurs à
 * gauche sur un voile latéral choisi d'après la tonalité du logo, actions à droite.
 * Sans illustration : l'en-tête compact habituel (avec icône et logo s'ils existent).
 */
export function ConsoleHeader({
  platform,
  total,
  children,
  compact = false,
}: {
  platform?: Platform;
  total: number;
  children?: ReactNode;
  compact?: boolean;
}) {
  const id = platform?.id ?? "";
  const hero = usePlatformArt(id, "platform_hero");
  const logo = usePlatformArt(id, "platform_logo");
  const icon = usePlatformArt(id, "platform_icon");
  const logoInfo = useImageInfo(logo);
  const tone = logoInfo.tone;
  const reduced = useReducedMotion();
  const title = platform ? platform.shortName : "Toute la collection";
  const banner = !!platform && !!hero;
  // logo clair ou bandeau sans logo : voile « nuit » et texte clair
  const night = banner && (tone === "light" || !logo);

  const meta = (
    <div className={`mt-1.5 text-[0.95rem] font-bold ${night ? "text-white/85" : "text-ink/75"}`}>
      {`${total} jeu${total > 1 ? "x" : ""}`}
      {platform && ` · ${platform.manufacturer} · ${platform.year}`}
    </div>
  );
  const badge = icon ? (
    <img src={icon} alt="" draggable={false} className="h-16 w-16 shrink-0 object-contain drop-shadow-[0_4px_8px_rgba(10,20,40,0.25)]" />
  ) : (
    <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[1.4rem] bg-white text-accent-text shadow-sm">
      {platform ? <PlatformGlyph glyph={platform.glyph} size={40} /> : <Icon name="grid" size="2rem" />}
    </span>
  );
  // un logo clair sans bandeau serait invisible sur le fond crème : on garde le nom
  const showLogo = !!logo && (banner || tone === "dark");
  const name = showLogo ? (
    <h1 className="m-0">
      <img src={logo!} alt={title} draggable={false} style={trimStyle(logoInfo)} className={`block max-h-[3.4rem] max-w-[22rem] object-contain object-left ${night ? "drop-shadow-[0_2px_10px_rgba(0,0,0,0.35)]" : ""}`} />
    </h1>
  ) : (
    <h1 className={`text-[2.3rem] leading-none font-semibold ${night ? "text-white" : "text-ink"}`}>{title}</h1>
  );

  const t = platform?.theme;
  const deep = compat(`color-mix(in oklab, ${t?.deep ?? "#101522"} 78%, #101522)`);
  const veil = night
    ? compat(`linear-gradient(90deg, color-mix(in oklab, ${deep} 88%, transparent) 0%, color-mix(in oklab, ${deep} 62%, transparent) 38%, transparent 78%)`)
    : compat(`linear-gradient(90deg, color-mix(in oklab, ${t?.soft ?? "#eef0f4"} 96%, transparent) 0%, color-mix(in oklab, ${t?.soft ?? "#eef0f4"} 82%, transparent) 34%, transparent 76%)`);

  if (compact) {
    return (
      <div className="relative isolate flex items-center justify-between gap-5 overflow-hidden rounded-xl px-5 py-3 shadow-sm" style={banner ? { background: deep } : undefined}>
        {banner && (
          <>
            <img src={hero!} alt="" draggable={false} className="absolute inset-0 -z-10 h-full w-full object-cover object-[center_40%]" />
            <span className="pointer-events-none absolute inset-0 -z-10" style={{ background: veil }} />
          </>
        )}
        <div className="flex min-w-0 items-center gap-4">
          {badge}
          {showLogo && (
            <img src={logo!} alt="" draggable={false} style={trimStyle(logoInfo)} className="max-h-12 max-w-24 object-contain" />
          )}
          <div className={`min-w-0 ${night ? "text-[#f3f5fb]" : "text-ink"}`}>
            <h1 className="truncate text-xl font-bold">{platform?.name ?? title}</h1>
            <p className="text-sm font-semibold opacity-75">{`${total} jeu${total > 1 ? "x" : ""}`}</p>
          </div>
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    );
  }

  if (!banner) {
    return (
      <div className="flex items-end justify-between gap-6 pt-1">
        <motion.div key={id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-4">
          {badge}
          <div>
            {name}
            {meta}
          </div>
        </motion.div>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      key={id}
      initial={{ opacity: 0, y: reduced ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING.gentle}
      className="relative isolate mt-1 flex h-[9.5rem] items-center justify-between gap-6 overflow-hidden rounded-xl px-7 shadow-sm"
      style={{ background: deep }}
    >
      <motion.img
        src={hero!}
        alt=""
        draggable={false}
        initial={{ scale: reduced ? 1 : 1.06 }}
        animate={{ scale: 1 }}
        transition={{ duration: 1.1, ease: EASE.out }}
        className="absolute inset-0 -z-10 h-full w-full object-cover object-[center_40%]"
      />
      <span className="pointer-events-none absolute inset-0 -z-10" style={{ background: veil }} />
      <div className="flex min-w-0 items-center gap-4">
        {badge}
        <div className="min-w-0">
          {name}
          {meta}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </motion.div>
  );
}
