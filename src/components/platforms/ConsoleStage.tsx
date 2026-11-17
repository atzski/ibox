import { AnimatePresence, motion } from "motion/react";
import type { ConsoleInfo } from "@/domain/platformCatalog";

/**
 * Une console exposée comme un objet de collection : photographie détourée qui
 * flotte doucement au-dessus de son ombre, halo coloré à son identité.
 * Partagé par la galerie et la fiche (même `layoutId` : la photo voyage d'un
 * écran à l'autre).
 */
export function ConsolePhoto({
  info,
  className = "",
  float = true,
  reduced,
  shared = true,
  priority,
}: {
  info: ConsoleInfo;
  className?: string;
  float?: boolean;
  reduced: boolean;
  shared?: boolean;
  priority?: boolean;
}) {
  const bob = float && !reduced;
  return (
    <div className={`relative ${className}`}>
      {/* ombre au sol : se resserre quand la console monte */}
      <motion.span
        aria-hidden
        className="absolute bottom-[3%] left-1/2 h-[8%] w-[64%] -translate-x-1/2 rounded-[50%] bg-[rgba(8,12,22,0.32)] blur-[18px]"
        animate={bob ? { scaleX: [1, 0.9, 1], opacity: [0.8, 0.55, 0.8] } : undefined}
        transition={bob ? { duration: 5.5, repeat: Infinity, ease: "easeInOut" } : undefined}
      />
      <motion.img
        layoutId={shared ? `console-photo-${info.id}` : undefined}
        src={info.photo}
        alt={info.name}
        draggable={false}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        className="absolute inset-0 z-[1] h-full w-full object-contain drop-shadow-[0_22px_26px_rgba(10,14,24,0.26)] select-none"
        animate={bob ? { y: ["0%", "-2.2%", "0%"] } : undefined}
        transition={bob ? { duration: 5.5, repeat: Infinity, ease: "easeInOut" } : { type: "spring", stiffness: 140, damping: 20 }}
      />
    </div>
  );
}

/** Halo d'ambiance de la console, en fondu d'une console à l'autre (thèmes clair et sombre). */
export function AmbienceHalo({ info, intensity = 1, center = "50% 42%" }: { info: ConsoleInfo; intensity?: number; center?: string }) {
  const a = info.ambience;
  const pct = (n: number) => `${Math.round(n * intensity)}%`;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <AnimatePresence initial={false}>
        <motion.div
          key={info.id}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          style={{
            background: [
              `radial-gradient(ellipse 55% 50% at ${center}, color-mix(in oklab, ${a.glow} ${pct(30)}, transparent) 0%, transparent 72%)`,
              `radial-gradient(ellipse 30% 28% at 78% 22%, color-mix(in oklab, ${a.accent} ${pct(20)}, transparent) 0%, transparent 70%)`,
              `linear-gradient(180deg, transparent 58%, color-mix(in oklab, ${a.floor} ${pct(12)}, transparent) 100%)`,
            ].join(", "),
          }}
        />
      </AnimatePresence>
    </div>
  );
}
