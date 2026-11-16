import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Avatar } from "@/components/profile/Avatar";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useLibrary } from "@/services/library";
import { getArtUrl } from "@/art/covers";
import { getPlatform } from "@/domain/platforms";
import { sound } from "@/services/sound";
import type { ToastPayload } from "@/services/social";

const DURATION = { game: 6500, request: 9000, message: 7500, invite: 9000, update: 14000, notice: 8000 } as const;
const LOOK: Record<ToastPayload["kind"], { label: string; icon: IconName; from: string; to: string; ink: string }> = {
  update: { label: "Mise à jour disponible", icon: "download", from: "#DDF0FF", to: "#88CBF5", ink: "#2C6FA8" },
  game: { label: "En jeu", icon: "play", from: "#DDF6EA", to: "#98DEBE", ink: "#2F7A57" },
  request: { label: "Demande d'ami", icon: "user", from: "#FFE1DA", to: "#F3AFA4", ink: "#B4513F" },
  message: { label: "Message", icon: "sparkle", from: "#DDF0FF", to: "#88CBF5", ink: "#2C6FA8" },
  invite: { label: "Invitation à jouer", icon: "gamepad", from: "#E4D9FB", to: "#B5A0E9", ink: "#6A4FB3" },
  notice: { label: "iBox", icon: "sparkle", from: "#FFF1C9", to: "#FFD27A", ink: "#A86A12" },
};
const NOTICE_TONE = {
  info: { from: "#DDF0FF", to: "#88CBF5", ink: "#2C6FA8" },
  ok: { from: "#DDF6EA", to: "#98DEBE", ink: "#2F7A57" },
  warn: { from: "#FFE1DA", to: "#F3AFA4", ink: "#B4513F" },
} as const;

/** Jaquette du jeu s'il est dans la bibliothèque de l'utilisateur. */
function useCover(title?: string, platformId?: string, gameId?: string) {
  const games = useLibrary((s) => s.realGames);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    setUrl(undefined);
    if (!title && !gameId) return;
    const t = title?.toLowerCase();
    const game = gameId
      ? games.find((g) => g.id === gameId || g.variants?.some((v) => v.id === gameId))
      : games.find((g) => g.title.toLowerCase() === t && (!platformId || g.platformId === platformId)) ?? games.find((g) => g.title.toLowerCase() === t);
    if (!game) return;
    let live = true;
    getArtUrl(game, "front").then((u) => live && setUrl(u)).catch(() => undefined);
    return () => { live = false; };
  }, [games, title, platformId, gameId]);
  return url;
}

/** Fenêtre « toast » : une carte iBox à la fois, en bas à droite de l'écran. */
export function ToastWindow() {
  const [queue, setQueue] = useState<(ToastPayload & { key: number })[]>([]);
  const counter = useRef(0);
  const current = queue[0];

  const pull = useCallback(async () => {
    const items = await invoke<ToastPayload[]>("toast_pull").catch(() => []);
    if (items.length) setQueue((q) => [...q, ...items.map((p) => ({ ...p, key: ++counter.current }))]);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("ibox-toast-window");
    void useLibrary.getState().reload().catch(() => undefined);
    void pull();
    const un = listen("toast-push", () => void pull());
    const onVisible = () => document.visibilityState === "visible" && void pull();
    document.addEventListener("visibilitychange", onVisible);
    return () => { void un.then((f) => f()); document.removeEventListener("visibilitychange", onVisible); };
  }, [pull]);

  const next = useCallback(() => setQueue((q) => q.slice(1)), []);

  return (
    <div className="fixed inset-0 flex items-end justify-end p-2">
      <AnimatePresence onExitComplete={() => queue.length === 0 && void invoke("toast_done")}>
        {current && <Toast key={current.key} toast={current} onDone={next} />}
      </AnimatePresence>
    </div>
  );
}

function Toast({ toast, onDone }: { toast: ToastPayload; onDone: () => void }) {
  const look = toast.kind === "notice"
    ? { ...LOOK.notice, ...(toast.tone ? NOTICE_TONE[toast.tone] : {}), icon: toast.icon ?? LOOK.notice.icon, label: toast.link?.kind === "achievements" ? "Succès" : "iBox" }
    : LOOK[toast.kind];
  const linkedGame = toast.link && "gameId" in toast.link ? toast.link.gameId : undefined;
  const cover = useCover(toast.kind === "game" || toast.kind === "invite" ? toast.gameTitle : undefined, toast.platformId, linkedGame);
  const [paused, setPaused] = useState(false);
  const duration = DURATION[toast.kind];
  const left = useRef(duration);
  const platform = toast.platformId ? getPlatform(toast.platformId)?.shortName : undefined;

  useEffect(() => { sound.play("open"); }, []);
  useEffect(() => {
    if (paused) return;
    const start = performance.now();
    const t = window.setTimeout(onDone, left.current);
    return () => { window.clearTimeout(t); left.current -= performance.now() - start; };
  }, [paused, onDone]);

  const click = (accept?: boolean) => {
    void invoke("toast_click", { payload: { ...toast, accept } });
    onDone();
  };

  const line =
    toast.kind === "game" ? <>lance <b className="text-ink">{toast.gameTitle}</b></>
    : toast.kind === "invite" && toast.remotePlay ? <>{toast.mode === "play" ? "vous invite à jouer sur son PC (Remote Play)." : "vous invite à regarder son écran (Remote Play)."} Cliquez pour répondre.</>
    : toast.kind === "invite" ? <>vous invite à <b className="text-ink">{toast.gameTitle}</b></>
    : toast.kind === "request" ? <>vous a ajouté en ami. Cliquez pour accepter.</>
    : toast.kind === "notice" || toast.kind === "update" ? <>{toast.body}</>
    : <span className="italic">« {toast.body} »</span>;

  return (
    <motion.div
      role="status"
      initial={{ x: 420, opacity: 0, scale: 0.96 }}
      animate={{ x: 0, opacity: 1, scale: 1 }}
      exit={{ x: 420, opacity: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onClick={() => click(toast.kind === "request")}
      className="group relative flex h-[7.25rem] w-[24rem] cursor-pointer items-center gap-3.5 overflow-hidden rounded-[1.6rem] bg-white/95 p-3 pr-4 shadow-[0_14px_34px_-14px_rgba(30,40,70,0.55)] ring-1 ring-black/5"
    >
      {/* halo pastel du type de notification */}
      <span aria-hidden className="pointer-events-none absolute -top-10 -left-10 size-40 rounded-full opacity-60 blur-2xl" style={{ background: `radial-gradient(circle, ${look.to}, transparent 70%)` }} />
      <span className="relative shrink-0">
        {toast.kind === "notice" && toast.image ? (
          <span className="relative grid size-[5rem] place-items-center rounded-2xl" style={{ background: `linear-gradient(140deg, #FFF3C4, #FFD36B)` }}>
            <img src={toast.image} alt="" draggable={false} className="ibox-badge-pop size-[4rem] rounded-xl shadow-md ring-2 ring-white" />
          </span>
        ) : cover ? (
          <img src={cover} alt="" draggable={false} className="h-[5.5rem] w-[4.1rem] rounded-xl object-cover shadow-md ring-1 ring-black/5" />
        ) : toast.kind === "notice" || toast.kind === "update" ? (
          <span className="grid size-[5rem] place-items-center rounded-2xl text-white shadow-inner" style={{ background: `linear-gradient(140deg, ${look.from}, ${look.to})`, color: look.ink }}>
            <Icon name={look.icon} size="2.4rem" />
          </span>
        ) : (
          <span className="grid size-[5rem] place-items-center rounded-2xl" style={{ background: `linear-gradient(140deg, ${look.from}, ${look.to})` }}>
            <Avatar size={58} choice={toast.avatar ?? null} name={toast.name} />
          </span>
        )}
        {cover && toast.kind !== "notice" && (
          <span className="absolute -right-2 -bottom-2">
            <Avatar size={32} choice={toast.avatar ?? null} name={toast.name} />
          </span>
        )}
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[0.66rem] font-extrabold tracking-[0.14em] uppercase" style={{ color: look.ink }}>
          <Icon name={look.icon} size="1.05em" filled={look.icon === "play"} />
          {look.label}
          {platform && <span className="ml-1 rounded-full bg-black/5 px-1.5 py-px tracking-normal normal-case text-ink-soft">{platform}</span>}
        </span>
        <span data-no-i18n className="mt-0.5 block truncate font-display text-[1.12rem] font-semibold text-ink">{toast.name}</span>
        <span className="line-clamp-2 text-[0.84rem] leading-snug font-semibold text-ink-soft">{line}</span>
      </span>
      <button
        aria-label="Fermer"
        onClick={(e) => { e.stopPropagation(); onDone(); }}
        className="absolute top-2 right-2 grid size-6 place-items-center rounded-full text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/5"
      >
        <Icon name="x" size="0.8em" />
      </button>
      <motion.span
        aria-hidden
        className="absolute bottom-0 left-0 h-[3px] origin-left"
        style={{ background: `linear-gradient(90deg, ${look.from}, ${look.to})`, width: "100%" }}
        initial={{ scaleX: 1 }}
        animate={{ scaleX: paused ? undefined : 0 }}
        transition={{ duration: duration / 1000, ease: "linear" }}
      />
    </motion.div>
  );
}
