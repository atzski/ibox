import { AnimatePresence, motion } from "motion/react";
import type { ConsoleInfo } from "@/domain/platformCatalog";

/** Durée d'un cycle de flottement (ms). */
const FLOAT_MS = 6000;

/**
 * Une console exposée comme un objet de collection : photographie détourée qui
 * flotte doucement, de haut en bas, au-dessus de son ombre.
 *
 * Le flottement est une animation CSS calée sur l'horloge : une console qui
 * réapparaît (changement de console, retour de fiche) reprend à la même phase,
 * sans repartir de zéro.
 */
export function ConsolePhoto({
  info,
  className = "",
  float = true,
  reduced,
  priority,
  align = "center",
}: {
  info: ConsoleInfo;
  className?: string;
  float?: boolean;
  reduced: boolean;
  priority?: boolean;
  /** « bottom » : posée sur une étagère (photo calée en bas). */
  align?: "center" | "bottom";
}) {
  const bob = float && !reduced;
  // phase commune à toutes les consoles : délai négatif pris sur l'horloge
  const phase = bob ? { animationDelay: `-${Date.now() % FLOAT_MS}ms`, animationDuration: `${FLOAT_MS}ms` } : undefined;
  return (
    <div className={`relative ${className}`}>
      {/* ombre au sol : se resserre quand la console monte */}
      <span
        aria-hidden
        style={phase}
        className={`absolute left-1/2 h-[8%] w-[64%] -translate-x-1/2 rounded-[50%] bg-[rgba(8,12,22,0.32)] blur-[18px] ${align === "bottom" ? "-bottom-[3%]" : "bottom-[3%]"} ${bob ? "ibox-float-shadow" : ""}`}
      />
      <img
        src={info.photo}
        alt={info.name}
        draggable={false}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        style={phase}
        className={`absolute inset-0 z-[1] h-full w-full object-contain drop-shadow-[0_22px_26px_rgba(10,14,24,0.26)] select-none ${align === "bottom" ? "object-bottom" : ""} ${bob ? "ibox-float" : ""}`}
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
