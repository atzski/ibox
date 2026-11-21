import { SPRING } from "@/motion/tokens";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ConsoleInfo } from "@/domain/platformCatalog";
import { ConsolePhoto } from "./ConsoleStage";

/** Consoles visibles de chaque côté de la console choisie. */
const SIDE = 3;

/** Position horizontale (fraction de la largeur) et allure selon l'écart à la console choisie. */
function place(d: number) {
  const a = Math.abs(d);
  const x = a === 0 ? 0 : Math.sign(d) * (0.37 + (a - 1) * 0.13);
  const scale = [1, 0.46, 0.34, 0.26][a] ?? 0.22;
  const opacity = [1, 0.62, 0.32, 0][a] ?? 0;
  return { x, scale, opacity };
}

/**
 * Étagère de présentation : les consoles posées côte à côte sur une planche
 * vitrée défilent ensemble ; la console choisie avance au centre, ses voisines
 * restent en retrait de part et d'autre. Clic sur une voisine : elle vient au
 * centre ; clic sur la console du centre : sa fiche s'ouvre.
 */
export function ConsoleShelf({
  list,
  activeId,
  reduced,
  onSelect,
  onOpen,
}: {
  list: ConsoleInfo[];
  activeId: string;
  reduced: boolean;
  onSelect: (c: ConsoleInfo) => void;
  onOpen: (c: ConsoleInfo) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const index = Math.max(0, list.findIndex((c) => c.id === activeId));
  // largeur d'une place sur l'étagère : la console du centre garde ses proportions
  const slot = Math.min(width * 0.42, 38 * 16);
  const spring = reduced ? { duration: 0.15 } : SPRING.gentle;

  return (
    <div ref={box} className="relative h-full w-full overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_9%,black_91%,transparent)]">
      {/* planche vitrée : un reflet net sur le bord, une ombre douce dessous */}
      <div aria-hidden className="pointer-events-none absolute right-[6%] bottom-[9%] left-[6%] h-[2.2rem]">
        <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--color-ink)_22%,transparent)_18%,color-mix(in_oklab,var(--color-ink)_22%,transparent)_82%,transparent)]" />
        <div className="absolute inset-x-0 top-px h-[0.55rem] bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--color-white)_55%,transparent)_20%,color-mix(in_oklab,var(--color-white)_55%,transparent)_80%,transparent)] opacity-70" />
        <div className="absolute inset-x-[8%] top-[0.55rem] h-[1.6rem] rounded-[50%] bg-[rgba(8,12,22,0.16)] blur-[14px]" />
      </div>

      {list.map((c, i) => {
        const d = i - index;
        if (Math.abs(d) > SIDE + 1) return null;
        const p = place(d);
        const center = d === 0;
        return (
          <motion.button
            key={c.id}
            type="button"
            tabIndex={-1}
            aria-label={c.name}
            onClick={() => (center ? onOpen(c) : onSelect(c))}
            initial={false}
            animate={{ x: p.x * width - slot / 2, scale: p.scale, opacity: p.opacity }}
            transition={spring}
            style={{ width: slot, left: "50%", zIndex: 10 - Math.abs(d), transformOrigin: "50% 100%", pointerEvents: p.opacity === 0 ? "none" : "auto" }}
            className={`group absolute top-[4%] bottom-[11%] cursor-pointer ${center ? "" : "grayscale-[25%]"}`}
          >
            <ConsolePhoto
              info={c}
              reduced={reduced}
              float={center}
              align="bottom"
              priority={center}
              className={`h-full w-full transition-transform duration-500 ease-[var(--ease-out-soft)] ${center ? "group-hover:scale-[1.02]" : "group-hover:scale-[1.06]"}`}
            />
          </motion.button>
        );
      })}
    </div>
  );
}
