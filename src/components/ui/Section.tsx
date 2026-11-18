import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "./Icon";
import { sound } from "@/services/sound";

/**
 * Rangée titrée défilant horizontalement (accueil).
 *
 * À la manette ou au clavier, la rangée suit la sélection. À la souris, deux
 * flèches apparaissent au survol sur les bords qui ont encore du contenu.
 */
export function ShelfRow({
  title,
  action,
  children,
  group,
  wrap,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  group: string;
  /** Lignes successives au lieu d'une rangée qui défile (rien n'est caché). */
  wrap?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // le contenu arrive en décalé (apparition progressive des cartes)
    const late = window.setTimeout(measure, 600);
    return () => {
      ro.disconnect();
      window.clearTimeout(late);
    };
  }, [measure]);

  const scrollBy = (dir: -1 | 1) => {
    const el = scroller.current;
    if (!el) return;
    sound.play("move");
    el.scrollBy({ left: dir * el.clientWidth * 0.75, behavior: "smooth" });
  };

  return (
    <section className="group/row relative mt-6">
      <div className="mb-3 flex items-end justify-between px-[3rem]">
        <h2 className="text-[1.3rem] font-semibold text-ink">{title}</h2>
        {action}
      </div>
      <div className="relative">
        <motion.div
          ref={scroller}
          data-nav-group={group}
          onScroll={measure}
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.045, delayChildren: 0.08 } } }}
          className={wrap
            ? "flex flex-wrap gap-x-5 gap-y-7 px-[3rem] pt-5 pb-7"
            : "no-scrollbar flex gap-5 overflow-x-auto scroll-smooth px-[3rem] pt-5 pb-7 [scroll-padding-inline:3rem]"}
        >
          {children}
        </motion.div>
        <ScrollArrow side="left" visible={!wrap && edges.left} onClick={() => scrollBy(-1)} />
        <ScrollArrow side="right" visible={!wrap && edges.right} onClick={() => scrollBy(1)} />
      </div>
    </section>
  );
}

/**
 * Flèche de défilement pour la souris. Volontairement hors de la navigation
 * clavier/manette (pas de `data-focusable`) : ces entrées suivent déjà la sélection.
 */
function ScrollArrow({ side, visible, onClick }: { side: "left" | "right"; visible: boolean; onClick: () => void }) {
  return (
    // visible seulement à la souris, au survol de la rangée
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          tabIndex={-1}
          aria-label={side === "left" ? "Faire défiler vers la gauche" : "Faire défiler vers la droite"}
          onClick={onClick}
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.85 }}
          transition={{ duration: 0.2 }}
          className={`ibox-scroll-arrow absolute top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-ink shadow-md backdrop-blur-sm transition-[opacity,transform] hover:scale-110 hover:bg-white active:scale-95 ${
            side === "left" ? "left-3" : "right-3"
          }`}
        >
          <Icon name="chevronRight" size="1.35em" className={side === "left" ? "rotate-180" : ""} />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

/** État vide soigné, toujours accompagné d'une explication honnête. */
export function EmptyState({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex max-w-[34rem] flex-col items-center py-16 text-center"
    >
      <div className="mb-6 grid h-32 w-32 place-items-center rounded-[2.5rem] bg-white text-accent-text shadow-md">
        {icon}
      </div>
      <h2 className="text-[1.6rem] font-semibold text-ink">{title}</h2>
      <p className="mt-2 text-[1rem] leading-relaxed font-semibold text-ink-soft">{body}</p>
      {children && <div className="mt-6 flex gap-3">{children}</div>}
    </motion.div>
  );
}
