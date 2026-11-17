import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { relativeDay } from "@/domain/text";
import { linkOf, useNotifications, useUnreadCount } from "@/services/notifications";
import { openLink } from "@/services/links";
import { useUpdater } from "@/services/updater";
import { input } from "@/input/InputController";
import { sound } from "@/services/sound";

/** Cloche des notifications : pastille du nombre non lu, panneau déroulant. */
export function NotificationsButton() {
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const items = useNotifications((s) => s.items);
  const markAllRead = useNotifications((s) => s.markAllRead);
  const clear = useNotifications((s) => s.clear);
  const box = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    // la manette retrouve la cloche à la fermeture
    requestAnimationFrame(() => bell.current && input.focus(bell.current, { instant: true }));
  };

  // Ouvert, le panneau devient la zone de navigation (manette, clavier) : le focus y entre
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const first = panel.current?.querySelector<HTMLElement>("[data-focusable]");
      if (first) input.focus(first, { instant: true });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const off = input.onBack(() => {
      close();
      return true;
    });
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    // lues dès l'ouverture
    const t = setTimeout(markAllRead, 600);
    return () => {
      off();
      window.removeEventListener("pointerdown", onDown);
      clearTimeout(t);
    };
  }, [open, markAllRead]);

  return (
    <div ref={box} className="relative">
      <button
        ref={bell}
        data-focusable
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} non lue${unread > 1 ? "s" : ""}` : "Notifications"}
        onClick={() => {
          sound.play(open ? "close" : "open");
          setOpen((v) => !v);
        }}
        className="ibox-focusable ibox-lift relative grid h-12 w-12 place-items-center rounded-full ibox-chip tone-yellow [--ring-radius:999px]"
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[#EE8F80] px-1 text-[0.68rem] font-extrabold text-white shadow-xs">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            ref={panel}
            role="dialog"
            aria-label="Notifications"
            className="absolute top-[3.6rem] right-0 z-50 w-[24rem] origin-top-right overflow-hidden rounded-xl bg-white/95 shadow-lg backdrop-blur-md"
            data-nav-root
            data-nav-group="notifications"
          >
            <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
              <span className="font-display text-[1.05rem] font-semibold text-ink">Notifications</span>
              {items.length > 0 && (
                <button data-focusable onClick={clear} className="ibox-focusable rounded-full px-2.5 py-1 text-[0.78rem] font-bold text-ink-soft [--ring-radius:999px]">
                  Tout effacer
                </button>
              )}
            </div>
            <div className="max-h-[24rem] overflow-y-auto px-2 pb-2">
              {items.length === 0 && (
                <p data-focusable tabIndex={0} className="ibox-focusable rounded-lg px-3 py-6 text-center text-[0.88rem] font-semibold text-ink-soft outline-none">
                  Rien de nouveau pour l'instant.
                </p>
              )}
              {items.map((n) => {
                const link = linkOf(n);
                const activate = () => {
                  useNotifications.getState().markRead(n.id);
                  if (!link) return;
                  sound.play("select");
                  close();
                  openLink(link);
                };
                return (
                <div
                  key={n.id}
                  data-focusable
                  tabIndex={0}
                  role="button"
                  aria-label={`${n.title}${n.body ? `. ${n.body}` : ""}`}
                  onClick={activate}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); }
                    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); useNotifications.getState().remove(n.id); }
                  }}
                  className={`ibox-focusable group relative flex gap-3 rounded-lg px-3 py-2.5 outline-none ${link ? "cursor-pointer hover:bg-black/[0.035]" : ""} ${n.read ? "" : "bg-[var(--ibox-sky)]/25"}`}
                >
                  {n.image ? (
                    <img src={n.image} alt="" className="mt-0.5 size-9 shrink-0 rounded-lg shadow-xs ring-1 ring-black/5" />
                  ) : (
                  <span
                    className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${n.tone === "warn" ? "bg-[#FFE1DA] text-[#C4624F]" : n.tone === "ok" ? "bg-[#DDF6EA] text-[#3C8E69]" : "bg-[#E4F3FF] text-[#2F7FB0]"}`}
                  >
                    <Icon name={n.icon} size="1em" />
                  </span>
                  )}
                  <div className="min-w-0 flex-1 pr-5">
                    <div className="text-[0.88rem] font-bold text-ink">{n.title}</div>
                    {n.body && <div className="text-[0.8rem] font-semibold text-ink-soft">{n.body}</div>}
                    <div className="mt-0.5 flex items-center gap-1.5 text-[0.7rem] font-semibold text-ink-faint">
                      {relativeDay(n.at)}
                      {link && <span className="inline-flex items-center gap-0.5 font-extrabold text-[#2F7FB0]">· {LINK_LABEL[link.kind]} <Icon name="chevronRight" size="0.9em" /></span>}
                    </div>
                  </div>
                  <button
                    aria-label="Retirer cette notification"
                    tabIndex={-1}
                    onClick={(event) => { event.stopPropagation(); sound.play("back"); useNotifications.getState().remove(n.id); }}
                    className="absolute top-2 right-2 grid size-6 place-items-center rounded-full text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100 hover:bg-black/5"
                  >
                    <Icon name="x" size="0.8em" />
                  </button>
                </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const LINK_LABEL: Record<NonNullable<ReturnType<typeof linkOf>>["kind"], string> = {
  game: "Voir le jeu",
  library: "Voir la bibliothèque",
  settings: "Ouvrir les réglages",
  duplicates: "Regrouper",
  update: "Installer",
  achievements: "Voir les succès",
  friends: "Ouvrir Amis",
  community: "Voir la publication",
};

/** Pastille « Mettre à jour » dans la barre du haut, tant qu'une version attend. */
export function UpdateChip() {
  const available = useUpdater((s) => s.available);
  const installing = useUpdater((s) => s.installing);
  const progress = useUpdater((s) => s.progress);
  if (!available) return null;
  const percent = progress?.stage === "downloading" && progress.total ? Math.floor((progress.received * 100) / progress.total) : undefined;
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      data-focusable
      disabled={installing}
      title={`iBox ${available} : cliquez pour installer`}
      onClick={() => { sound.play("open"); openLink({ kind: "update" }); }}
      className="ibox-focusable ibox-lift relative flex h-12 items-center gap-2 rounded-full bg-[linear-gradient(140deg,#DDF0FF,#88CBF5)] px-4 font-bold text-[#1F5C8F] shadow-sm [--ring-radius:999px]"
    >
      <Icon name="download" className={installing ? "animate-bounce" : ""} />
      {installing ? (percent !== undefined ? `${percent} %` : "Installation…") : `iBox ${available}`}
      {!installing && <span className="absolute -top-0.5 -right-0.5 size-3 animate-ping rounded-full bg-[#EE8F80]" />}
    </motion.button>
  );
}

function BellIcon() {
  return (
    <svg width="1.3em" height="1.3em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}
