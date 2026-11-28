import { SPRING } from "@/motion/tokens";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { motion } from "motion/react";
import type { Game, Platform } from "@/domain/types";
import { requirePlatform } from "@/domain/platforms";
import { relativeDay } from "@/domain/text";
import { drawPath, pickDraw } from "@/domain/draw";
import { flatGrid, flatMove } from "@/domain/flatGrid";
import { DRAW_EVENT, drawPending, takeDraw } from "@/app/draw";
import { focusAmbientGame, useScreenActive } from "@/app/shellState";
import { CoverImage } from "@/components/game/CoverImage";
import { usePlayState } from "@/components/library/PlayControls";
import { Icon, type IconName } from "@/components/ui/Icon";
import { input } from "@/input/InputController";
import { isFavorite, useLibrary } from "@/services/library";
import { useLauncher } from "@/services/launcher";
import { isInstalled } from "@/services/pc";
import { useSettings } from "@/services/settings";
import { sound } from "@/services/sound";

/**
 * Étagère sans 3D (docs/ANDROID.md §9, « Mode sans 3D ») : la même bibliothèque en grille de
 * jaquettes, quand WebGL manque, que son contexte est perdu, que l'appareil est trop modeste
 * (palier `minimal`) ou que l'utilisateur l'a choisi (Paramètres › Apparence › Performances).
 * Montée à la place de l'étagère 3D par `three/lazy.tsx`, avec les mêmes propriétés : la
 * bibliothèque, la recherche et les collections n'ont rien à savoir.
 *
 * Mêmes fonctions que l'étagère : une rangée par console (onglets en haut, ↑ / ↓ au bord de la
 * grille pour en changer), Entrée ou toucher pour ouvrir la fiche, X pour jouer, F pour le favori,
 * R pour un jeu au hasard (la sélection défile jusqu'à lui, comme sur l'étagère), recherche par la
 * barre de la bibliothèque. Manette, clavier, souris et toucher.
 *
 * Fait pour les petites machines : seules les rangées visibles (et une marge) sont montées, les
 * jaquettes sont des vignettes à la taille de la case (`art/thumbs.ts`), aucune ombre ni flou, et
 * rien ne bouge au repos.
 */

interface Shelf {
  id: string;
  platform: Platform;
  games: Game[];
}

/** Une rangée par console (la plus fournie d'abord) ; pendant une recherche, une seule rangée. */
function buildShelves(games: Game[], mixed: boolean): Shelf[] {
  if (mixed && games.length > 0) return [{ id: "search", platform: requirePlatform(games[0].platformId), games }];
  const map = new Map<string, Game[]>();
  for (const g of games) {
    const list = map.get(g.platformId);
    if (list) list.push(g);
    else map.set(g.platformId, [g]);
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length).map(([id, list]) => ({ id, platform: requirePlatform(id), games: list }));
}

/** Rangées montées au-delà de la zone visible, de chaque côté. */
const OVERSCAN = 2;
const SETTLE_MS = 300;

export function FlatShelf({
  games,
  returnGameId,
  reduced,
  onOpen,
  mixed = false,
}: {
  games: Game[];
  mixed?: boolean;
  returnGameId?: string;
  reduced: boolean;
  dark?: boolean;
  onOpen: (game: Game) => void;
}) {
  const shelves = useMemo(() => buildShelves(games, mixed), [games, mixed]);
  const active = useScreenActive();
  const favorites = useSettings((s) => s.favorites);
  const start = useMemo(() => {
    for (let r = 0; r < shelves.length; r++) {
      const i = shelves[r].games.findIndex((g) => g.id === returnGameId);
      if (i >= 0) return { row: r, index: i };
    }
    return { row: 0, index: 0 };
    // seulement au montage : le retour d'une fiche repart du jeu quitté
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [shelfIndex, setShelfIndex] = useState(start.row);
  const [picks, setPicks] = useState<Record<string, number>>(() => (shelves[start.row] ? { [shelves[start.row].id]: start.index } : {}));
  const [drawing, setDrawing] = useState(false);
  const timers = useRef<number[]>([]);
  /** Dernier appui au doigt (un toucher ouvre la fiche d'un coup). */
  const touch = useRef(false);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

  useEffect(() => {
    if (shelfIndex > shelves.length - 1) setShelfIndex(Math.max(0, shelves.length - 1));
  }, [shelves.length, shelfIndex]);

  const shelf = shelves[Math.min(shelfIndex, shelves.length - 1)];
  const index = shelf ? Math.min(picks[shelf.id] ?? 0, shelf.games.length - 1) : 0;
  const sel = shelf?.games[index];
  const playState = usePlayState(sel ?? games[0]);
  const aspect = useMemo(() => (shelf ? Math.min(...shelf.games.map((g) => requirePlatform(g.platformId).layout.coverAspect)) : 0.7), [shelf]);

  // ——— mesure et fenêtre visible ———
  const scroller = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0, rem: 16 });
  const [scrollTop, setScrollTop] = useState(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight, rem: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const grid = box.width > 0 && shelf ? flatGrid(box.width, box.rem, shelf.games.length, aspect, box.height) : null;
  const rowH = grid ? grid.cellH + grid.gap : 1;
  // place du cadre de sélection au-dessus de la première rangée (cadre de 3 px à 3 px du bord et
  // agrandissement de 4 % vers le haut), au-delà du `pt-3` de la grille : sans elle, le défilement
  // le coupait en haut
  const lift = grid ? 6 + Math.ceil(grid.cellH * 0.04) : 0;

  // la sélection reste visible (défilement doux, sauf mouvement réduit ou tirage rapide)
  useEffect(() => {
    const el = scroller.current;
    if (!el || !grid) return;
    const top = Math.floor(index / grid.cols) * rowH;
    const margin = grid.gap * 2;
    let target: number | null = null;
    if (top < el.scrollTop + margin) target = Math.max(0, top - margin);
    else if (top + grid.cellH > el.scrollTop + el.clientHeight - margin) target = top + grid.cellH - el.clientHeight + margin;
    if (target !== null) el.scrollTo({ top: target, behavior: reduced ? "auto" : "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, shelfIndex, grid?.cols, grid?.cellH]);
  // nouvelle console : on repart du haut de sa grille
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [shelfIndex]);

  // fond d'écran aux couleurs du jeu choisi, une fois la sélection posée
  useEffect(() => {
    if (!active || !sel || drawing) return;
    const t = window.setTimeout(() => focusAmbientGame(sel), SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [sel, active, drawing]);

  // ——— actions ———
  const select = (i: number) => {
    if (!shelf || drawing) return;
    const next = Math.max(0, Math.min(shelf.games.length - 1, i));
    if (next === index) return;
    sound.play("move");
    setPicks((p) => ({ ...p, [shelf.id]: next }));
  };

  const changeShelf = (r: number) => {
    if (drawing) return false;
    const next = Math.max(0, Math.min(shelves.length - 1, r));
    if (next === shelfIndex) return false;
    sound.play("tab");
    setShelfIndex(next);
    return true;
  };

  const open = (g: Game | undefined) => {
    if (!g || drawing) return;
    sound.play("select");
    onOpen(g);
  };

  const quickPlay = () => {
    if (drawing || !sel || playState.reason || sel.dbId === undefined) return sound.play("error");
    sound.play("select");
    void useLauncher.getState().play(sel.dbId, sel.title);
  };

  const favorite = () => {
    if (!sel) return;
    sound.play(isFavorite(sel, favorites) ? "unfavorite" : "favorite");
    void useLibrary.getState().toggleFavorite(sel);
  };

  /** « Au hasard » : comme sur l'étagère, la sélection défile jusqu'au jeu tiré en ralentissant. */
  const draw = () => {
    if (drawing || !shelf) return;
    const target = pickDraw(shelves.map((s) => s.games), { row: shelfIndex, index }, (g) => !g.missing && (g.platformId !== "pc" || g.isDemo || isInstalled(g)));
    if (!target) return sound.play("error");
    const row = shelves[target.row];
    if (reduced) {
      sound.play("confirm");
      setShelfIndex(target.row);
      setPicks((p) => ({ ...p, [row.id]: target.index }));
      return;
    }
    setDrawing(true);
    let from = index;
    if (target.row !== shelfIndex) {
      from = Math.max(0, Math.min(row.games.length - 1, target.index + (target.index > row.games.length / 2 ? -14 : 14)));
      setPicks((p) => ({ ...p, [row.id]: from }));
      setShelfIndex(target.row);
      sound.play("tab");
    }
    let wait = target.row !== shelfIndex ? 300 : 0;
    for (const step of drawPath(from, target.index, row.games.length)) {
      wait += step.delay;
      later(() => {
        sound.play("move");
        setPicks((p) => ({ ...p, [row.id]: step.index }));
      }, wait);
    }
    later(() => {
      sound.play("confirm");
      setDrawing(false);
    }, wait + 240);
  };
  // demande venue d'ailleurs (accueil, menu rapide, recherche universelle)
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    if (!active) return;
    const run = () => drawRef.current();
    const waiting = drawPending() ? window.setTimeout(() => takeDraw() && run(), reduced ? 0 : 400) : undefined;
    window.addEventListener(DRAW_EVENT, run);
    return () => {
      window.clearTimeout(waiting);
      window.removeEventListener(DRAW_EVENT, run);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!shelf || !grid || e.ctrlKey || e.altKey || e.metaKey) return;
    const k = e.key;
    if (k === "Enter" || k === " ") open(sel);
    else if (k === "x" || k === "X") quickPlay();
    else if (k === "f" || k === "F") favorite();
    else if (k === "r" || k === "R") draw();
    else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(k)) {
      const pageRows = Math.max(1, Math.floor((box.height || rowH) / rowH));
      const next = flatMove(index, k, grid.cols, shelf.games.length, pageRows);
      if (next === null) {
        // bord de la grille : console précédente ou suivante, sinon on sort (barre d'outils)
        const dir = k === "ArrowUp" ? -1 : 1;
        if (!changeShelf(shelfIndex + dir)) input.move(dir < 0 ? "up" : "down");
      } else select(next);
    } else return;
    e.preventDefault();
  };

  if (!shelf || !sel) return null;
  const platform = mixed ? requirePlatform(sel.platformId) : shelf.platform;
  const tint = platform.theme.primary;
  const meta = [sel.year, sel.genre, sel.publisher].filter(Boolean).join(" · ");

  // rangées montées : celles à l'écran, plus une marge, et toujours celle de la sélection
  const cells: number[] = [];
  if (grid) {
    const first = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN);
    const last = Math.min(grid.rows - 1, Math.ceil((scrollTop + box.height) / rowH) + OVERSCAN);
    for (let i = first * grid.cols; i < Math.min(shelf.games.length, (last + 1) * grid.cols); i++) cells.push(i);
    if (!cells.includes(index)) cells.push(index);
  }
  const thumb = grid ? Math.round(grid.cellW * Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1)) : 0;

  return (
    <div
      className="ibox-flat-shelf absolute inset-0 flex flex-col overflow-hidden rounded-xl text-[#f3f5fb]"
      style={{ background: `radial-gradient(120% 80% at 50% 0%, ${tint}33, transparent 60%), #0b0d16` }}
    >
      {/* en-tête : consoles et position, comme sur l'étagère */}
      <div className="flex shrink-0 items-center justify-end gap-3 px-5 pt-3 pb-2">
        {shelves.length > 1 && (
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-full border border-[rgba(255,255,255,.16)] bg-[rgba(8,10,20,.6)] p-1">
            {shelves.map((s, si) => (
              <button
                key={s.id}
                tabIndex={-1}
                onClick={() => changeShelf(si)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[0.76rem] font-semibold ${si === shelfIndex ? "bg-[#ebebf0] text-[#10121a]" : "text-[rgba(243,245,251,.62)] hover:text-[#f3f5fb]"}`}
              >
                {s.platform.shortName}
              </button>
            ))}
          </div>
        )}
        <div className="text-[0.85rem] font-medium tracking-[0.06em] text-[rgba(243,245,251,.62)] tabular-nums">
          <b className="font-bold text-[#f3f5fb]">{index + 1}</b> / {shelf.games.length}
        </div>
      </div>

      {/* grille : un seul élément focalisable, la sélection se conduit par index */}
      <div
        ref={scroller}
        data-focusable
        data-nav-capture="xy"
        data-autofocus
        data-focus-id="shelf"
        data-cover-scroll-root
        tabIndex={0}
        role="listbox"
        aria-label="Jaquettes. Flèches pour parcourir, Entrée pour ouvrir, X pour jouer, R pour un jeu au hasard."
        aria-activedescendant={`flat-${sel.id}`}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => (touch.current = e.pointerType === "touch")}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="ibox-focusable relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-5 pt-3 pb-4 outline-none [--ring-radius:var(--radius-xl)]"
      >
        {grid && (
          <div className="relative" style={{ height: grid.rows * rowH, marginTop: Math.max(0, lift - 0.75 * box.rem) }}>
            {cells.map((i) => {
              const g = shelf.games[i];
              const on = i === index;
              const col = i % grid.cols;
              const row = Math.floor(i / grid.cols);
              return (
                <div
                  key={g.id}
                  id={on ? `flat-${g.id}` : undefined}
                  role="option"
                  aria-selected={on}
                  aria-label={g.title}
                  onClick={() => {
                    if (on) open(g);
                    else if (!drawing) {
                      setPicks((p) => ({ ...p, [shelf.id]: i }));
                      // toucher : un seul geste ouvre la fiche ; souris : le premier clic choisit
                      if (touch.current) open(g);
                      else sound.play("move");
                    }
                  }}
                  className="absolute flex cursor-pointer items-end justify-center"
                  style={{ left: col * (grid.cellW + grid.gap), top: row * rowH, width: grid.cellW, height: grid.cellH }}
                >
                  <div
                    className="relative w-full rounded-md transition-transform duration-200"
                    style={{
                      transform: on ? "scale(1.04)" : "none",
                      transformOrigin: "50% 100%",
                      outline: on ? `3px solid ${on ? "#ebebf0" : "transparent"}` : "none",
                      outlineOffset: 3,
                      borderRadius: 8,
                    }}
                  >
                    <CoverImage game={g} thumb={thumb} sheen={false} className={g.missing ? "opacity-50 grayscale" : ""} />
                    {isFavorite(g, favorites) && (
                      <span className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-[rgba(8,10,20,.7)] text-[var(--tone-yellow-ink,#f5c84c)]">
                        <Icon name="star" size="0.8rem" filled />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* jeu choisi et actions, sous la grille comme sous l'étagère */}
      <div className="ibox-shelf-caption flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[rgba(255,255,255,.08)] bg-[rgba(8,10,20,.55)] px-5 py-3">
        <motion.div key={sel.id} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={SPRING.smooth} className="min-w-0 flex-1">
          <div className="truncate text-[1.15rem] leading-tight font-semibold">{sel.title}</div>
          <div className="mt-0.5 truncate text-[0.85rem] font-medium text-[rgba(243,245,251,.62)]">
            {meta || platform.name}
            {sel.lastPlayedAt && <span> · joué {relativeDay(sel.lastPlayedAt)}</span>}
          </div>
        </motion.div>
        <div className="ibox-shelf-actions flex items-center gap-2">
          <FlatAction icon="play" label="Jouer" primary disabled={!!playState.reason || sel.dbId === undefined} title={playState.reason ?? undefined} onClick={quickPlay} />
          <FlatAction icon="open" label="Fiche" onClick={() => open(sel)} />
          {games.length > 1 && <FlatAction icon="dice" label="Au hasard" title="Laisser iBox choisir un jeu (R)" disabled={drawing} onClick={draw} />}
        </div>
      </div>
    </div>
  );
}

function FlatAction({ icon, label, onClick, primary, disabled, title }: { icon: IconName; label: string; onClick: () => void; primary?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button
      // manette : bas depuis l'étagère mène à ces boutons (« Au hasard » n'a pas de bouton à lui)
      data-focusable
      tabIndex={-1}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`ibox-focusable [--ring-radius:999px] flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-[0.86rem] font-semibold active:scale-95 disabled:opacity-40 ${
        primary ? "bg-[#ebebf0] text-[#10121a] hover:bg-[#ffffff]" : "border border-[rgba(255,255,255,.16)] bg-[rgba(8,10,20,.6)] text-[#f3f5fb] hover:bg-[rgba(255,255,255,.16)]"
      }`}
    >
      <Icon name={icon} size="1.05em" filled={icon === "play"} />
      {label}
    </button>
  );
}
