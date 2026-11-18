import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import type { Game } from "@/domain/types";
import type { ManualInfo } from "@/services/manuals";
import { pageRatios, renderPage } from "@/services/manualPdf";
import { input } from "@/input/InputController";
import { sound } from "@/services/sound";
import { useReducedMotion } from "@/app/shellState";
import { Icon } from "@/components/ui/Icon";
import { buildFaces, spreadOf, type Face } from "./faces";
import "./manual.css";

const FLIP_MS = 820;
const FLIP_EASE = "cubic-bezier(.42,.0,.18,1)";

/**
 * Lecteur du manuel : un carnet à feuilleter en double page.
 * Clic sur une page, ← →, molette, gâchettes ou vignettes pour tourner ;
 * double-clic ou Entrée pour lire une page en grand ; Échap pour refermer.
 */
export function ManualReader({ game, manual, onClose, onManage }: { game: Game; manual: ManualInfo; onClose: () => void; onManage?: () => void }) {
  const reduced = useReducedMotion();
  const [faces, setFaces] = useState<Face[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [cur, setCur] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [moving, setMoving] = useState<Set<number>>(new Set());
  const target = useRef(0);
  const stepTimer = useRef<number | undefined>(undefined);
  const bookRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const zoomRef = useRef<number | null>(null);
  zoomRef.current = zoom;
  const stamp = manual.addedAt;
  const N = faces ? Math.ceil(faces.length / 2) : 0;

  // Pages et proportions
  useEffect(() => {
    let alive = true;
    pageRatios(manual.gameId, stamp)
      .then((r) => alive && setFaces(buildFaces(r)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [manual.gameId, stamp]);

  // Taille des pages d'après la fenêtre
  useEffect(() => {
    if (!faces?.length) return;
    const ratio = faces[0].ratio;
    const fit = () => {
      // en-tête (~110 px) et commandes + vignettes (~230 px) toujours visibles
      const availW = Math.max(320, window.innerWidth - 160);
      const availH = Math.max(240, window.innerHeight - 350);
      const h = Math.min(availH, availW / 2 / ratio);
      setSize({ w: Math.round(h * ratio), h: Math.round(h) });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [faces]);

  // Ouverture : son, focus, retour ; puis la couverture s'ouvre sur la première double page
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    sound.play("bookOpen");
    // Retour : quitte d'abord la page agrandie, puis referme le carnet
    const off = input.onBack(() => {
      if (zoomRef.current !== null) {
        setZoom(null);
        sound.play("back");
        return "quiet";
      }
      sound.play("bookClose");
      closeRef.current();
      return "quiet";
    });
    const id = requestAnimationFrame(() => bookRef.current?.focus({ preventScroll: true }));
    return () => {
      off();
      cancelAnimationFrame(id);
      window.clearTimeout(stepTimer.current);
      if (previous?.isConnected) requestAnimationFrame(() => previous.focus({ preventScroll: true }));
    };
  }, []);

  const go = useCallback(
    (to: number) => {
      if (!N) return;
      target.current = Math.max(0, Math.min(N, to));
      window.clearTimeout(stepTimer.current);
      // plusieurs feuilles : tournées l'une après l'autre, en cascade
      const step = () => {
        setCur((c) => {
          if (c === target.current) return c;
          const dir = Math.sign(target.current - c);
          const leaf = dir > 0 ? c : c - 1;
          setMoving((m) => new Set(m).add(leaf));
          window.setTimeout(() => setMoving((m) => {
            const n = new Set(m);
            n.delete(leaf);
            return n;
          }), FLIP_MS);
          sound.play("page");
          const next = c + dir;
          if (next !== target.current) stepTimer.current = window.setTimeout(step, reduced ? 0 : Math.abs(target.current - next) > 4 ? 60 : 120);
          return next;
        });
      };
      step();
    },
    [N, reduced],
  );

  // Le carnet s'ouvre fermé, sur sa couverture : un clic (ou →) l'ouvre.

  const close = () => {
    sound.play("bookClose");
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Échap traité ici aussi : le carnet garde le focus pendant l'agrandissement
    if (e.key === "Escape") {
      if (zoom !== null) {
        setZoom(null);
        sound.play("back");
      } else close();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (zoom !== null) {
      if (e.key === "ArrowRight" || e.key === "PageDown") setZoom((z) => Math.min((faces?.length ?? 1) - 1, (z ?? 0) + 1));
      else if (e.key === "ArrowLeft" || e.key === "PageUp") setZoom((z) => Math.max(0, (z ?? 0) - 1));
      else if (e.key === "Enter" || e.key === " ") setZoom(null);
      else return;
    } else if (e.key === "ArrowRight" || e.key === "PageDown") go(target.current + 1);
    else if (e.key === "ArrowLeft" || e.key === "PageUp") go(target.current - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(N);
    else if (e.key === "Enter" || e.key === " ") setZoom(Math.max(0, Math.min((faces?.length ?? 1) - 1, cur * 2)));
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const wheelLock = useRef(0);
  const onWheel = (e: React.WheelEvent) => {
    if (zoom !== null || Date.now() < wheelLock.current || Math.abs(e.deltaY) < 4) return;
    wheelLock.current = Date.now() + 380;
    go(target.current + (e.deltaY > 0 ? 1 : -1));
  };

  const [left, right] = spreadOf(cur);
  const shift = cur === 0 ? -size.w / 2 : cur === N ? size.w / 2 : 0;
  const pageInfo = !faces ? "" : cur === 0 ? "Couverture" : cur === N && faces.length % 2 === 0 ? "Dos" : `Pages ${left + 1}–${Math.min(right + 1, faces.length)} sur ${faces.length}`;

  return createPortal(
    <motion.div
      data-nav-root
      role="dialog"
      aria-modal="true"
      aria-label={`Manuel de ${game.title}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.35 }}
      className="fixed inset-0 z-[90] flex flex-col items-center"
      style={{ background: "radial-gradient(ellipse at 50% 40%, rgba(24,26,36,0.86), rgba(6,7,10,0.94))", backdropFilter: "blur(12px)", color: "#ECEEF4" }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onWheel={onWheel}
    >
      {/* en-tête */}
      <div className="flex w-full max-w-[1400px] items-center gap-4 px-8 pt-6 pb-2">
        <div className="min-w-0 flex-1">
          <p className="text-[0.78rem] font-bold tracking-[0.12em] uppercase" style={{ color: "rgba(236,238,244,0.55)" }}>
            Manuel
          </p>
          <h2 data-no-i18n className="truncate text-[1.35rem] font-semibold">
            {game.title}
          </h2>
        </div>
        {onManage && (
          <ReaderButton label="Options du manuel" onClick={onManage}>
            <Icon name="gear" />
          </ReaderButton>
        )}
        <ReaderButton label="Fermer" onClick={close}>
          <Icon name="plus" className="rotate-45" />
        </ReaderButton>
      </div>

      {/* carnet */}
      <div
        ref={bookRef}
        tabIndex={0}
        data-focusable
        data-autofocus
        data-nav-capture="xy"
        aria-label="Pages du manuel. Flèches gauche et droite pour tourner, Entrée pour agrandir."
        onKeyDown={onKeyDown}
        className="relative flex min-h-0 flex-1 items-center justify-center outline-none"
        style={{ perspective: 2800 }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        {failed ? (
          <div className="max-w-md rounded-xl px-8 py-6 text-center" style={{ background: "rgba(255,255,255,0.06)" }}>
            <p className="text-[1.05rem] font-semibold">Ce manuel ne peut pas être affiché.</p>
            <p className="mt-2 text-[0.9rem]" style={{ color: "rgba(236,238,244,0.65)" }}>
              Le fichier PDF semble abîmé. Vous pouvez le remplacer depuis le bouton « Manuel » de la fiche du jeu.
            </p>
          </div>
        ) : !faces || !size.w ? (
          <BookSkeleton />
        ) : (
          <motion.div
            initial={reduced ? false : { scale: 0.62, y: 50, rotateX: 12, opacity: 0 }}
            animate={{ scale: 1, y: 0, rotateX: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 140, damping: 20 }}
            style={{ transformStyle: "preserve-3d" }}
          >
            <div
              className="relative"
              style={{
                width: size.w * 2,
                height: size.h,
                transformStyle: "preserve-3d",
                transform: `translateX(${shift}px)`,
                transition: reduced ? undefined : "transform 0.8s cubic-bezier(.3,.1,.2,1)",
              }}
            >
              <PageEdges side="left" count={cur} total={N} visible={cur > 0} />
              <PageEdges side="right" count={N - cur} total={N} visible={cur < N} />
              {Array.from({ length: N }, (_, i) => {
                const flipped = i < cur;
                // feuilles autour de la double page (y compris pendant une cascade de pages)
                const near = i >= cur - 3 && i <= cur + 2;
                if (!near && !moving.has(i)) return null;
                return (
                  <div
                    key={i}
                    className="absolute top-0 cursor-pointer"
                    onClick={() => go(flipped ? i : i + 1)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setZoom(flipped ? 2 * i + 1 : 2 * i);
                    }}
                    style={{
                      left: "50%",
                      width: "50%",
                      height: "100%",
                      transformOrigin: "left center",
                      transformStyle: "preserve-3d",
                      transform: flipped ? "rotateY(-180deg)" : "rotateY(0deg)",
                      transition: reduced ? undefined : `transform ${FLIP_MS}ms ${FLIP_EASE}`,
                      willChange: "transform",
                      zIndex: moving.has(i) ? 100 : flipped ? i + 1 : N - i,
                    }}
                  >
                    <PageFace face={faces[2 * i]} side="front" game={manual.gameId} stamp={stamp} width={size.w} live={near} turning={moving.has(i)} cover={i === 0} />
                    <PageFace face={faces[2 * i + 1]} side="back" game={manual.gameId} stamp={stamp} width={size.w} live={near} turning={moving.has(i)} cover={i === N - 1} />
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </div>

      {/* commandes */}
      {faces && !failed && (
        <div className="flex w-full flex-col items-center gap-3 px-4 pt-2 pb-5">
          <div className="flex items-center gap-3">
            <ReaderButton label="Page précédente" onClick={() => go(target.current - 1)} disabled={cur === 0}>
              <Icon name="chevronLeft" />
            </ReaderButton>
            <span className="min-w-[11rem] text-center text-[0.9rem] font-semibold tabular-nums" style={{ color: "rgba(236,238,244,0.7)" }}>
              {pageInfo}
            </span>
            <ReaderButton label="Page suivante" onClick={() => go(target.current + 1)} disabled={cur === N}>
              <Icon name="chevronRight" />
            </ReaderButton>
            <ReaderButton label="Agrandir la page" onClick={() => setZoom(Math.max(0, Math.min(faces.length - 1, cur * 2 - (cur === N ? 1 : 0))))}>
              <Icon name="search" />
            </ReaderButton>
          </div>
          <Thumbnails faces={faces} game={manual.gameId} stamp={stamp} current={[left, right]} onPick={(p) => go(Math.ceil(p / 2))} />
          <p className="text-[0.78rem]" style={{ color: "rgba(236,238,244,0.45)" }}>
            Clic ou ← → pour tourner les pages · double-clic ou Entrée pour agrandir · Échap pour refermer
          </p>
        </div>
      )}

      {zoom !== null && faces && (
        <ZoomView face={faces[zoom]} index={zoom} total={faces.length} game={manual.gameId} stamp={stamp} onClose={() => setZoom(null)} onMove={(d) => setZoom((z) => Math.max(0, Math.min(faces.length - 1, (z ?? 0) + d)))} />
      )}
    </motion.div>,
    document.body,
  );
}

function ReaderButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      data-focusable
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => {
        sound.play("toggle");
        onClick();
      }}
      className="ibox-focusable grid h-11 w-11 place-items-center rounded-full transition-colors [--ring-radius:999px] disabled:opacity-30"
      style={{ background: "rgba(255,255,255,0.08)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)", color: "#ECEEF4" }}
    >
      {children}
    </button>
  );
}

/** Image d'une page (ou d'une moitié de double page), rendue à la demande. */
function usePageImage(game: number, stamp: string, face: Face | undefined, width: number, live: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const px = Math.round(width * dpr * (face?.half ? 2 : 1));
  useEffect(() => {
    if (!face || face.blank || !live || !px) return;
    let alive = true;
    renderPage(game, stamp, face.page, px)
      .then((r) => alive && setUrl(r.url))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [game, stamp, face, px, live]);
  return url;
}

function faceStyle(face: Face, url: string | null): CSSProperties {
  if (!url) return {};
  return face.half
    ? { backgroundImage: `url(${url})`, backgroundSize: "200% 100%", backgroundPosition: face.half === "left" ? "left center" : "right center" }
    : { backgroundImage: `url(${url})`, backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat" };
}

function PageFace({
  face,
  side,
  game,
  stamp,
  width,
  live,
  turning,
  cover,
}: {
  face: Face | undefined;
  side: "front" | "back";
  game: number;
  stamp: string;
  width: number;
  live: boolean;
  turning: boolean;
  cover: boolean;
}) {
  const url = usePageImage(game, stamp, face, width, live);
  // ombre de reliure côté dos, reflet léger côté tranche
  const shade =
    side === "front"
      ? "linear-gradient(90deg, rgba(0,0,0,0.24), rgba(0,0,0,0.05) 5%, transparent 13%, transparent 93%, rgba(255,255,255,0.05))"
      : "linear-gradient(270deg, rgba(0,0,0,0.24), rgba(0,0,0,0.05) 5%, transparent 13%, transparent 93%, rgba(255,255,255,0.04))";
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        backfaceVisibility: "hidden",
        transform: side === "back" ? "rotateY(180deg)" : undefined,
        background: "#f3eee2",
        boxShadow: "0 22px 50px rgba(0,0,0,0.45)",
        borderRadius: side === "front" ? "0 6px 6px 0" : "6px 0 0 6px",
      }}
    >
      {face && <div className="absolute inset-0" style={faceStyle(face, url)} />}
      {face && !face.blank && !url && <div className="ibox-page-loading absolute inset-0" />}
      <div className="pointer-events-none absolute inset-0" style={{ background: cover ? shade.replace(/0\.24/g, "0.32") : shade }} />
      {/* ombre qui suit la page pendant qu'elle se soulève */}
      {turning && <div className={`pointer-events-none absolute inset-0 ${side === "front" ? "ibox-turn-front" : "ibox-turn-back"}`} style={{ animationDuration: `${FLIP_MS}ms` }} />}
    </div>
  );
}

/** Tranches de feuilles empilées : le carnet a de l'épaisseur. */
function PageEdges({ side, count, total, visible }: { side: "left" | "right"; count: number; total: number; visible: boolean }) {
  const depth = visible ? Math.max(2, Math.min(9, Math.round((count / Math.max(1, total)) * 9))) : 0;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-[3px] bottom-[3px]"
      style={{
        [side]: -depth,
        width: depth,
        borderRadius: side === "left" ? "4px 0 0 4px" : "0 4px 4px 0",
        background: `repeating-linear-gradient(${side === "left" ? 90 : 270}deg, #e9e2d2 0 1px, #cfc6b3 1px 2px)`,
        boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
        transition: "width .4s, left .4s, right .4s",
      }}
    />
  );
}

function BookSkeleton() {
  return (
    <div className="flex gap-0.5" aria-label="Ouverture du manuel">
      <div className="ibox-page-loading h-[52vh] w-[37vh] rounded-md" style={{ background: "#2a2c36" }} />
    </div>
  );
}

function Thumbnails({ faces, game, stamp, current, onPick }: { faces: Face[]; game: number; stamp: string; current: [number, number]; onPick: (p: number) => void }) {
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>(`[data-thumb="${Math.max(0, current[1])}"]`) ?? strip.current?.querySelector<HTMLElement>(`[data-thumb="${current[0]}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [current]);
  return (
    <div ref={strip} className="flex max-w-[min(92vw,1100px)] gap-1.5 overflow-x-auto px-2 py-1.5 [scrollbar-width:thin]">
      {faces.map((f, i) => (
        <Thumb key={i} face={f} index={i} game={game} stamp={stamp} on={i === current[0] || i === current[1]} onPick={onPick} />
      ))}
    </div>
  );
}

function Thumb({ face, index, game, stamp, on, onPick }: { face: Face; index: number; game: number; stamp: string; on: boolean; onPick: (p: number) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const url = usePageImage(game, stamp, face, 46, seen);
  return (
    <button
      ref={ref}
      data-thumb={index}
      aria-label={`Page ${index + 1}`}
      tabIndex={-1}
      onClick={() => {
        sound.play("move");
        onPick(index);
      }}
      className="relative h-[62px] shrink-0 overflow-hidden rounded-[3px] transition-[opacity,transform] duration-200"
      style={{ width: Math.round(62 * face.ratio), background: "#3a3c47", opacity: on ? 1 : 0.5, transform: on ? "translateY(-3px)" : undefined, boxShadow: on ? "0 0 0 2px rgba(255,255,255,0.75)" : undefined }}
    >
      <div className="absolute inset-0" style={faceStyle(face, url)} />
    </button>
  );
}

/** Une page en grand, à parcourir (glisser, molette). */
function ZoomView({ face, index, total, game, stamp, onClose, onMove }: { face: Face; index: number; total: number; game: number; stamp: string; onClose: () => void; onMove: (d: -1 | 1) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const width = Math.min(1400, window.innerWidth - 80);
  const url = usePageImage(game, stamp, face, width, true);
  const drag = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);

  useEffect(() => {
    box.current?.scrollTo({ top: 0 });
  }, [index]);

  // manette : stick droit pour parcourir la page
  useEffect(() => {
    const onAnalog = (e: Event) => {
      const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail;
      box.current?.scrollBy({ left: x * 24, top: y * 24 });
      e.preventDefault();
    };
    window.addEventListener("ibox:analog", onAnalog);
    return () => window.removeEventListener("ibox:analog", onAnalog);
  }, []);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = box.current;
    if (!el) return;
    drag.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !box.current) return;
    box.current.scrollLeft = d.sl - (e.clientX - d.x);
    box.current.scrollTop = d.st - (e.clientY - d.y);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[95] flex flex-col"
      style={{ background: "rgba(6,7,10,0.96)" }}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-3 px-8 pt-5 pb-3">
        <span className="flex-1 text-[0.9rem] font-semibold tabular-nums" style={{ color: "rgba(236,238,244,0.7)" }}>
          {`Page ${index + 1} sur ${total}`}
        </span>
        <ReaderButton label="Page précédente" onClick={() => onMove(-1)} disabled={index === 0}>
          <Icon name="chevronLeft" />
        </ReaderButton>
        <ReaderButton label="Page suivante" onClick={() => onMove(1)} disabled={index === total - 1}>
          <Icon name="chevronRight" />
        </ReaderButton>
        <ReaderButton label="Revenir au carnet" onClick={onClose}>
          <Icon name="plus" className="rotate-45" />
        </ReaderButton>
      </div>
      <div
        ref={box}
        className="min-h-0 flex-1 cursor-grab overflow-auto active:cursor-grabbing"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={onClose}
      >
        <div className="mx-auto my-4" style={{ width, aspectRatio: String(face.ratio), background: "#f3eee2", boxShadow: "0 20px 60px rgba(0,0,0,0.5)", ...faceStyle(face, url) }}>
          {!url && <div className="ibox-page-loading h-full w-full" />}
        </div>
      </div>
    </motion.div>
  );
}
