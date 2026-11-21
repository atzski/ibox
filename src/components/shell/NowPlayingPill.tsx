import { AnimatePresence, motion } from "motion/react";
import { SPRING, TWEEN } from "@/motion/tokens";
import { useReducedMotion } from "@/app/shellState";
import { useNowPlaying } from "@/services/nowPlaying";
import { sound } from "@/services/sound";

/**
 * « En cours » : ce que joue Music in the Box, dans la barre du haut d'iBox. La pochette et
 * le titre ouvrent le panneau ; lecture / pause et titre suivant se font sans l'ouvrir.
 * Absente tant que le plugin n'est pas activé ou qu'aucun titre n'est connu.
 */
export function NowPlayingPill() {
  const enabled = useNowPlaying((s) => s.enabled);
  const now = useNowPlaying((s) => s.state?.now ?? null);
  const control = useNowPlaying((s) => s.control);
  const open = useNowPlaying((s) => s.open);
  const reduced = useReducedMotion();
  const shown = enabled && now;

  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.div
          key="now-playing"
          initial={{ opacity: 0, scale: 0.9, x: 12 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          exit={{ opacity: 0, scale: 0.94, transition: TWEEN.exit }}
          transition={{ ...SPRING.smooth, opacity: TWEEN.fast }}
          role="group"
          aria-label="Musique en cours"
          className="flex h-12 items-center gap-0.5 rounded-full bg-white/60 p-1 pr-1.5 shadow-xs ring-1 ring-black/5 backdrop-blur"
        >
          <button
            data-focusable
            onClick={() => {
              sound.play("open");
              void open();
            }}
            aria-label={`Ouvrir Music in the Box : ${now.title}`}
            title="Ouvrir Music in the Box"
            className="ibox-focusable group flex h-10 min-w-0 items-center gap-2.5 rounded-full pr-2.5 text-left [--ring-radius:999px] hover:bg-white/70"
          >
            <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-cream-deep text-ink-soft ring-1 ring-black/5">
              <AnimatePresence initial={false}>
                {now.artwork ? (
                  <motion.img key={now.artwork} src={now.artwork} alt="" draggable={false} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={TWEEN.base} className="absolute inset-0 size-full object-cover" />
                ) : (
                  <Note key="note" />
                )}
              </AnimatePresence>
              {/* pochette voilée et petites barres : on voit d'un coup d'œil que ça joue */}
              {now.playing && (
                <span aria-hidden className="absolute inset-0 grid place-items-center bg-[rgba(20,24,40,0.38)]">
                  <Bars animated={!reduced} />
                </span>
              )}
            </span>
            {/* titre et artiste viennent du lecteur : jamais traduits */}
            <span data-no-i18n className="hidden min-w-0 max-w-[11rem] leading-tight min-[1180px]:block">
              <span className="block truncate text-[0.86rem] font-bold text-ink">{now.title}</span>
              {now.artist && <span className="block truncate text-[0.72rem] font-semibold text-ink-soft">{now.artist}</span>}
            </span>
          </button>
          <RoundControl
            label={now.playing ? "Pause" : "Lecture"}
            onClick={() => {
              sound.play(now.playing ? "off" : "on");
              void control("toggle");
            }}
          >
            {now.playing ? (
              <>
                <rect x="6.5" y="5.5" width="3.8" height="13" rx="1.3" fill="currentColor" />
                <rect x="13.7" y="5.5" width="3.8" height="13" rx="1.3" fill="currentColor" />
              </>
            ) : (
              <path d="M8.5 5.8v12.4l9.8-6.2z" fill="currentColor" />
            )}
          </RoundControl>
          <RoundControl
            label="Titre suivant"
            onClick={() => {
              sound.play("move");
              void control("next");
            }}
          >
            <path d="M6 6l9 6-9 6z" fill="currentColor" />
            <path d="M18 6v12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </RoundControl>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function RoundControl({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      data-focusable
      aria-label={label}
      title={label}
      onClick={onClick}
      className="ibox-focusable grid size-9 shrink-0 place-items-center rounded-full text-ink transition-[background-color,transform] duration-150 [--ring-radius:999px] hover:bg-white/80 active:scale-90"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

function Note() {
  return (
    <motion.svg initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </motion.svg>
  );
}

/** Trois barres qui battent pendant la lecture (immobiles si les animations sont réduites). */
function Bars({ animated }: { animated: boolean }) {
  return (
    <span className="flex h-3.5 items-end gap-[2px] text-[#ffffff]">
      {[0.55, 1, 0.7].map((h, i) => (
        <motion.span
          key={i}
          className="block w-[3px] origin-bottom rounded-sm bg-current"
          style={{ height: `${h * 100}%` }}
          animate={animated ? { scaleY: [0.4, 1, 0.4] } : { scaleY: 0.8 }}
          transition={animated ? { duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: i * 0.15 } : { duration: 0 }}
        />
      ))}
    </span>
  );
}
