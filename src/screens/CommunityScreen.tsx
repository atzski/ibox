import { SPRING, TWEEN } from "@/motion/tokens";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Comments, ReactionBar } from "@/components/community/Reactions";
import { MentionField, mentionIds, RichText, useKnownPeople, type Picked } from "@/components/community/Mentions";
import { PlayerLink, type PlayerTarget } from "@/components/social/PlayerProfile";
import { takePendingShare } from "@/services/links";
import { useReducedMotion, useScreenChrome } from "@/app/shellState";
import { Avatar } from "@/components/profile/Avatar";
import { Button, Segmented } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { getPlatform } from "@/domain/platforms";
import { relativeDay } from "@/domain/text";
import { captures, community, formatBytes, useCaptureUrl, type LocalCapture, type ReactionKey, type SharedCapture } from "@/services/community";
import { useInetbox } from "@/services/inetbox";
import { isTauri } from "@/services/native";
import { isLinux } from "@/services/platform";
import { sound } from "@/services/sound";
import { useSettings } from "@/services/settings";
import { DEFAULT_KEYS } from "@/services/shortcuts";

type Tab = "feed" | "mine";

/**
 * Hub de la communauté : le fil des captures et clips partagés par vos amis
 * (et les profils publics), et vos propres captures prises en jeu avec leur raccourci (Alt+X par défaut).
 */
export function CommunityScreen() {
  const [tab, setTab] = useState<Tab>("feed");
  const reduced = useReducedMotion();
  useScreenChrome({
    title: "Communauté",
    hints: [
      { keys: ["↑", "↓", "←", "→"], label: "Naviguer" },
      { keys: ["Entrée"], label: "Ouvrir" },
      { keys: ["Pg↑", "Pg↓"], label: "Défiler vite" },
      { keys: ["Échap"], label: "Retour" },
    ],
  });
  return (
    <div className="h-full overflow-y-auto px-[3rem] pb-10">
      <div className="relative mt-2 overflow-hidden rounded-[2rem] p-7 text-white shadow-[0_22px_48px_-26px_rgba(30,40,70,0.6)]" style={{ background: "linear-gradient(120deg, #4A5BEA 0%, #8A4FE0 55%, #E8509A 100%)" }}>
        <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(rgba(255,255,255,0.9)_1.5px,transparent_2px)] [background-size:26px_26px]" />
        {/* halos qui dérivent lentement : le bandeau respire */}
        {!reduced && (
          <>
            <motion.div aria-hidden className="pointer-events-none absolute -top-24 -left-16 size-72 rounded-full bg-[#7FD3FF]/40 blur-3xl"
              animate={{ x: [0, 60, 0], y: [0, 30, 0] }} transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }} />
            <motion.div aria-hidden className="pointer-events-none absolute -right-10 -bottom-28 size-80 rounded-full bg-[#FFC36B]/35 blur-3xl"
              animate={{ x: [0, -50, 0], y: [0, -24, 0] }} transition={{ duration: 17, repeat: Infinity, ease: "easeInOut" }} />
            {["🎮", "✨", "📸", "🏆"].map((e, i) => (
              <motion.span key={e} aria-hidden className="pointer-events-none absolute text-[1.6rem] opacity-70"
                style={{ right: `${8 + i * 9}%`, top: `${14 + (i % 2) * 38}%` }}
                animate={{ y: [0, -10, 0], rotate: [0, i % 2 ? 8 : -8, 0] }} transition={{ duration: 4 + i, repeat: Infinity, ease: "easeInOut", delay: i * 0.6 }}>
                {e}
              </motion.span>
            ))}
          </>
        )}
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="text-[0.75rem] font-extrabold tracking-[0.18em] text-white/75 uppercase">Hub de la communauté</div>
            <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={SPRING.smooth}
              className="mt-1 font-display text-[2.3rem] leading-tight font-semibold">Vos meilleurs moments</motion.h1>
            <p className="mt-1 max-w-[36rem] text-[0.95rem] font-semibold text-white/85">
              À tout moment, appuyez sur <kbd className="rounded-md bg-white/20 px-1.5 py-0.5 font-extrabold">Alt</kbd> + <kbd className="rounded-md bg-white/20 px-1.5 py-0.5 font-extrabold">E</kbd>: l’overlay iBox fige l’écran ; en pleine partie, il garde aussi les 12 dernières secondes en clip.
            </p>
          </div>
          <Segmented<Tab>
            label="Communauté"
            value={tab}
            onChange={(v) => { sound.play("tab"); setTab(v); }}
            options={[
              { value: "feed", label: "Fil des amis", icon: "globe" },
              { value: "mine", label: "Mes captures", icon: "front" },
            ]}
          />
        </div>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={TWEEN.fast}>
          {tab === "feed" ? <Feed onMine={() => setTab("mine")} /> : <Mine />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Feed({ onMine }: { onMine: () => void }) {
  const user = useInetbox((s) => s.user);
  const [items, setItems] = useState<SharedCapture[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = items?.find((x) => x.id === openId) ?? null;
  const patch = (id: string, change: Partial<SharedCapture>) => setItems((list) => list?.map((x) => (x.id === id ? { ...x, ...change } : x)) ?? list);
  // réaction affichée tout de suite, puis corrigée par la réponse du serveur
  const react = (item: SharedCapture, key: ReactionKey | null) => {
    const counts = { ...(item.reactions ?? {}) };
    if (item.myReaction) counts[item.myReaction] = Math.max(0, (counts[item.myReaction] ?? 1) - 1);
    if (key) counts[key] = (counts[key] ?? 0) + 1;
    patch(item.id, { reactions: counts, myReaction: key });
    community.react(item.id, key).then((s) => patch(item.id, s)).catch(() => patch(item.id, { reactions: item.reactions, myReaction: item.myReaction }));
  };
  const load = useCallback(() => {
    if (!user) return;
    setError(null);
    community.feed().then(setItems).catch((e) => setError((e as { message?: string }).message ?? "Fil indisponible."));
  }, [user]);
  useEffect(load, [load]);
  // arrivée depuis une mention : la publication s'ouvre d'elle-même
  useEffect(() => {
    const pending = takePendingShare();
    if (pending) setOpenId(pending);
    const onShare = (e: Event) => setOpenId((e as CustomEvent<string>).detail);
    window.addEventListener("ibox:community-share", onShare);
    return () => window.removeEventListener("ibox:community-share", onShare);
  }, []);
  const people = useKnownPeople(items?.map((it) => ({ id: it.authorId, name: it.authorName, avatar: it.avatar })) ?? []);

  if (!user) {
    return (
      <Empty icon="globe" title="Connectez-vous à iNetbox" body="Le fil montre les captures partagées par vos amis et les profils publics.">
        <Button variant="primary" icon="user" onClick={() => useInetbox.getState().show()}>Se connecter</Button>
      </Empty>
    );
  }
  if (error) return <Empty icon="reset" title="Fil indisponible" body={error}><Button icon="reset" onClick={load}>Réessayer</Button></Empty>;
  if (!items) {
    return (
      <div className="mt-9 grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-5">
        {[0, 1, 2].map((i) => <div key={i} className="ibox-shimmer h-[17rem] rounded-[1.4rem]" />)}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <Empty icon="sparkle" title="Le fil est encore vide" body="Partagez votre première capture, ou invitez vos amis à partager les leurs.">
        <Button variant="primary" icon="front" onClick={onMine}>Mes captures</Button>
      </Empty>
    );
  }
  return (
    <>
      <div className="mt-6 flex items-center justify-between">
        <h2 className="font-display text-[1.3rem] font-semibold text-ink">Partagé récemment</h2>
        <Button icon="reset" onClick={load}>Actualiser</Button>
      </div>
      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-5" data-nav-group="community-feed">
        {items.map((it, i) => <SharedCard key={it.id} item={it} index={i} people={people} onOpen={() => setOpenId(it.id)} onReact={(k) => react(it, k)} />)}
      </div>
      {open && (
        <Viewer source={{ shared: open.id }} title={open.game ?? "Capture"} subtitle={`${open.authorName} · ${relativeDay(new Date(open.createdAt).toISOString())}`} caption={open.caption} onClose={() => setOpenId(null)}
          after={<Comments shareId={open.id} onCount={(n) => patch(open.id, { commentCount: n })} />}>
          <div className="flex-1"><ReactionBar summary={{ reactions: open.reactions ?? {}, myReaction: open.myReaction ?? null }} onReact={(k) => react(open, k)} /></div>
          {open.mine && (
            <Button icon="x" onClick={async () => {
              await community.remove(open.id).catch(() => undefined);
              setOpenId(null);
              load();
            }}>Retirer le partage</Button>
          )}
        </Viewer>
      )}
    </>
  );
}

function SharedCard({ item, index, people, onOpen, onReact }: { item: SharedCapture; index: number; people: PlayerTarget[]; onOpen: () => void; onReact: (key: ReactionKey | null) => void }) {
  // miniature légère quand le partage en a une (sinon l'image entière, une seule fois grâce au cache)
  const url = useCaptureUrl({ shared: item.id, thumb: !!item.hasThumb });
  const platform = item.platformId ? getPlatform(item.platformId) : undefined;
  const comments = item.commentCount ?? 0;
  const author = { id: item.authorId, name: item.authorName, avatar: item.avatar };
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      whileHover={{ y: -4 }}
      transition={{ ...SPRING.smooth, delay: Math.min(index, 8) * 0.05 }}
      className="group flex flex-col overflow-hidden rounded-[1.4rem] bg-white text-left shadow-[0_14px_30px_-20px_rgba(30,40,70,0.55)]"
    >
      <button data-focusable onClick={() => { sound.play("open"); onOpen(); }} className="ibox-focusable text-left [--ring-radius:1.4rem]">
      <div className="relative aspect-video bg-ink/10">
        {url ? (
          <motion.img src={url} alt="" initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} transition={TWEEN.base}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
        ) : (
          <div className="ibox-shimmer size-full" />
        )}
        {item.kind === "clip" && <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[0.7rem] font-extrabold text-white"><Icon name="play" size="0.8em" /> Clip</span>}
      </div>
      <div className="flex items-center gap-3 p-3">
        <PlayerLink player={author} className="shrink-0"><Avatar size={34} choice={item.avatar} name={item.authorName} /></PlayerLink>
        <div className="min-w-0 flex-1">
          <div data-no-i18n className="truncate text-[0.9rem] font-bold text-ink"><PlayerLink player={author} className="!rounded-md hover:underline">{item.authorName}</PlayerLink></div>
          <div className="truncate text-[0.78rem] font-semibold text-ink-soft">
            <span data-no-i18n>{item.game ?? "iBox"}</span>{platform ? ` · ${platform.shortName}` : ""}
          </div>
        </div>
        <span className="shrink-0 text-[0.72rem] font-bold text-ink-soft">{relativeDay(new Date(item.createdAt).toISOString())}</span>
      </div>
      {item.caption && <p data-no-i18n className="-mt-1 line-clamp-2 px-3 pb-2 text-[0.82rem] font-semibold text-ink"><RichText text={item.caption} people={people} /></p>}
      </button>
      <div className="mt-auto flex items-center gap-2 border-t border-ink/5 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <ReactionBar compact summary={{ reactions: item.reactions ?? {}, myReaction: item.myReaction ?? null }} onReact={onReact} />
        </div>
        <button type="button" data-focusable onClick={() => { sound.play("open"); onOpen(); }} title="Commenter"
          className="ibox-focusable inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-cream-deep px-2.5 text-[0.8rem] font-extrabold text-ink-soft hover:bg-white hover:text-ink [--ring-radius:999px]">
          <Icon name="chat" size="1rem" />{comments > 0 ? <span className="tabular-nums">{comments}</span> : <span>Commenter</span>}
        </button>
      </div>
    </motion.div>
  );
}

function Mine() {
  const captureKeys = useSettings((s) => s.captureKeys ?? DEFAULT_KEYS.capture);
  const user = useInetbox((s) => s.user);
  const [items, setItems] = useState<LocalCapture[] | null>(null);
  const [open, setOpen] = useState<LocalCapture | null>(null);
  const [caption, setCaption] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [celebrate, setCelebrate] = useState(0);
  const picked = useRef<Picked>(new Map());
  const load = useCallback(() => void captures.list().then(setItems).catch(() => setItems([])), []);
  useEffect(load, [load]);

  if (!isTauri()) return <Empty icon="lock" title="Disponible dans l’application Windows" body="Les captures en jeu passent par l’overlay d’iBox." />;
  if (!items) return <p className="mt-8 text-center font-bold text-ink-soft">Chargement…</p>;
  return (
    <>
      <div className="mt-6 flex items-center justify-between">
        <h2 className="font-display text-[1.3rem] font-semibold text-ink">Sur ce PC <span className="text-[1rem] text-ink-soft">({items.length})</span></h2>
        <Button icon="folder" onClick={() => void captures.folder()}>Ouvrir le dossier</Button>
      </div>
      {items.length === 0 ? (
        <Empty icon="front" title="Aucune capture pour l’instant" body={isLinux() ? "Sur Steam Deck, les captures se font avec Steam (bouton Steam + R1)." : `Appuyez sur ${captureKeys} au bon moment, en jeu ou non.`} />
      ) : (
        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4" data-nav-group="community-mine">
          {items.map((it, i) => <LocalCard key={it.name} item={it} index={i} onOpen={() => { setOpen(it); setCaption(""); setStatus(null); picked.current = new Map(); }} />)}
        </div>
      )}
      {open && (
        <Viewer source={{ local: open.name }} title={open.game ?? "Capture"} subtitle={`${open.kind === "clip" ? "Clip" : "Capture d’écran"} · ${formatBytes(open.size)}`} onClose={() => setOpen(null)}>
          {open.kind === "clip" ? (
            <p className="flex flex-1 items-center gap-2 text-[0.88rem] font-semibold text-ink-soft">
              <Icon name="lock" size="1rem" />
              Les clips vidéo restent sur ce PC : la Communauté n’accepte que les images pour le moment.
            </p>
          ) : user ? (
            <form className="flex flex-1 items-center gap-2" onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setStatus(null);
              try {
                await captures.share(open.name, caption, mentionIds(caption, picked.current));
                sound.play("select");
                setStatus("Partagé avec vos amis !");
                setCelebrate((n) => n + 1);
              } catch (err) {
                setStatus((err as { message?: string }).message ?? "Le partage a échoué.");
              } finally {
                setBusy(false);
              }
            }}>
              <div className="flex h-11 min-w-0 flex-1 items-center rounded-full bg-cream-deep px-4 transition-shadow focus-within:shadow-[0_0_0_3px_rgba(74,91,234,0.25)]">
                <MentionField value={caption} onChange={setCaption} onPick={(f) => picked.current.set(f.id, f.displayName)} maxLength={200}
                  placeholder="Un mot sur ce moment… (@ pour identifier un ami)" label="Légende" />
              </div>
              <Button type="submit" variant="primary" icon="globe" disabled={busy || status === "Partagé avec vos amis !"}>{busy ? "Envoi…" : status === "Partagé avec vos amis !" ? "Partagé" : "Partager"}</Button>
            </form>
          ) : (
            <Button icon="user" onClick={() => useInetbox.getState().show()}>Se connecter pour partager</Button>
          )}
          <Button icon="x" onClick={async () => {
            await captures.remove(open.name).catch(() => undefined);
            setOpen(null);
            load();
          }}>Supprimer</Button>
          <AnimatePresence>
            {status && (
              <motion.p key={status} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className={`w-full text-[0.9rem] font-extrabold ${status === "Partagé avec vos amis !" ? "text-mint-deep" : "text-peach-deep"}`}>
                {status}
              </motion.p>
            )}
          </AnimatePresence>
          {celebrate > 0 && <Burst key={celebrate} />}
        </Viewer>
      )}
    </>
  );
}

function LocalCard({ item, index, onOpen }: { item: LocalCapture; index: number; onOpen: () => void }) {
  // vidéo : pas de chargement dans la grille (fichiers lourds), lecture dans la visionneuse
  const video = item.name.endsWith(".mp4");
  const url = useCaptureUrl(video ? null : { local: item.name });
  return (
    <motion.button
      data-focusable
      onClick={() => { sound.play("open"); onOpen(); }}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.03 }}
      className="ibox-focusable ibox-lift overflow-hidden rounded-[1.2rem] bg-white text-left shadow-[0_12px_26px_-20px_rgba(30,40,70,0.55)] [--ring-radius:1.2rem]"
    >
      <div className="relative aspect-video bg-ink/10">
        {url && <img src={url} alt="" loading="lazy" className="size-full object-cover" />}
        {video && (
          <div className="grid size-full place-items-center bg-[linear-gradient(145deg,#1d2340,#0e1222)] text-white/85">
            <span className="grid size-12 place-items-center rounded-full bg-white/15"><Icon name="play" size="1.4rem" /></span>
          </div>
        )}
        {item.kind === "clip" && <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[0.7rem] font-extrabold text-white"><Icon name="play" size="0.8em" /> Clip</span>}
      </div>
      <div className="px-3 py-2">
        <div data-no-i18n className="truncate text-[0.86rem] font-bold text-ink">{item.game ?? "iBox"}</div>
        <div className="text-[0.74rem] font-semibold text-ink-soft">{relativeDay(new Date(item.at).toISOString())}</div>
      </div>
    </motion.button>
  );
}

function CaptionLine({ caption }: { caption: string }) {
  const people = useKnownPeople();
  return <p data-no-i18n className="mt-3 text-[0.95rem] font-semibold text-ink"><RichText text={caption} people={people} /></p>;
}

function Viewer({ source, title, subtitle, caption, onClose, children, after }: {
  source: { local: string } | { shared: string; thumb?: boolean }; title: string; subtitle: string; caption?: string; onClose: () => void; children?: React.ReactNode; after?: React.ReactNode;
}) {
  const url = useCaptureUrl(source);
  return (
    <Modal title={title} subtitle={subtitle} width="min(70rem, 94vw)" onClose={onClose}>
      <div className="overflow-hidden rounded-2xl bg-black">
        {url && "local" in source && source.local.endsWith(".mp4") ? (
          <video src={url} controls autoPlay playsInline className="mx-auto max-h-[52vh] w-auto" />
        ) : url ? (
          <motion.img src={url} alt="" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={TWEEN.base} className="mx-auto max-h-[52vh] w-auto object-contain" />
        ) : (
          <div className="ibox-shimmer aspect-video opacity-30" />
        )}
      </div>
      {caption && <CaptionLine caption={caption} />}
      {children && <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div>}
      {after}
    </Modal>
  );
}

/** Pluie d'émojis au moment du partage (une seconde et demie). */
function Burst() {
  const reduced = useReducedMotion();
  if (reduced) return null;
  const bits = ["🎉", "✨", "🎮", "⭐", "💜", "🔥", "🎉", "✨", "🏆", "💫", "⭐", "🎊"];
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[90] overflow-hidden">
      {bits.map((b, i) => {
        const angle = (i / bits.length) * Math.PI * 2;
        return (
          <motion.span key={i} className="absolute top-1/2 left-1/2 text-[1.8rem]"
            initial={{ x: 0, y: 0, scale: 0.3, opacity: 1 }}
            animate={{ x: Math.cos(angle) * (220 + (i % 3) * 70), y: Math.sin(angle) * (160 + (i % 2) * 60) + 120, scale: 1.1, opacity: 0, rotate: (i % 2 ? 1 : -1) * 120 }}
            transition={{ duration: 1.4, ease: [0.2, 0.7, 0.3, 1] }}>
            {b}
          </motion.span>
        );
      })}
    </div>
  );
}

function Empty({ icon, title, body, children }: { icon: Parameters<typeof Icon>[0]["name"]; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="mt-8 flex flex-col items-center rounded-[1.8rem] bg-white/60 px-6 py-12 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-white shadow-sm text-ink-soft"><Icon name={icon} size="1.8rem" /></span>
      <h3 className="mt-4 font-display text-[1.35rem] font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-[30rem] text-[0.92rem] font-semibold text-ink-soft">{body}</p>
      {children && <div className="mt-5 flex gap-2">{children}</div>}
    </div>
  );
}
