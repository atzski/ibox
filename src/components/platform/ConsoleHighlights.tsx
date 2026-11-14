import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Game, Platform } from "@/domain/types";
import { CoverImage } from "@/components/game/CoverImage";
import { Icon, type IconName } from "@/components/ui/Icon";
import { isFavorite } from "@/services/library";
import { useSettings } from "@/services/settings";
import { useNav } from "@/app/navigation";
import { sound } from "@/services/sound";
import { input } from "@/input/InputController";
import { useReducedMotion } from "@/app/shellState";
import { focusAmbientGame } from "@/app/shellState";

const PER_GROUP = 6;

/** Compact shortcuts: one floating tray at a time, without moving the library. */
export function ConsoleHighlights({ platform, games }: { platform: Platform; games: Game[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const panelId = useId();
  const reduced = useReducedMotion();
  useEffect(() => { setOpen(null); }, [platform.id]);
  useEffect(() => {
    if (!open) return;
    const off = input.onBack(() => {
      setOpen(null);
      triggers.current.get(open)?.focus({ preventScroll: true });
      return true;
    });
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("pointerdown", outside);
    return () => { off(); window.removeEventListener("pointerdown", outside); };
  }, [open]);
  const favorites = useSettings((s) => s.favorites);
  const groups = useMemo(() => {
    const mine = games.filter((g) => g.platformId === platform.id);
    const played = mine
      .filter((g) => g.lastPlayedAt)
      .sort((a, b) => (b.lastPlayedAt! > a.lastPlayedAt! ? 1 : -1))
      .slice(0, PER_GROUP);
    const favs = mine.filter((g) => isFavorite(g, favorites)).slice(0, PER_GROUP);
    const added = [...mine].sort((a, b) => (b.addedAt > a.addedAt ? 1 : -1)).slice(0, PER_GROUP);
    return [
      { id: "played", label: "Récemment joués", icon: "clock" as IconName, list: played },
      { id: "favs", label: "Favoris", icon: "star" as IconName, list: favs },
      { id: "added", label: "Ajoutés récemment", icon: "plus" as IconName, list: added },
    ].filter((g) => g.list.length > 0);
  }, [games, platform.id, favorites]);

  const active = groups.find((g) => g.id === open);
  if (!groups.length) return null;
  return (
    <div
      ref={root}
      className="relative z-20 mt-3 shrink-0"
      data-nav-group="console-highlights"
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) setOpen(null);
      }}
    >
      <div className="flex flex-wrap gap-2" aria-label="Raccourcis de la bibliothèque">
        {groups.map((g) => (
          <button
            key={g.id}
            ref={(el) => { if (el) triggers.current.set(g.id, el); else triggers.current.delete(g.id); }}
            id={`${panelId}-${g.id}`}
            data-focusable
            aria-expanded={open === g.id}
            aria-controls={active ? `${panelId}-panel` : undefined}
            onClick={() => {
              sound.play(open === g.id ? "close" : "open");
              setOpen(open === g.id ? null : g.id);
            }}
            className={`ibox-focusable inline-flex h-10 items-center gap-2 rounded-full px-4 text-[0.82rem] font-bold shadow-xs transition-colors duration-200 [--ring-radius:999px] ${open === g.id ? "bg-[var(--accent-deep)] text-on-accent" : "bg-white/70 text-ink-soft hover:bg-white hover:text-ink"}`}
          >
            <Icon name={g.icon} size="1.05em" />
            {g.label}
            <motion.span animate={{ rotate: open === g.id ? -90 : 90 }} transition={{ duration: reduced ? 0 : 0.2 }}>
              <Icon name="chevronRight" size="0.9em" />
            </motion.span>
          </button>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {active && (
          <motion.section
            key={active.id}
            id={`${panelId}-panel`}
            aria-labelledby={`${panelId}-${active.id}`}
            initial={{ opacity: 0, y: reduced ? 0 : -8, scale: reduced ? 1 : 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduced ? 0 : -4, transition: { duration: reduced ? 0 : 0.12 } }}
            transition={{ duration: reduced ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="absolute top-full left-0 mt-2 w-max max-w-full origin-top-left rounded-xl bg-white p-3 shadow-lg"
          >
            <div className="flex gap-3 overflow-x-auto p-2">
              {active.list.map((game) => <MiniCover key={game.id} game={game} />)}
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

function MiniCover({ game }: { game: Game }) {
  const go = useNav((s) => s.go);
  return (
    <button
      data-focusable
      onClick={() => {
        sound.play("select");
        go({ name: "game", gameId: game.id });
      }}
      onFocus={() => focusAmbientGame(game)}
      onPointerEnter={() => focusAmbientGame(game)}
      title={game.title}
      aria-label={game.title}
      className="ibox-focusable ibox-lift w-[4.2rem] shrink-0 [--ring-radius:var(--radius-sm)]"
    >
      <CoverImage game={game} rounded="rounded-[0.45rem]" sheen={false} />
    </button>
  );
}
