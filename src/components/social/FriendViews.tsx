import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Avatar } from "@/components/profile/Avatar";
import { PlayerCard } from "@/components/profile/PlayerCard";
import { Button } from "@/components/ui/Button";
import { supportsMultiplayer } from "@/services/extras";
import { Icon } from "@/components/ui/Icon";
import { call, useInetbox, type AchievementHighlight, type FeaturedGame, type InetFriend } from "@/services/inetbox";
import { useLibrary } from "@/services/library";
import { useNav } from "@/app/navigation";
import { getPlatform } from "@/domain/platforms";
import type { AvatarChoice } from "@/services/settings";
import { sound } from "@/services/sound";
import { friendState, SettingTile } from "./Presence";
import { gameKey } from "@/services/social";

interface Activity { friendId?: string; displayName?: string; avatar?: AvatarChoice | null; gameTitle: string; platformId: string; startedAt: number }
interface Profile { id: string; displayName: string; avatar: AvatarChoice | null; bio?: string; accent?: string | null; banner?: string | null; featuredGames?: FeaturedGame[]; achievementHighlight?: AchievementHighlight | null; since: number | null; activity: Activity[]; games: number | null }
interface Message { id: string; mine: boolean; body: string; createdAt: number }

/** « il y a 5 min », « hier »… */
export function ago(at: number) {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 172800) return "hier";
  return `il y a ${Math.floor(s / 86400)} jours`;
}

/** Ligne de jeu cliquable : ouvre la fiche si le jeu est dans la bibliothèque. */
function GameLine({ a, who }: { a: Activity; who?: { name: string; avatar?: AvatarChoice | null } }) {
  const games = useLibrary((s) => s.realGames);
  const go = useNav((s) => s.go);
  const mine = games.find((g) => g.platformId === a.platformId && g.title.toLowerCase() === a.gameTitle.toLowerCase());
  const platform = getPlatform(a.platformId)?.shortName;
  return (
    <button
      data-focusable
      disabled={!mine}
      onClick={() => mine && go({ name: "game", gameId: mine.id })}
      className="ibox-focusable my-1 flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left enabled:hover:bg-cream-deep/60 [--ring-radius:1rem]"
    >
      {who ? <Avatar size={38} choice={who.avatar ?? null} name={who.name} /> : (
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#E3F5EC] text-[#3C8E69]"><Icon name="play" size="1em" filled /></span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.92rem] font-bold text-ink">
          {who ? <>{who.name} <span className="font-semibold text-ink-soft">a lancé</span> {a.gameTitle}</> : a.gameTitle}
        </span>
        <span className="block truncate text-[0.78rem] font-semibold text-ink-soft">
          {platform ? `${platform} · ` : ""}{ago(a.startedAt)}{mine ? " · dans votre bibliothèque" : ""}
        </span>
      </span>
      {mine && <Icon name="chevronRight" size="1em" className="text-ink-faint" />}
    </button>
  );
}

function Empty({ icon, text }: { icon: "clock" | "sparkle" | "user"; text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-cream-deep text-ink-faint"><Icon name={icon} size="1.5em" /></span>
      <p data-focusable tabIndex={0} className="ibox-focusable mt-3 rounded-lg px-2 text-[0.92rem] font-bold text-ink-soft outline-none">{text}</p>
    </div>
  );
}

/** Fil d'activité : ce que les amis ont lancé ces derniers jours. */
export function ActivityView() {
  const [items, setItems] = useState<Activity[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    call<{ items: Activity[] }>("activity").then((r) => setItems(r.items)).catch(() => setFailed(true));
  }, []);
  if (failed) return <Empty icon="clock" text="Activité indisponible pour le moment." />;
  if (!items) return <Empty icon="clock" text="Chargement…" />;
  if (!items.length) return <Empty icon="clock" text="Aucune partie lancée par vos amis ces 7 derniers jours." />;
  return (
    <div data-nav-group="friends-activity" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      {items.map((a, i) => <GameLine key={`${a.friendId}-${a.startedAt}-${i}`} a={a} who={{ name: a.displayName ?? "", avatar: a.avatar }} />)}
    </div>
  );
}

/** Profil d'un ami : photo, statut, depuis quand, derniers jeux. */
export function ProfileView({ id, friend, onChat }: { id: string; friend?: InetFriend; onChat: () => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [failed, setFailed] = useState(false);
  const connected = useInetbox((s) => s.status === "online");
  const act = useInetbox((s) => s.act);
  const st = friend ? friendState(friend, connected) : null;
  useEffect(() => {
    let active = true;
    call<Profile>("friendProfile", undefined, id).then((result) => {
      if (active) setP(result);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [id, !!friend]);
  if (!friend && failed) return <Empty icon="user" text="Ce profil est privé ou indisponible." />;
  if (!friend && !p) return <Empty icon="user" text="Chargement…" />;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
      <PlayerCard name={p?.displayName ?? friend?.displayName ?? ""} avatar={p?.avatar ?? friend?.avatar ?? null}
        accent={p?.accent} banner={p?.banner} bio={p?.bio} games={p?.featuredGames}
        status={friend ? st?.label : "Invitation en attente"}
        actions={friend && <div className="mt-3 flex flex-wrap justify-center gap-2">
          <Chip onClick={onChat} icon="sparkle" label="Message" autoFocus />
          <Chip
            onClick={() => { sound.play("toggle"); void act(friend.favorite ? "unfavorite" : "favorite", undefined, friend.id); }}
            icon="star"
            label={friend.favorite ? "Favori" : "Ajouter aux favoris"}
            active={friend.favorite}
          />
        </div>} />
      {friend && p?.achievementHighlight && <section className="mt-3 rounded-2xl bg-cream-deep p-4 text-ink">
        <div className="flex items-center gap-2 font-bold"><Icon name="star" />{p.achievementHighlight.source}</div>
        <p data-no-i18n className="mt-1 break-words">{p.achievementHighlight.title}</p>
        <progress className="my-2 w-full accent-mint-deep" max={p.achievementHighlight.total} value={p.achievementHighlight.earned} />
        <p className="text-sm text-ink-soft">{p.achievementHighlight.earned} / {p.achievementHighlight.total} succès</p>
      </section>}
      {friend && p?.featuredGames && <CommonGames friend={friend} />}
      {friend && (failed ? <Empty icon="user" text="Profil indisponible pour le moment." /> : !p ? <Empty icon="user" text="Chargement…" /> : p.since !== null && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Stat label="Amis depuis" value={new Date(p.since).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} />
            <Stat label="Jeux" value={p.games === null ? "Privé" : String(p.games)} />
          </div>
          <div className="flex items-center gap-2 px-2 pt-4 pb-1 text-[0.7rem] font-extrabold tracking-[0.14em] text-ink-soft uppercase">Joué récemment</div>
          {p.activity.length ? p.activity.map((a, i) => <GameLine key={`${a.startedAt}-${i}`} a={a} />) : (
            <p className="px-2 text-[0.85rem] font-semibold text-ink-soft">Rien de partagé ces 7 derniers jours.</p>
          )}
        </>
      ))}
    </div>
  );
}

function CommonGames({ friend }: { friend: InetFriend }) {
  const [shared, setShared] = useState<string[] | null>(null);
  const [coop, setCoop] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
  const games = useLibrary((state) => state.realGames);
  const { user, act, busy, gameInvitesSupported, error, message } = useInetbox();
  const enabled = user?.privacy.shareLibrary;
  const load = async () => {
    setExpanded(true);
    setFailed(false);
    setShared(null);
    try {
      const { items } = await call<{ items: string[] }>("commonGames", undefined, friend.id);
      setShared(items);
    } catch { setFailed(true); }
  };
  const keys = new Set(shared ?? []);
  const matches = games.filter((game) => keys.has(gameKey(game.platformId, game.title)) &&
    (!coop || supportsMultiplayer(game) || /coop/i.test(game.genre ?? "")));
  return (
    <section className="mt-3 space-y-2 rounded-2xl bg-cream-deep p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-display text-lg text-ink">À quoi on joue ?</h4>
        <Button icon="gamepad" disabled={!enabled} onClick={() => expanded ? setExpanded(false) : void load()}>
          {expanded ? "Masquer" : "Voir les jeux en commun"}
        </Button>
      </div>
      {!enabled && <div className="space-y-2">
        <p className="text-sm text-ink-soft">Activez le partage de la bibliothèque pour comparer vos jeux.</p>
        <LibraryShareToggle />
      </div>}
      {enabled && expanded && <>
        <Button aria-pressed={coop} variant={coop ? "primary" : "soft"} onClick={() => setCoop(!coop)}>Multijoueur / coop</Button>
        <div className="max-h-72 overflow-y-auto">
          {matches.map((game) => <div key={game.id} className="mb-1 flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2">
            <div className="min-w-0"><div data-no-i18n className="truncate font-bold text-ink">{game.title}</div>
              <small className="text-ink-soft">{getPlatform(game.platformId)?.name}</small></div>
            {gameInvitesSupported && <Button disabled={busy} onClick={() => void act("gameInvite", {
              friendId: friend.id, game: { title: game.title.slice(0, 160), platformId: game.platformId },
            })}>Inviter</Button>}
          </div>)}
          {failed ? <p role="alert">Impossible de charger les jeux en commun.</p> : !shared ? <p>Chargement…</p> : !matches.length && <p>Aucun jeu partagé trouvé.</p>}
        </div>
        {(error || message) && <p role="status" className="text-sm text-ink-soft">{error ?? message}</p>}
      </>}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-cream-deep/70 px-4 py-3">
      <div className="text-[0.68rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">{label}</div>
      <div className="mt-0.5 font-display text-[1.15rem] font-semibold text-ink">{value}</div>
    </div>
  );
}

function Chip({ icon, label, onClick, active, autoFocus }: { icon: "sparkle" | "star"; label: string; onClick: () => void; active?: boolean; autoFocus?: boolean }) {
  return (
    <button
      data-focusable
      data-autofocus={autoFocus || undefined}
      onClick={onClick}
      className={`ibox-focusable flex h-10 items-center gap-1.5 rounded-full px-4 text-[0.85rem] font-bold shadow-xs [--ring-radius:999px] ${active ? "bg-[#FFF1CC] text-[#9A6A00]" : "bg-white text-ink"}`}
    >
      <Icon name={icon} size="1em" filled={active} />
      {label}
    </button>
  );
}

/** Intervalle de relève d'une conversation ouverte (plus lent quand iBox est en arrière-plan). */
const CHAT_POLL_MS = 2500;
const CHAT_IDLE_POLL_MS = 10_000;
/** Signal « en train d'écrire » envoyé au plus toutes les 3 secondes. */
const TYPING_EVERY_MS = 3000;

type ChatMessage = Message & { pending?: boolean; failed?: boolean };

/**
 * Conversation avec un ami, en direct : nouveaux messages relevés toutes les 2,5 s (seulement
 * les nouveaux), envoi instantané, bulle « … écrit » et « Vu » sous votre dernier message.
 */
export function ChatView({ friend }: { friend: InetFriend }) {
  const [items, setItems] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [seenUpTo, setSeenUpTo] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const lastAt = useRef(0);
  const lastTypingSent = useRef(0);

  const merge = useCallback((incoming: Message[]) => {
    if (!incoming.length) return;
    lastAt.current = Math.max(lastAt.current, ...incoming.map((m) => m.createdAt));
    setItems((v) => {
      const base = (v ?? []).filter((m) => !incoming.some((n) => n.id === m.id));
      return [...base, ...incoming].sort((a, b) => a.createdAt - b.createdAt);
    });
  }, []);

  // premier chargement, puis relève régulière des seuls nouveaux messages
  useEffect(() => {
    let live = true;
    let timer = 0;
    lastAt.current = 0;
    setItems(null);
    const poll = async (first: boolean) => {
      try {
        const r = await call<{ items: Message[]; typing?: boolean; seenUpTo?: number | null }>(
          "conversation", first ? undefined : { after: lastAt.current }, friend.id);
        if (!live) return;
        if (first) {
          setItems(r.items);
          lastAt.current = Math.max(0, ...r.items.map((m) => m.createdAt));
        } else {
          if (r.items.some((m) => !m.mine)) sound.play("toggle");
          merge(r.items);
        }
        setTyping(!!r.typing);
        if (r.seenUpTo !== undefined) setSeenUpTo(r.seenUpTo);
        useInetbox.setState((st) => ({ unread: st.unread.filter((u) => u.friendId !== friend.id) }));
      } catch {
        if (live && first) setItems((v) => v ?? []);
      }
      if (!live) return;
      const visible = document.visibilityState === "visible" && document.hasFocus();
      timer = window.setTimeout(() => void poll(false), visible ? CHAT_POLL_MS : CHAT_IDLE_POLL_MS);
    };
    void poll(true);
    return () => { live = false; window.clearTimeout(timer); };
  }, [friend.id, merge]);

  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [items, typing]);

  const onType = (value: string) => {
    setText(value);
    const t = Date.now();
    if (value.trim() && t - lastTypingSent.current > TYPING_EVERY_MS) {
      lastTypingSent.current = t;
      void call("typing", undefined, friend.id).catch(() => undefined);
    }
  };

  const send = async (retry?: ChatMessage) => {
    const body = retry?.body ?? text.trim();
    if (!body) return;
    const temp: ChatMessage = retry ?? { id: `local-${Date.now()}`, mine: true, body, createdAt: Date.now(), pending: true };
    // affiché tout de suite ; confirmé (ou signalé) quand le serveur répond
    setItems((v) => [...(v ?? []).filter((m) => m.id !== temp.id), { ...temp, pending: true, failed: false }]);
    if (!retry) setText("");
    setError(null);
    lastTypingSent.current = 0;
    try {
      const r = await call<{ id: string; createdAt: number }>("sendMessage", { friendId: friend.id, body });
      sound.play("select");
      lastAt.current = Math.max(lastAt.current, r.createdAt);
      setItems((v) => (v ?? []).map((m) => (m.id === temp.id ? { id: r.id, mine: true, body, createdAt: r.createdAt } : m)));
    } catch (e) {
      sound.play("error");
      setItems((v) => (v ?? []).map((m) => (m.id === temp.id ? { ...m, pending: false, failed: true } : m)));
      setError((e as { message?: string })?.message ?? "Envoi impossible.");
    }
  };

  const lastMine = [...(items ?? [])].reverse().find((m) => m.mine && !m.pending && !m.failed);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={list} data-no-i18n className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 pb-3">
        {items === null ? (
          <div className="flex justify-center pt-10"><TypingDots /></div>
        ) : items.length === 0 ? (
          <p className="pt-10 text-center text-[0.9rem] font-bold text-ink-soft">Dites bonjour à {friend.displayName} !</p>
        ) : items.map((m) => (
          <motion.div key={m.id} layout="position" initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 520, damping: 32 }} className={`flex flex-col ${m.mine ? "items-end" : "items-start"}`}>
            <button
              type="button"
              tabIndex={m.failed ? 0 : -1}
              disabled={!m.failed}
              onClick={() => { if (m.failed) void send(m); }}
              title={m.failed ? "Envoi impossible : touchez pour réessayer" : new Date(m.createdAt).toLocaleString()}
              className={`max-w-[80%] rounded-[1.2rem] px-3.5 py-2 text-left text-[0.92rem] font-semibold break-words whitespace-pre-wrap transition-opacity ${m.mine ? "rounded-br-md bg-[linear-gradient(135deg,#88CBF5,#B5A0E9)] text-white" : "rounded-bl-md bg-cream-deep text-ink"} ${m.pending ? "opacity-60" : ""} ${m.failed ? "ring-2 ring-peach-deep" : ""}`}
            >
              {m.body}
            </button>
            {m.failed && <span className="mt-0.5 text-[0.7rem] font-bold text-peach-deep">Non envoyé · touchez pour réessayer</span>}
            {m === lastMine && seenUpTo !== null && seenUpTo >= m.createdAt && (
              <span className="mt-0.5 flex items-center gap-0.5 text-[0.7rem] font-bold text-ink-faint"><Icon name="check" size="0.9em" />Vu</span>
            )}
          </motion.div>
        ))}
        <AnimatePresence>
          {typing && (
            <motion.div key="typing" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
              <span className="rounded-[1.2rem] rounded-bl-md bg-cream-deep px-3.5 py-2.5"><TypingDots /></span>
              <span className="text-[0.74rem] font-bold text-ink-faint">{friend.displayName} écrit…</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {error && <p className="px-4 pb-1 text-[0.8rem] font-bold text-peach-deep">{error}</p>}
      <form
        className="flex items-center gap-2 border-t border-black/5 px-4 py-3"
        onSubmit={(e) => { e.preventDefault(); void send(); }}
      >
        <input
          data-focusable
          data-autofocus
          value={text}
          maxLength={1000}
          onChange={(e) => onType(e.target.value)}
          placeholder={`Message à ${friend.displayName}`}
          aria-label="Votre message"
          className="ibox-focusable h-11 min-w-0 flex-1 rounded-full bg-cream-deep px-4 text-[0.92rem] font-semibold text-ink [--ring-radius:999px] placeholder:text-ink-faint"
        />
        <button
          data-focusable
          type="submit"
          aria-label="Envoyer"
          disabled={!text.trim()}
          className="ibox-focusable grid size-11 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#88CBF5,#B5A0E9)] text-white shadow-sm [--ring-radius:999px] disabled:opacity-45"
        >
          <Icon name="play" size="1em" filled />
        </button>
      </form>
    </div>
  );
}

/** Trois points qui sautillent (« en train d'écrire »). */
function TypingDots() {
  return (
    <span className="flex items-center gap-1" aria-label="En train d'écrire">
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="size-2 rounded-full bg-ink-faint"
          animate={{ y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }} />
      ))}
    </span>
  );
}

/** Bouton « Ma bibliothèque visible » : les amis voient quels jeux vous avez en commun. */
export function LibraryShareToggle({ tile = false }: { tile?: boolean }) {
  const user = useInetbox((s) => s.user);
  const busy = useInetbox((s) => s.busy);
  const supported = useInetbox((s) => s.socialSupported);
  const act = useInetbox((s) => s.act);
  if (!user || !supported) return null;
  const on = !!user.privacy.shareLibrary;
  if (tile) return <SettingTile icon="shelf" label="Mes jeux" state={on ? "Visibles" : "Cachés"} on={on} disabled={busy} onClick={() => { sound.play("toggle"); void act("profile", { shareLibrary: !on }); }} tint="#3E8FD6" title={on ? "Vos amis voient quels jeux vous avez en commun" : "Vos jeux restent privés"} />;
  return (
    <button
      data-focusable
      role="switch"
      aria-checked={on}
      aria-label="Montrer mes jeux à mes amis"
      title={on ? "Vos amis voient quels jeux vous avez en commun" : "Vos jeux restent privés"}
      disabled={busy}
      onClick={() => { sound.play("toggle"); void act("profile", { shareLibrary: !on }); }}
      className={`ibox-focusable flex h-10 items-center gap-1.5 rounded-full px-3 text-[0.8rem] font-bold shadow-xs [--ring-radius:999px] disabled:opacity-45 ${on ? "bg-[#E3F5EC] text-ink" : "bg-white/80 text-ink-soft"}`}
    >
      <Icon name="shelf" size="1.1em" />
      {on ? "Bibliothèque visible" : "Bibliothèque cachée"}
    </button>
  );
}

/** Fiche de jeu : les amis qui ont aussi ce jeu (ceux qui partagent leur bibliothèque). */
export function FriendsWithGame({ title, platformId }: { title: string; platformId: string }) {
  const user = useInetbox((s) => s.user);
  const supported = useInetbox((s) => s.socialSupported);
  const [owners, setOwners] = useState<{ id: string; displayName: string; avatar: AvatarChoice | null }[]>([]);
  useEffect(() => {
    setOwners([]);
    if (!user || !supported) return;
    let live = true;
    call<{ items: typeof owners }>("owners", { key: gameKey(platformId, title) }).then((r) => live && setOwners(r.items)).catch(() => undefined);
    return () => { live = false; };
  }, [user, supported, title, platformId]);
  if (!owners.length) return null;
  const names = owners.slice(0, 2).map((o) => o.displayName).join(", ");
  const more = owners.length - 2;
  return (
    <button
      data-focusable
      onClick={() => window.dispatchEvent(new CustomEvent("ibox:open-friends", { detail: { view: "profile", friendId: owners[0].id } }))}
      className="ibox-focusable mt-3 flex w-fit items-center gap-2.5 rounded-full bg-white/70 py-1.5 pr-4 pl-1.5 text-[0.88rem] font-bold text-ink shadow-xs [--ring-radius:999px]"
    >
      <span className="flex -space-x-2.5">
        {owners.slice(0, 3).map((o) => <Avatar key={o.id} size={30} choice={o.avatar} name={o.displayName} />)}
      </span>
      <span>
        <span data-no-i18n>{names}</span>
        {more > 0 ? ` et ${more} autre${more > 1 ? "s" : ""}` : ""} {owners.length > 1 ? "ont aussi ce jeu" : "a aussi ce jeu"}
      </span>
    </button>
  );
}
