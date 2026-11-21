import { saved } from "@/services/saved";
import { SPRING, TWEEN } from "@/motion/tokens";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Avatar } from "@/components/profile/Avatar";
import { RichText, useKnownPeople } from "@/components/community/Mentions";
import { PlayerLink } from "@/components/social/PlayerProfile";
import { Icon } from "@/components/ui/Icon";
import { call, useInetbox, type InetFriend } from "@/services/inetbox";
import { GROUP_MAX_MEMBERS, membersLabel, useGroups, type ChatGroup, type GroupMember, type GroupMessage } from "@/services/groups";
import { sound } from "@/services/sound";
import { TypingDots } from "./FriendViews";

const CHAT_POLL_MS = 2500;
const CHAT_IDLE_POLL_MS = 10_000;
const TYPING_EVERY_MS = 3000;

type Pending = GroupMessage & { pending?: boolean; failed?: boolean };

const errorText = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback;

/** Avatars empilés d'un groupe (trois au plus, puis « +N »). */
export function GroupAvatar({ members, selfId, size = 42 }: { members: GroupMember[]; selfId?: string; size?: number }) {
  const others = members.filter((m) => m.id !== selfId);
  const shown = others.slice(0, 3);
  const small = Math.round(size * 0.62);
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {shown.map((m, i) => {
        const pos = shown.length === 1 ? { left: (size - small) / 2, top: (size - small) / 2 } : [{ left: 0, top: 0 }, { left: size - small, top: size * 0.12 }, { left: (size - small) / 2, top: size - small }][i];
        return (
          <span key={m.id} className="absolute rounded-full ring-2 ring-white" style={pos}>
            <Avatar size={small} choice={m.avatar ?? null} name={m.displayName} />
          </span>
        );
      })}
      {others.length > 3 && (
        <span className="absolute -right-1 -bottom-1 grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-[0.6rem] font-extrabold text-cream">
          +{others.length - 3}
        </span>
      )}
    </span>
  );
}

/** Une ligne de la liste « Groupes » du panneau des amis. */
export function GroupRow({ group, onOpen }: { group: ChatGroup; onOpen: () => void }) {
  const selfId = useInetbox((s) => s.user?.id);
  return (
    <button
      data-focusable
      onClick={() => {
        sound.play("select");
        onOpen();
      }}
      className="ibox-focusable my-1 flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-cream-deep/60 [--ring-radius:1rem]"
    >
      <GroupAvatar members={group.members} selfId={selfId} />
      <span className="min-w-0 flex-1">
        <span data-no-i18n className="block truncate text-[0.98rem] font-bold text-ink">
          {group.name}
        </span>
        <span data-no-i18n className="block truncate text-[0.8rem] font-semibold text-ink-soft">
          {group.lastBody ? `${group.lastFrom ? `${group.lastFrom} : ` : ""}${group.lastBody}` : membersLabel(group.members, selfId)}
        </span>
      </span>
      {group.unread > 0 && (
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#88CBF5] px-1 text-[0.7rem] font-extrabold text-white">{group.unread}</span>
      )}
      <Icon name="chevronRight" size="1em" className="text-ink-faint" />
    </button>
  );
}

/** Choix d'amis à cocher (création d'un groupe, ajout de membres). */
function FriendPicker({ friends, picked, room, onToggle }: { friends: InetFriend[]; picked: string[]; room: number; onToggle: (id: string) => void }) {
  if (friends.length === 0) return <p className="py-6 text-center text-[0.9rem] font-bold text-ink-soft">Aucun ami à ajouter.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {friends.map((f) => {
        const on = picked.includes(f.id);
        const full = !on && picked.length >= room;
        return (
          <button
            key={f.id}
            data-focusable
            role="checkbox"
            aria-checked={on}
            disabled={full}
            onClick={() => {
              sound.play(on ? "off" : "on");
              onToggle(f.id);
            }}
            className={`ibox-focusable flex items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors disabled:opacity-45 [--ring-radius:1rem] ${on ? "bg-accent-soft ring-2 ring-accent/70" : "bg-cream-deep/70 hover:bg-cream-deep"}`}
          >
            <Avatar size={36} choice={f.avatar ?? null} name={f.displayName} />
            <span data-no-i18n className="min-w-0 flex-1 truncate font-bold text-ink">
              {f.displayName}
            </span>
            <span
              aria-hidden
              className={`grid size-[1.35rem] shrink-0 place-items-center rounded-[0.45rem] transition-all ${on ? "bg-accent text-on-accent" : "bg-white/80 ring-2 ring-ink/20"}`}
            >
              <svg viewBox="0 0 16 16" className={`size-3.5 transition-[opacity,transform] ${on ? "scale-100 opacity-100" : "scale-50 opacity-0"}`} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3.5 8.5l3 3 6-7" />
              </svg>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Nouveau groupe : un nom, des amis cochés, « Créer ». */
export function NewGroupView({ onCreated }: { onCreated: (id: string) => void }) {
  // trier hors du sélecteur : un nouveau tableau à chaque lecture ferait boucler le rendu
  const allFriends = useInetbox((s) => s.friends);
  const friends = useMemo(() => [...allFriends].sort((a, b) => a.displayName.localeCompare(b.displayName)), [allFriends]);
  const upsert = useGroups((s) => s.upsert);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const room = GROUP_MAX_MEMBERS - 1;
  const chosen = friends.filter((f) => picked.includes(f.id));
  const fallbackName = chosen.map((f) => f.displayName).slice(0, 3).join(", ").slice(0, 40);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const g = await call<ChatGroup>("createGroup", { name: (name.trim() || fallbackName).slice(0, 40), memberIds: picked });
      sound.play("confirm");
      upsert(g);
      onCreated(g.id);
    } catch (e) {
      sound.play("error");
      setError(errorText(e, "Création impossible."));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        <label className="block text-[0.75rem] font-extrabold tracking-wide text-ink-soft uppercase">Nom du groupe</label>
        <input
          data-focusable
          data-autofocus
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder={fallbackName || "Soirée Mario Kart"}
          className="ibox-focusable mt-1.5 h-11 w-full rounded-full bg-cream-deep px-4 text-[0.92rem] font-semibold text-ink [--ring-radius:999px] placeholder:text-ink-faint"
        />
        <div className="mt-4 mb-2 flex items-baseline justify-between">
          <span className="text-[0.75rem] font-extrabold tracking-wide text-ink-soft uppercase">Membres</span>
          <span className="text-[0.75rem] font-bold text-ink-faint">{`${picked.length} / ${room}`}</span>
        </div>
        <FriendPicker friends={friends} picked={picked} room={room} onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} />
      </div>
      {error && <p className="px-4 pb-1 text-[0.8rem] font-bold text-peach-deep">{error}</p>}
      <div className="border-t border-black/5 px-4 py-3">
        <button
          data-focusable
          disabled={busy || picked.length === 0}
          onClick={() => void create()}
          className="ibox-focusable flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#88CBF5,#B5A0E9)] font-bold text-white shadow-sm [--ring-radius:999px] disabled:opacity-45"
        >
          <Icon name="chat" size="1.05em" />
          {busy ? "Création…" : picked.length === 0 ? "Cochez au moins un ami" : picked.length === 1 ? "Créer le groupe avec 1 ami" : `Créer le groupe avec ${picked.length} amis`}
        </button>
      </div>
    </div>
  );
}

/**
 * Discussion de groupe en direct : nom de l'auteur au-dessus de ses bulles,
 * « Léa écrit… », relève des seuls nouveaux messages toutes les 2,5 s.
 * Le volet « Membres » permet de renommer, d'ajouter des amis ou de quitter.
 */
export function GroupChatView({ group, onLeft }: { group: ChatGroup; onLeft: () => void }) {
  const selfId = useInetbox((s) => s.user?.id);
  const markRead = useGroups((s) => s.markRead);
  const [items, setItems] = useState<Pending[] | null>(null);
  const people = useKnownPeople(group.members.map((x) => ({ id: x.id, name: x.displayName, avatar: x.avatar ?? null })));
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState<string[]>([]);
  const [panel, setPanel] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const lastAt = useRef(0);
  const lastTypingSent = useRef(0);

  const merge = useCallback((incoming: GroupMessage[]) => {
    if (!incoming.length) return;
    lastAt.current = Math.max(lastAt.current, ...incoming.map((m) => m.createdAt));
    setItems((v) => [...(v ?? []).filter((m) => !incoming.some((n) => n.id === m.id)), ...incoming].sort((a, b) => a.createdAt - b.createdAt));
  }, []);

  useEffect(() => {
    let live = true;
    let timer = 0;
    lastAt.current = 0;
    setItems(null);
    const poll = async (first: boolean) => {
      try {
        const r = await call<{ items: GroupMessage[]; typing: string[] }>("groupConversation", first ? undefined : { after: lastAt.current }, group.id);
        if (!live) return;
        if (first) {
          setItems(r.items);
          lastAt.current = Math.max(0, ...r.items.map((m) => m.createdAt));
        } else {
          if (r.items.some((m) => !m.mine)) sound.play("message");
          merge(r.items);
        }
        setTyping(r.typing ?? []);
        markRead(group.id);
      } catch {
        if (live && first) setItems((v) => v ?? []);
      }
      if (!live) return;
      const visible = document.visibilityState === "visible" && document.hasFocus();
      timer = window.setTimeout(() => void poll(false), visible ? CHAT_POLL_MS : CHAT_IDLE_POLL_MS);
    };
    void poll(true);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [group.id, merge, markRead]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [items, typing]);

  const onType = (value: string) => {
    setText(value);
    const t = Date.now();
    if (value.trim() && t - lastTypingSent.current > TYPING_EVERY_MS) {
      lastTypingSent.current = t;
      void call("groupTyping", undefined, group.id).catch(() => undefined);
    }
  };

  const send = async (retry?: Pending) => {
    const body = retry?.body ?? text.trim();
    if (!body) return;
    const temp: Pending = retry ?? { id: `local-${Date.now()}`, fromId: selfId ?? null, displayName: null, mine: true, body, createdAt: Date.now(), pending: true };
    setItems((v) => [...(v ?? []).filter((m) => m.id !== temp.id), { ...temp, pending: true, failed: false }]);
    if (!retry) setText("");
    setError(null);
    lastTypingSent.current = 0;
    try {
      const r = await call<{ id: string; createdAt: number }>("sendGroupMessage", { body }, group.id);
      sound.play("select");
      lastAt.current = Math.max(lastAt.current, r.createdAt);
      setItems((v) => (v ?? []).map((m) => (m.id === temp.id ? { ...m, id: r.id, createdAt: r.createdAt, pending: false } : m)));
    } catch (e) {
      sound.play("error");
      setItems((v) => (v ?? []).map((m) => (m.id === temp.id ? { ...m, pending: false, failed: true } : m)));
      setError(errorText(e, "Envoi impossible."));
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 pb-2">
        <span data-no-i18n className="min-w-0 flex-1 truncate text-[0.8rem] font-semibold text-ink-soft">
          {membersLabel(group.members, selfId, 4)}
        </span>
        <button
          data-focusable
          onClick={() => setPanel((v) => !v)}
          aria-expanded={panel}
          className="ibox-focusable flex h-8 items-center gap-1.5 rounded-full bg-cream-deep px-3 text-[0.8rem] font-bold text-ink [--ring-radius:999px]"
        >
          <Icon name="user" size="0.95em" />
          Membres
          <span data-no-i18n className="text-ink-faint">
            {group.members.length}
          </span>
        </button>
      </div>

      <AnimatePresence initial={false}>{panel && <MembersPanel group={group} onLeft={onLeft} onClose={() => setPanel(false)} />}</AnimatePresence>

      <div ref={list} data-no-i18n className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 pb-3">
        {items === null ? (
          <div className="flex justify-center pt-10">
            <TypingDots />
          </div>
        ) : items.length === 0 ? (
          <p className="pt-10 text-center text-[0.9rem] font-bold text-ink-soft">Lancez la conversation du groupe !</p>
        ) : (
          items.map((m, i) => {
            // le nom n'apparaît qu'au début d'une suite de messages du même auteur
            const showName = !m.mine && (i === 0 || items[i - 1].fromId !== m.fromId);
            const author = group.members.find((x) => x.id === m.fromId);
            return (
              <motion.div
                key={m.id}
                layout="position"
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={SPRING.snappy}
                className={`flex gap-2 ${m.mine ? "justify-end" : "justify-start"}`}
              >
                {!m.mine && (
                  <span className="w-7 shrink-0 self-end">{showName && <PlayerLink player={m.displayName && m.fromId ? { id: m.fromId, name: m.displayName, avatar: author?.avatar ?? null } : null}><Avatar size={28} choice={author?.avatar ?? null} name={m.displayName ?? "?"} /></PlayerLink>}</span>
                )}
                <div className={`flex max-w-[78%] flex-col ${m.mine ? "items-end" : "items-start"}`}>
                  {showName && <span className="mb-0.5 ml-1 text-[0.72rem] font-extrabold text-ink-soft">{m.displayName && m.fromId ? <PlayerLink player={{ id: m.fromId, name: m.displayName, avatar: author?.avatar ?? null }} className="!rounded-md hover:underline">{m.displayName}</PlayerLink> : "Ancien membre"}</span>}
                  {m.failed ? (
                    <button
                      type="button"
                      onClick={() => void send(m)}
                      title="Envoi impossible : touchez pour réessayer"
                      className={`rounded-[1.2rem] px-3.5 py-2 text-left text-[0.92rem] font-semibold break-words whitespace-pre-wrap ${m.mine ? "rounded-br-md bg-[linear-gradient(135deg,#88CBF5,#B5A0E9)] text-white" : "rounded-bl-md bg-cream-deep text-ink"} ${m.pending ? "opacity-60" : ""} ${m.failed ? "ring-2 ring-peach-deep" : ""}`}
                  
                    >
                      {m.body}
                    </button>
                  ) : (
                    <div title={new Date(m.createdAt).toLocaleString()} className={`rounded-[1.2rem] px-3.5 py-2 text-left text-[0.92rem] font-semibold break-words whitespace-pre-wrap ${m.mine ? "rounded-br-md bg-[linear-gradient(135deg,#88CBF5,#B5A0E9)] text-white" : "rounded-bl-md bg-cream-deep text-ink"} ${m.pending ? "opacity-60" : ""} ${m.failed ? "ring-2 ring-peach-deep" : ""}`}
                  >
                      <RichText text={m.body} people={people} />
                    </div>
                  )}
                  {m.failed && <span className="mt-0.5 text-[0.7rem] font-bold text-peach-deep">Non envoyé · touchez pour réessayer</span>}
                </div>
              </motion.div>
            );
          })
        )}
        <AnimatePresence>
          {typing.length > 0 && (
            <motion.div key="typing" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2 pl-9">
              <span className="rounded-[1.2rem] rounded-bl-md bg-cream-deep px-3.5 py-2.5">
                <TypingDots />
              </span>
              <span className="text-[0.74rem] font-bold text-ink-faint">{typing.length === 1 ? `${typing[0]} écrit…` : `${typing.slice(0, 2).join(" et ")} écrivent…`}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {error && <p className="px-4 pb-1 text-[0.8rem] font-bold text-peach-deep">{error}</p>}
      <form
        className="flex items-center gap-2 border-t border-black/5 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          data-focusable
          data-autofocus
          value={text}
          maxLength={1000}
          onChange={(e) => onType(e.target.value)}
          placeholder={`Message à ${group.name}`}
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
          <Icon name="chevronRight" size="1.2em" />
        </button>
      </form>
    </div>
  );
}

/** Volet des membres : renommer, ajouter des amis, quitter le groupe. */
function MembersPanel({ group, onLeft, onClose }: { group: ChatGroup; onLeft: () => void; onClose: () => void }) {
  const selfId = useInetbox((s) => s.user?.id);
  const friends = useInetbox((s) => s.friends);
  const { upsert, remove } = useGroups();
  const [name, setName] = useState(group.name);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addable = friends.filter((f) => !group.members.some((m) => m.id === f.id)).sort((a, b) => a.displayName.localeCompare(b.displayName));
  const room = GROUP_MAX_MEMBERS - group.members.length;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      sound.play("error");
      setError(errorText(e, "Action impossible."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={TWEEN.fast}
      className="mx-4 mb-2 max-h-[55%] shrink-0 overflow-y-auto rounded-2xl bg-cream-deep/70 p-3"
    >
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || name.trim() === group.name) return;
          void run(async () => {
            upsert(await call<ChatGroup>("renameGroup", { name: name.trim() }, group.id));
            saved();
          });
        }}
      >
        <input
          data-focusable
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          aria-label="Nom du groupe"
          className="ibox-focusable h-9 min-w-0 flex-1 rounded-full bg-white px-3.5 text-[0.88rem] font-bold text-ink [--ring-radius:999px]"
        />
        <button
          data-focusable
          type="submit"
          disabled={busy || !name.trim() || name.trim() === group.name}
          className="ibox-focusable h-9 rounded-full bg-white px-3.5 text-[0.82rem] font-bold text-ink [--ring-radius:999px] disabled:opacity-45"
        >
          Renommer
        </button>
      </form>

      <ul className="mt-3 space-y-1">
        {group.members.map((m) => (
          <li key={m.id} className="flex items-center gap-2.5 px-1 py-1">
            <PlayerLink player={{ id: m.id, name: m.displayName, avatar: m.avatar ?? null }} className="shrink-0">
              <Avatar size={30} choice={m.avatar ?? null} name={m.displayName} />
            </PlayerLink>
            <span data-no-i18n className="min-w-0 flex-1 truncate text-[0.88rem] font-bold text-ink">
              <PlayerLink player={{ id: m.id, name: m.displayName, avatar: m.avatar ?? null }} className="!rounded-md hover:underline">{m.displayName}</PlayerLink>
            </span>
            {m.id === selfId && <span className="text-[0.72rem] font-bold text-ink-faint">Vous</span>}
            {m.id === group.createdBy && m.id !== selfId && <span className="text-[0.72rem] font-bold text-ink-faint">Créateur</span>}
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="mt-3">
          <FriendPicker friends={addable} picked={picked} room={room} onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} />
          <div className="mt-2 flex gap-2">
            <button
              data-focusable
              disabled={busy || picked.length === 0}
              onClick={() =>
                void run(async () => {
                  upsert(await call<ChatGroup>("addGroupMembers", { memberIds: picked }, group.id));
                  sound.play("confirm");
                  setPicked([]);
                  setAdding(false);
                })
              }
              className="ibox-focusable h-9 flex-1 rounded-full bg-[linear-gradient(135deg,#88CBF5,#B5A0E9)] text-[0.84rem] font-bold text-white [--ring-radius:999px] disabled:opacity-45"
            >
              {picked.length > 1 ? `Ajouter ${picked.length} amis` : "Ajouter"}
            </button>
            <button data-focusable onClick={() => setAdding(false)} className="ibox-focusable h-9 rounded-full bg-white px-4 text-[0.84rem] font-bold text-ink [--ring-radius:999px]">
              Annuler
            </button>
          </div>
        </div>
      ) : confirmLeave ? (
        <div className="mt-3 rounded-xl bg-white p-3">
          <p className="text-[0.86rem] font-bold text-ink">Quitter le groupe ?</p>
          <p className="text-[0.78rem] font-semibold text-ink-soft">Vous ne recevrez plus ses messages. Un membre pourra vous y ajouter de nouveau.</p>
          <div className="mt-2 flex gap-2">
            <button
              data-focusable
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await call("leaveGroup", undefined, group.id);
                  sound.play("delete");
                  remove(group.id);
                  onLeft();
                })
              }
              className="ibox-focusable h-9 flex-1 rounded-full bg-peach-deep text-[0.84rem] font-bold text-white [--ring-radius:999px]"
            >
              Quitter
            </button>
            <button data-focusable onClick={() => setConfirmLeave(false)} className="ibox-focusable h-9 rounded-full bg-cream-deep px-4 text-[0.84rem] font-bold text-ink [--ring-radius:999px]">
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {room > 0 && addable.length > 0 && (
            <button data-focusable onClick={() => setAdding(true)} className="ibox-focusable flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-[0.82rem] font-bold text-ink [--ring-radius:999px]">
              <Icon name="plus" size="0.95em" />
              Ajouter des amis
            </button>
          )}
          <button data-focusable onClick={() => setConfirmLeave(true)} className="ibox-focusable flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-[0.82rem] font-bold text-peach-deep [--ring-radius:999px]">
            <Icon name="x" size="0.95em" />
            Quitter le groupe
          </button>
          <button data-focusable onClick={onClose} className="ibox-focusable ml-auto flex h-9 items-center rounded-full px-3 text-[0.82rem] font-bold text-ink-soft [--ring-radius:999px]">
            Fermer
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-[0.8rem] font-bold text-peach-deep">{error}</p>}
    </motion.div>
  );
}
