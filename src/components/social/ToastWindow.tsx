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
import { isTauri } from "@/services/native";
import { useIsDark } from "@/app/shellState";
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

/**
 * Fenêtre « toast » : une carte iBox à la fois, en bas à droite de l'écran.
 * `inline` : rendue dans la fenêtre principale (Linux / Steam Deck, une seule fenêtre).
 */
export function ToastWindow({ inline = false }: { inline?: boolean }) {
  const [queue, setQueue] = useState<(ToastPayload & { key: number })[]>([]);
  const counter = useRef(0);
  const current = queue[0];

  const pull = useCallback(async () => {
    const items = await invoke<ToastPayload[]>("toast_pull").catch(() => []);
    if (items.length) setQueue((q) => [...q, ...items.map((p) => ({ ...p, key: ++counter.current }))]);
  }, []);

  // même thème que la fenêtre principale (réglages partagés)
  const dark = useIsDark();
  useEffect(() => {
    if (!inline) document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark, inline]);

  useEffect(() => {
    // aperçu navigateur (simulation Steam Deck) : aucune notification native à écouter
    if (!isTauri()) return;
    if (!inline) {
      document.documentElement.classList.add("ibox-toast-window");
      void useLibrary.getState().reload().catch(() => undefined);
    }
    void pull();
    const un = listen("toast-push", () => void pull());
    const onVisible = () => document.visibilityState === "visible" && void pull();
    document.addEventListener("visibilitychange", onVisible);
    return () => { void un.then((f) => f()); document.removeEventListener("visibilitychange", onVisible); };
  }, [pull, inline]);

  const next = useCallback(() => setQueue((q) => q.slice(1)), []);

  return (
    <div className={inline ? "pointer-events-none fixed right-5 bottom-5 z-[90] flex items-end justify-end [&>*]:pointer-events-auto" : "fixed inset-0 flex items-end justify-end px-5 pt-3 pb-5"}>
      <AnimatePresence onExitComplete={() => !inline && queue.length === 0 && void invoke("toast_done")}>
        {current && <Toast key={current.key} toast={current} dark={dark} onDone={next} />}
      </AnimatePresence>
    </div>
  );
}

function Toast({ toast, dark, onDone }: { toast: ToastPayload; dark: boolean; onDone: () => void }) {
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

  // en sombre, l'encre foncée du type devient sa teinte claire (contraste)
  const ink = dark ? look.to : look.ink;

  return (
    <motion.div
      role="status"
      initial={{ x: 60, y: 8, opacity: 0, scale: 0.94 }}
      animate={{ x: 0, y: 0, opacity: 1, scale: 1 }}
      exit={{ x: 70, opacity: 0, scale: 0.96, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      whileHover={{ y: -2 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onClick={() => click(toast.kind === "request")}
      // liseré dégradé aux couleurs du type, ombre douce en deux couches (rien de rogné)
      className="group relative w-[24rem] cursor-pointer rounded-[1.45rem] p-[1.5px] shadow-[0_18px_38px_-20px_rgba(20,30,60,0.6),0_4px_12px_-6px_rgba(20,30,60,0.22)]"
      style={{ background: `linear-gradient(135deg, ${look.to}, color-mix(in srgb, ${look.from} 40%, transparent) 45%, color-mix(in srgb, ${look.to} 55%, transparent))` }}
    >
      <div
        className="relative flex min-h-[6.6rem] items-center gap-3.5 overflow-hidden rounded-[calc(1.45rem-1.5px)] p-3 pr-5 pb-4"
        style={{ background: `color-mix(in srgb, var(--ibox-white) 95%, ${look.to})` }}
      >
      {/* halo pastel du type de notification */}
      <span aria-hidden className="pointer-events-none absolute -top-14 -left-12 size-44 rounded-full opacity-50 blur-2xl" style={{ background: `radial-gradient(circle, ${look.to}, transparent 70%)` }} />
      <span className="relative shrink-0">
        {toast.kind === "notice" && toast.image ? (
          <span className="relative grid size-[5rem] place-items-center rounded-2xl" style={{ background: `linear-gradient(140deg, #FFF3C4, #FFD36B)` }}>
            <img src={toast.image} alt="" draggable={false} className="ibox-badge-pop size-[4rem] rounded-xl shadow-md ring-2 ring-white" />
          </span>
        ) : cover ? (
          <img src={cover} alt="" draggable={false} className="h-[5.5rem] w-[4.1rem] rounded-xl object-cover shadow-md ring-1 ring-black/5" />
        ) : toast.kind === "notice" || toast.kind === "update" ? (
          // pastille d'icône : dégradé, reflet en haut et petit rebord, comme les boutons iBox
          <span
            className="relative grid size-[4.4rem] place-items-center overflow-hidden rounded-[1.15rem] shadow-[inset_0_-3px_0_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.7),0_8px_18px_-10px_rgba(20,30,60,0.5)]"
            style={{ background: `linear-gradient(150deg, ${look.from}, ${look.to})`, color: look.ink }}
          >
            <span aria-hidden className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/45 to-transparent" />
            <motion.span
              className="relative"
              initial={{ y: -6, opacity: 0 }}
              animate={toast.kind === "update" ? { y: [0, 3, 0], opacity: 1 } : { y: 0, opacity: 1 }}
              transition={toast.kind === "update" ? { y: { duration: 1.6, repeat: Infinity, ease: "easeInOut", delay: 0.4 }, opacity: { duration: 0.3 } } : { type: "spring", stiffness: 300, damping: 18 }}
            >
              <Icon name={look.icon} size="2.1rem" />
            </motion.span>
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
        <span className="flex items-center gap-1.5 text-[0.66rem] font-extrabold tracking-[0.14em] uppercase" style={{ color: ink }}>
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: `color-mix(in srgb, ${look.to} ${dark ? 18 : 30}%, transparent)` }}>
            <Icon name={look.icon} size="1.05em" filled={look.icon === "play"} />
            {look.label}
          </span>
          {platform && <span className="rounded-full bg-[var(--ibox-ink)]/5 px-1.5 py-px tracking-normal normal-case text-ink-soft">{platform}</span>}
        </span>
        <span data-no-i18n className="mt-1 block truncate font-display text-[1.15rem] leading-tight font-semibold text-ink">{toast.name}</span>
        <span className="mt-0.5 line-clamp-2 text-[0.82rem] leading-snug font-semibold text-ink-soft">{line}</span>
      </span>
      <button
        aria-label="Fermer"
        onClick={(e) => { e.stopPropagation(); onDone(); }}
        className="absolute top-2.5 right-2.5 grid size-6 place-items-center rounded-full text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--ibox-ink)]/8"
      >
        <Icon name="x" size="0.8em" />
      </button>
      {/* temps restant : fine jauge arrondie, à l'intérieur de la carte */}
      <span aria-hidden className="absolute inset-x-5 bottom-2 h-[3px] overflow-hidden rounded-full bg-[var(--ibox-ink)]/8">
        <motion.span
          className="block h-full origin-left rounded-full"
          style={{ background: `linear-gradient(90deg, ${look.to}, ${ink})` }}
          initial={{ scaleX: 1 }}
          animate={{ scaleX: paused ? undefined : 0 }}
          transition={{ duration: duration / 1000, ease: "linear" }}
        />
      </span>
      </div>
    </motion.div>
  );
}
