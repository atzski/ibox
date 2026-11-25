import { SPRING, TWEEN } from "@/motion/tokens";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type UIEvent,
} from "react";
import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";
import type { Game } from "@/domain/types";
import { requirePlatform } from "@/domain/platforms";
import {
  MAX_ZOOM,
  anchoredScroll,
  computeLayout,
  coverRect,
  indexAt,
  maxScroll,
  moveIndex,
  pageIndex,
  revealScroll,
  rowRange,
  stepZoom,
  thumbWidth,
  zoomTransition,
  type GridLayout,
  type GridTransform,
} from "@/domain/coverZoom";
import { CoverTile, GameCard } from "@/components/game/GameCard";
import { isFavorite } from "@/services/library";
import { useSettings } from "@/services/settings";
import { Icon } from "@/components/ui/Icon";
import { getArtUrl } from "@/art/covers";
import { setThumbRank } from "@/art/thumbs";
import { input } from "@/input/InputController";
import { pickNext } from "@/input/spatial";

interface Metrics {
  width: number;
  height: number;
  rem: number;
}

interface Placement {
  layout: GridLayout;
  resetKey: string;
  scrollTop: number;
  /** Transformation de départ de l'animation de recul (sinon aucune animation). */
  flip: GridTransform | null;
  /** La carte sélectionnée avait le focus : elle le retrouve si le changement de niveau la remonte. */
  refocus: boolean;
  seq: number;
}

/**
 * Grille de jaquettes de la bibliothèque, avec ses niveaux de recul.
 *
 * Seules les rangées visibles (et une marge autour) sont montées : la grille reste fluide
 * avec des milliers de jeux, quel que soit le niveau. Les positions viennent toutes de
 * `domain/coverZoom` (calcul pur, testé) ; ce composant mesure la zone, suit le défilement,
 * conduit le focus par index (le voisin d'un jeu n'est pas toujours monté) et anime le
 * passage d'un niveau à l'autre autour du jeu sélectionné, ou du centre de la vue.
 *
 * Commandes du recul : Ctrl + molette (autour du jeu pointé), touches − et + (ou Ctrl − / + /
 * 0), stick droit vers la gauche (reculer) ou la droite (avancer).
 */
export function CoverGrid({
  games,
  cardRem,
  pc,
  level,
  onStep,
  resetKey,
  restoreFocus,
  reduced,
  onScroll,
}: {
  games: Game[];
  /** Largeur d'une jaquette au niveau 0 (rem), densité des Paramètres comprise. */
  cardRem: number;
  pc: boolean;
  level: number;
  /** Demande de recul (`+1`), d'avance (`-1`) ou de retour au niveau d'origine (`-MAX_ZOOM`). */
  onStep: (delta: number) => void;
  /** Change quand l'utilisateur change de filtre, de recherche ou de tri : retour en haut. */
  resetKey: string;
  /** Jeu à retrouver au retour d'une fiche (`game:<id>`). */
  restoreFocus?: string;
  reduced: boolean;
  /** `jump` : défilement posé par la grille elle-même (recul, retour), pas par l'utilisateur. */
  onScroll: (e: UIEvent<HTMLElement>, jump: boolean) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const width = metrics?.width ?? 0;
  const rem = metrics?.rem ?? 16;
  const viewH = metrics?.height ?? 0;

  const aspects = useMemo(() => games.map((g) => requirePlatform(g.platformId).layout.coverAspect), [games]);
  const indexOf = useMemo(() => new Map(games.map((g, i) => [g.id, i])), [games]);
  const layout = useMemo(
    () => (width > 0 ? computeLayout({ width, rem, cardRem, level, aspects, pc }) : null),
    [width, rem, cardRem, level, aspects, pc],
  );

  // jeu sélectionné : toujours monté, même hors de la vue (le focus ne se perd pas en défilant)
  const [focusId, setFocusId] = useState<string | null>(restoreFocus?.startsWith("game:") ? restoreFocus.slice(5) : null);
  const focusIndex = focusId === null ? -1 : (indexOf.get(focusId) ?? -1);

  const scrollTopRef = useRef(0);
  /** Jeu sous le pointeur au moment d'un Ctrl + molette. */
  const anchorRef = useRef(-1);
  const jumpRef = useRef(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const scale = useMotionValue(1);
  const originRef = useRef({ x: 0, y: 0 });

  // ——— Placement : où défiler quand la disposition change (état dérivé, calculé au rendu) ———
  const [placed, setPlaced] = useState<Placement | null>(null);
  const [winTop, setWinTop] = useState(0);
  if (layout && (placed?.layout !== layout || placed.resetKey !== resetKey)) {
    let scrollTop = 0;
    let flip: GridTransform | null = null;
    let refocus = false;
    if (!placed) {
      // arrivée sur l'écran : le jeu d'où l'on revient est remis au milieu
      scrollTop = focusIndex >= 0 ? anchoredScroll(layout, focusIndex, viewH / 2, viewH) : 0;
    } else if (placed.resetKey === resetKey) {
      const prev = placed.layout;
      const reshaped = prev.level !== layout.level || prev.cols !== layout.cols;
      const t = reshaped
        ? zoomTransition(prev, layout, {
            scrollTop: scrollTopRef.current,
            viewportH: viewH,
            focusIndex,
            anchorIndex: anchorRef.current,
            current: { x: x.get(), y: y.get(), scale: scale.get(), originX: originRef.current.x, originY: originRef.current.y },
          })
        : null;
      if (t) {
        scrollTop = t.scrollTop;
        // fenêtre redimensionnée : on garde la place, sans animation
        if (prev.level !== layout.level) flip = t.from;
        refocus = focusId !== null && (document.activeElement as HTMLElement | null)?.dataset?.focusId === `game:${focusId}`;
      } else {
        scrollTop = Math.min(scrollTopRef.current, maxScroll(layout, viewH));
      }
    }
    setPlaced({ layout, resetKey, scrollTop, flip, refocus, seq: (placed?.seq ?? 0) + 1 });
    setWinTop(scrollTop);
  }

  // ——— Fenêtre de rangées montées ———
  // marge montée autour de la vue : de quoi couvrir un défilement rapide et le début d'une
  // avance (le contenu part alors rétréci d'un tiers), sans doubler le nombre de jaquettes
  const over = Math.max(viewH * 0.3, 160);
  const [first, last] = layout ? rowRange(layout, winTop - over, winTop + viewH + over) : [0, -1];

  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    scrollTopRef.current = top;
    onScroll(e, jumpRef.current);
    jumpRef.current = false;
    if (!layout) return;
    const [f, l] = rowRange(layout, top - over, top + viewH + over);
    if (f !== first || l !== last) setWinTop(top);
  };

  // mesure de la zone : largeur (colonnes), hauteur (rangées visibles), taille du rem
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const read = (w: number, h: number) => {
      const nextRem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setMetrics((m) =>
        m && Math.abs(m.width - w) < 0.25 && Math.abs(m.height - h) < 8 && m.rem === nextRem ? m : { width: w, height: h, rem: nextRem },
      );
    };
    read(el.clientWidth, el.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box) read(box.width, box.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // applique le défilement calculé, puis anime : le contenu part de la transformation qui
  // laisse le jeu repère là où il était, et revient à zéro sur un ressort
  const seq = placed?.seq ?? 0;
  useLayoutEffect(() => {
    const el = scroller.current;
    const node = content.current;
    if (!el || !node || !placed) return;
    anchorRef.current = -1;
    if (Math.abs(el.scrollTop - placed.scrollTop) > 0.5) {
      jumpRef.current = true;
      el.scrollTop = placed.scrollTop;
    }
    scrollTopRef.current = el.scrollTop;
    if (placed.refocus && focusId !== null) {
      const card = node.querySelector<HTMLElement>(`[data-focus-id="game:${CSS.escape(focusId)}"]`);
      if (card && document.activeElement !== card) card.focus({ preventScroll: true });
    }
    const f = placed.flip;
    if (!f || reduced) return;
    originRef.current = { x: f.originX, y: f.originY };
    node.style.transformOrigin = `${f.originX}px ${f.originY}px`;
    node.style.willChange = "transform";
    x.jump(f.x);
    y.jump(f.y);
    scale.jump(f.scale);
    void animate(x, 0, SPRING.smooth);
    void animate(y, 0, SPRING.smooth);
    const run = animate(scale, 1, SPRING.smooth);
    void run.then(() => {
      // une animation plus récente a pu reprendre la main
      if (scale.get() === 1) node.style.willChange = "";
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  // ——— Navigation au clavier et à la manette, par index ———
  const pendingFocus = useRef<string | null>(null);
  const focusGame = (index: number) => {
    const game = games[index];
    if (!game) return;
    pendingFocus.current = game.id;
    setFocusId(game.id);
  };

  useLayoutEffect(() => {
    const id = pendingFocus.current;
    const el = scroller.current;
    if (!id || id !== focusId || !layout || !el) return;
    pendingFocus.current = null;
    const index = indexOf.get(id);
    const card = content.current?.querySelector<HTMLElement>(`[data-focus-id="game:${CSS.escape(id)}"]`);
    if (index === undefined || !card) return;
    input.focus(card, { sound: true });
    label.current?.focus(games[index]);
    // la rangée entière (titre compris), avec la place de l'anneau de focus
    const row = Math.floor(index / layout.cols);
    const margin = Math.max(14, layout.metaH ? 0 : layout.cellW * 0.28);
    const target = row === 0 ? 0 : row === layout.rows - 1 ? maxScroll(layout, viewH) : revealScroll(layout, index, el.scrollTop, viewH, margin);
    const far = Math.abs(target - el.scrollTop) > viewH * 2.5;
    el.scrollTo({ top: target, behavior: reduced || far ? "instant" : "smooth" });
  });

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!layout || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-focus-id]")?.dataset.focusId;
    const index = id?.startsWith("game:") ? indexOf.get(id.slice(5)) : undefined;
    if (index === undefined) return;
    let next: number | null;
    switch (e.key) {
      case "ArrowLeft": next = moveIndex(index, "left", layout.cols, layout.count); break;
      case "ArrowRight": next = moveIndex(index, "right", layout.cols, layout.count); break;
      case "ArrowUp": next = moveIndex(index, "up", layout.cols, layout.count); break;
      case "ArrowDown": next = moveIndex(index, "down", layout.cols, layout.count); break;
      case "PageUp": next = pageIndex(layout, index, -1, viewH); break;
      case "PageDown": next = pageIndex(layout, index, 1, viewH); break;
      case "Home": next = 0; break;
      case "End": next = layout.count - 1; break;
      default: return;
    }
    e.preventDefault();
    document.documentElement.dataset.input = "keyboard";
    if (next === null) {
      // première rangée, vers le haut : on sort de la grille vers la barre d'outils. La recherche
      // ignore les jaquettes : dans une rangée de formats mélangés, une voisine plus basse passait
      // pour « au-dessus » et retenait le focus.
      const card = (e.target as HTMLElement).closest<HTMLElement>("[data-focus-id]");
      const outside = input.focusables().filter((el) => !e.currentTarget.contains(el));
      const rect = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      };
      const pick = card ? pickNext(rect(card), outside.map(rect), "up") : -1;
      if (pick >= 0) input.focus(outside[pick], { sound: true });
      return;
    }
    if (next !== index) focusGame(next);
  };

  // ——— Titre du jeu sélectionné ou survolé, quand les jaquettes n'ont plus le leur ———
  const label = useRef<LabelApi>(null);
  const gameOf = (target: EventTarget) => {
    const id = (target as HTMLElement).closest<HTMLElement>("[data-focus-id]")?.dataset.focusId;
    const index = id?.startsWith("game:") ? indexOf.get(id.slice(5)) : undefined;
    return index === undefined ? null : games[index];
  };
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const game = gameOf(e.target);
    if (!game) return;
    setFocusId(game.id);
    label.current?.focus(game);
  };
  const onPointerOver = (e: ReactPointerEvent<HTMLDivElement>) => label.current?.hover(gameOf(e.target));

  // ——— Commandes du recul ———
  const stepRef = useRef({ level, onStep, layout, indexOf, viewH });
  stepRef.current = { level, onStep, layout, indexOf, viewH };

  // vignettes : ce qu'on regarde d'abord, la marge montée autour ensuite
  useEffect(() => {
    setThumbRank((game) => {
      const s = stepRef.current;
      const index = s.indexOf.get(game.id);
      if (!s.layout || index === undefined) return Infinity;
      const row = Math.floor(index / s.layout.cols);
      return Math.abs(s.layout.rowTop[row] + s.layout.rowH[row] / 2 - (scrollTopRef.current + s.viewH / 2));
    });
    return () => setThumbRank(null);
  }, []);

  // Ctrl + molette : autour du jeu pointé
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let sum = 0;
    let lastAt = 0;
    let steppedAt = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const now = performance.now();
      if (now - lastAt > 350) sum = 0;
      lastAt = now;
      sum += e.deltaY;
      if (Math.abs(sum) < 50 || now - steppedAt < 140) return;
      const delta = sum > 0 ? 1 : -1;
      sum = 0;
      steppedAt = now;
      const s = stepRef.current;
      if (!s.layout || stepZoom(s.level, delta) === s.level) return;
      const box = el.getBoundingClientRect();
      anchorRef.current = indexAt(s.layout, e.clientX - box.left, e.clientY - box.top + el.scrollTop);
      s.onStep(delta);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // touches − et + (avec ou sans Ctrl), Ctrl + 0 : niveau d'origine
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.metaKey || !input.isMainRoot()) return;
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (typing && !e.ctrlKey) return;
      const delta = e.key === "-" ? 1 : e.key === "+" || e.key === "=" ? -1 : e.ctrlKey && e.key === "0" ? -MAX_ZOOM : 0;
      if (!delta) return;
      e.preventDefault();
      stepRef.current.onStep(delta);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // manette : stick droit poussé à gauche (reculer) ou à droite (avancer), un cran par poussée
  useEffect(() => {
    let armed = true;
    let lastAt = 0;
    const onAnalog = (e: Event) => {
      if (!input.isMainRoot()) return;
      const { x: sx, y: sy } = (e as CustomEvent<{ x: number; y: number }>).detail;
      const now = performance.now();
      // le stick est revenu au centre (plus d'événement, ou presque plus de poussée)
      if (now - lastAt > 180 || Math.abs(sx) < 0.35) armed = true;
      lastAt = now;
      // geste horizontal : la page ne défile pas en même temps
      if (Math.abs(sx) > Math.abs(sy)) e.preventDefault();
      if (!armed || Math.abs(sx) < 0.8 || Math.abs(sx) < Math.abs(sy) * 1.5) return;
      armed = false;
      stepRef.current.onStep(sx < 0 ? 1 : -1);
    };
    window.addEventListener("ibox:analog", onAnalog);
    return () => window.removeEventListener("ibox:analog", onAnalog);
  }, []);

  // ——— Jaquettes ———
  const detail = layout?.detail ?? "full";
  // niveau d'origine : jaquettes complètes, comme avant ; niveaux reculés : vignettes à la taille affichée
  const thumb = layout && layout.level > 0 ? thumbWidth(layout.cellW, typeof devicePixelRatio === "number" ? devicePixelRatio : 1) : 0;

  // niveau d'origine : les jaquettes des rangées suivantes se préparent avant d'entrer à l'écran
  useEffect(() => {
    if (!layout || layout.level > 0 || last < first) return;
    const [, ahead] = rowRange(layout, winTop, winTop + viewH + Math.max(1400, viewH * 3));
    const to = Math.min(layout.count, (ahead + 1) * layout.cols);
    for (let i = (last + 1) * layout.cols; i < to; i++) void getArtUrl(games[i], "front").catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, first, last]);

  // l'animation d'entrée ne vaut que pour les cartes présentes à l'arrivée, pas pour celles
  // qui apparaissent ensuite en faisant défiler
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(true), 500);
    return () => window.clearTimeout(id);
  }, []);

  const dense = detail === "cover" || detail === "bare";
  // favoris des jeux de démonstration (ceux des vrais jeux sont dans le jeu lui-même) : lus une
  // fois ici, pas dans chaque tuile
  const demoFavorites = useSettings((s) => s.favorites);
  const cells: ReactNode[] = [];
  if (layout) {
    const cell = (i: number) => {
      const r = coverRect(layout, i);
      const game = games[i];
      if (dense) {
        return <CoverTile key={game.id} game={game} left={r.x} top={r.y} width={r.w} thumb={thumb} favorite={isFavorite(game, demoFavorites)} bare={detail === "bare"} autoFocus={i === 0} />;
      }
      return (
        <div key={game.id} className="absolute" style={{ left: r.x, top: r.y, width: r.w }}>
          <GameCard game={game} compact={detail === "title"} thumb={thumb} autoFocus={i === 0} enter={!settled} />
        </div>
      );
    };
    const from = first * layout.cols;
    const to = Math.min(layout.count, (last + 1) * layout.cols);
    for (let i = from; i < to; i++) cells.push(cell(i));
    if (focusIndex >= 0 && (focusIndex < from || focusIndex >= to)) cells.push(cell(focusIndex));
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={TWEEN.fast}
      className="absolute inset-0"
    >
      <div ref={scroller} data-cover-scroll-root onScroll={handleScroll} className="absolute inset-0 overflow-x-hidden overflow-y-auto">
        <motion.div
          ref={content}
          data-nav-group="library-grid"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0 } } }}
          onKeyDown={onKeyDown}
          onFocusCapture={onFocus}
          onPointerOver={onPointerOver}
          onPointerLeave={() => label.current?.hover(null)}
          className="relative"
          style={{ height: layout?.height, x, y, scale }}
        >
          {cells}
        </motion.div>
      </div>
      <FocusLabel ref={label} enabled={dense} />
    </motion.div>
  );
}

interface LabelApi {
  focus: (game: Game | null) => void;
  hover: (game: Game | null) => void;
}

/**
 * Pastille du bas de la grille reculée : le titre du jeu survolé, ou de celui que le
 * clavier ou la manette a sélectionné. À part, pour ne pas redessiner la grille à chaque
 * jaquette survolée.
 */
function FocusLabel({ ref, enabled }: { ref: Ref<LabelApi>; enabled: boolean }) {
  const [focused, setFocused] = useState<Game | null>(null);
  const [hovered, setHovered] = useState<Game | null>(null);
  useImperativeHandle(ref, () => ({ focus: setFocused, hover: setHovered }), []);
  const keyboard = typeof document !== "undefined" && document.documentElement.dataset.input === "keyboard";
  const game = enabled ? (hovered ?? (keyboard ? focused : null)) : null;
  return (
    <AnimatePresence>
      {game && (
        <motion.div
          key="label"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={TWEEN.fast}
          className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-6"
        >
          <div className="flex max-w-full items-center gap-2.5 rounded-full bg-ink/90 py-1.5 pr-4 pl-4 text-cream shadow-md">
            <span data-no-i18n className="truncate font-display text-[0.95rem] font-semibold">{game.title}</span>
            <span data-no-i18n className="shrink-0 text-[0.78rem] font-bold opacity-70">
              {[requirePlatform(game.platformId).shortName, game.year].filter(Boolean).join(" · ")}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Contrôle du recul dans la barre de la bibliothèque : « − » recule (plus de jeux à l'écran),
 * « + » avance, et cinq points rappellent le niveau courant.
 */
export function CoverZoomControl({ level, onStep }: { level: number; onStep: (delta: number) => void }) {
  // au bout de la course, le bouton reste focalisable (sinon la manette perdrait sa place) : il s'éteint seulement
  const side = "ibox-btn ibox-focusable grid size-9 place-items-center rounded-full text-ink-soft transition-colors duration-200 [--ring-radius:999px] hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] hover:text-ink aria-disabled:opacity-35 aria-disabled:hover:bg-transparent aria-disabled:hover:text-ink-soft";
  const far = level >= MAX_ZOOM;
  const near = level <= 0;
  return (
    <div
      role="group"
      aria-label="Recul de la grille"
      className="inline-flex shrink-0 items-center rounded-full bg-white/80 p-1 shadow-xs ring-1 ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]"
    >
      <button type="button" data-focusable aria-disabled={far} aria-label="Reculer : voir plus de jeux" title="Reculer : voir plus de jeux (Ctrl + molette)" onClick={() => !far && onStep(1)} className={side}>
        <Icon name="minus" size="1.1em" />
      </button>
      <span aria-hidden className="flex items-center gap-[0.3rem] px-1.5">
        {Array.from({ length: MAX_ZOOM + 1 }, (_, i) => {
          // de gauche à droite : du plus reculé au niveau d'origine, comme « − » et « + »
          const active = MAX_ZOOM - i === level;
          return (
            <motion.span
              key={i}
              initial={false}
              animate={{ width: active ? "0.95rem" : "0.36rem", opacity: active ? 1 : 0.3 }}
              transition={SPRING.snappy}
              className={`h-[0.36rem] rounded-full ${active ? "bg-[var(--accent-deep)]" : "bg-ink"}`}
            />
          );
        })}
      </span>
      <button type="button" data-focusable aria-disabled={near} aria-label="Avancer : jaquettes plus grandes" title="Avancer : jaquettes plus grandes (Ctrl + molette)" onClick={() => !near && onStep(-1)} className={side}>
        <Icon name="plus" size="1.1em" />
      </button>
    </div>
  );
}
