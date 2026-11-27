import { compat } from "@/theme/cssCompat";
import { interfaceAsleep } from "@/services/performance";
import { SPRING, TWEEN } from "@/motion/tokens";
import { invoke } from "@tauri-apps/api/core";
import { useLauncher } from "@/services/launcher";
import { useMediaUrl } from "@/art/useMediaUrl";
import { CoverImage } from "@/components/game/CoverImage";
import type { Game } from "@/domain/types";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useSettings } from "@/services/settings";
import { Avatar } from "@/components/profile/Avatar";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { input } from "@/input/InputController";
import { useReducedMotion } from "@/app/shellState";
import { useInetbox, type GameInvite, type InetFriend } from "@/services/inetbox";
import { useLastPlayed } from "@/components/profile/LastPlayed";
import { useLibrary } from "@/services/library";
import { useNav } from "@/app/navigation";
import { getPlatform } from "@/domain/platforms";
import { DoNotDisturbToggle, PresencePicker, GameShareToggle, StatusDot, STATUS_COLOR, friendState } from "@/components/social/Presence";
import { sound } from "@/services/sound";
import { ActivityView, ChatView, LibraryShareToggle, ProfileView } from "@/components/social/FriendViews";
import { GroupAvatar, GroupChatView, GroupRow, NewGroupView } from "@/components/social/GroupViews";
import { useGroups } from "@/services/groups";
import type { FriendsTarget } from "@/services/social";

type View = "list" | "add" | "requests" | "activity" | "chat" | "profile" | "newGroup" | "group";

const NO_FRIENDS: InetFriend[] = [];

/** Pastille « Amis » de la barre du haut et son panneau latéral. */
export function FriendsButton() {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<FriendsTarget | null>(null);
  const bell = useRef<HTMLButtonElement>(null);
  const incoming = useInetbox((s) => s.invitations.filter((i) => !i.outgoing).length + s.unread.reduce((n, u) => n + u.unread, 0));
  const onlineCount = useInetbox((s) => (s.status === "online" ? s.friends.filter((f) => f.status !== "offline").length : 0));
  // aperçu : les visages des amis (en ligne d'abord, puis favoris), le reste en « +N »
  const friends = useInetbox((s) => (s.status === "online" ? s.friends : NO_FRIENDS));
  const ranked = [...friends].sort((a, b) => Number(b.status !== "offline") - Number(a.status !== "offline") || Number(!!b.favorite) - Number(!!a.favorite));
  const shown = ranked.slice(0, 4);
  const extra = ranked.length - shown.length;

  // « Social » dans le menu de l'icône de notification
  useEffect(() => {
    const onOpen = (e: Event) => {
      setTarget((e as CustomEvent<FriendsTarget | undefined>).detail ?? null);
      setOpen(true);
    };
    window.addEventListener("ibox:open-friends", onOpen);
    return () => window.removeEventListener("ibox:open-friends", onOpen);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => bell.current && input.focus(bell.current, { instant: true }));
  }, []);
  // Le panneau se retire d'abord, puis la fenêtre du compte s'ouvre par-dessus l'écran
  const openAccount = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => useInetbox.getState().show(), 320);
  }, []);

  return (
    <>
      <button
        ref={bell}
        data-focusable
        aria-expanded={open}
        aria-label={`Amis${onlineCount ? `, ${onlineCount} en ligne` : ""}${incoming ? `, ${incoming} invitation${incoming > 1 ? "s" : ""}` : ""}`}
        onClick={() => {
          sound.play(open ? "close" : "friends");
          if (!open) setTarget(null);
          setOpen((v) => !v);
        }}
        className={`ibox-focusable ibox-lift relative flex h-12 items-center gap-2 rounded-full ibox-chip tone-green [--ring-radius:999px] ${shown.length ? (extra > 0 ? "pr-1.5 pl-3.5" : "px-1.5") : "px-4"}`}
      >
        {shown.length > 0 ? (
          <>
            {extra > 0 && <span className="font-display text-[1.05rem] font-bold text-ink tabular-nums">+{extra}</span>}
            {/* visages opaques cerclés : qu'ils se recouvrent un peu sans se mélanger */}
            <span className="flex items-center">
              {shown.map((f, i) => (
                <span
                  key={f.id}
                  className="relative isolate shrink-0 rounded-full bg-[var(--ibox-white)] ring-[2.5px] ring-[color-mix(in_srgb,var(--tone-green)_70%,var(--ibox-white))]"
                  style={{ marginLeft: i ? -7 : 0, zIndex: shown.length - i }}
                >
                  <Avatar size={36} name={f.displayName} choice={f.avatar ?? null} className={f.status === "offline" ? "grayscale-[0.7] brightness-90" : ""} />
                  {f.status !== "offline" && (
                    <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-[var(--ibox-white)]" style={{ background: STATUS_COLOR[f.status] }} />
                  )}
                </span>
              ))}
            </span>
          </>
        ) : (
          <>
            <FriendsGlyph />
            <span className="text-[0.95rem] font-bold text-ink">Amis</span>
          </>
        )}
        {incoming > 0 && (
          <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#EE8F80] px-1 text-[0.68rem] font-extrabold text-white shadow-xs">
            {incoming}
          </span>
        )}
      </button>
      {createPortal(
        <AnimatePresence>{open && <FriendsDrawer key={`friends-${JSON.stringify(target)}`} target={target} onClose={close} onAccount={openAccount} />}</AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function FriendsDrawer({ onClose, onAccount, target }: { onClose: () => void; onAccount: () => void; target: FriendsTarget | null }) {
  const [view, setView] = useState<View>(target?.view ?? "list");
  const [friendId, setFriendId] = useState<string | null>(target && "friendId" in target ? target.friendId : null);
  const [profileFrom, setProfileFrom] = useState<"list" | "add" | "requests">("list");
  const friend = useInetbox((s) => s.friends.find((f) => f.id === friendId));
  const [groupId, setGroupId] = useState<string | null>(null);
  const group = useGroups((s) => s.groups.find((g) => g.id === groupId));
  const selfId = useInetbox((s) => s.user?.id);
  const invitation = useInetbox((s) => s.invitations.find((i) => i.id === friendId));
  const reduced = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const social = useInetbox();
  const connected = social.status === "online";
  const incoming = social.invitations.filter((i) => !i.outgoing);

  useEffect(() => {
    void useInetbox.getState().refresh();
  }, []);

  // groupes : relus à l'ouverture puis toutes les 15 s tant que le panneau est ouvert
  useEffect(() => {
    if (!social.user) return;
    void useGroups.getState().load();
    // pendant une partie (interface en veille) : rien, la relecture reprend au retour
    const t = window.setInterval(() => !interfaceAsleep() && void useGroups.getState().load(), 15000);
    return () => window.clearInterval(t);
  }, [social.user?.id]);

  // Retour : d'abord revenir à la liste, puis fermer
  useEffect(() => {
    const off = input.onBack(() => {
      if (view === "chat" && friend) setView("profile");
      else if (view === "group" || view === "newGroup") setView("list");
      else if (view !== "list") setView(view === "profile" ? profileFrom : "list");
      else onClose();
      return true;
    });
    return off;
  }, [onClose, view, friend, profileFrom]);

  // Le focus entre dans le panneau à chaque changement de vue
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const first = panel.current?.querySelector<HTMLElement>("[data-autofocus],[data-focusable]");
      if (first) input.focus(first, { instant: true });
    });
    return () => cancelAnimationFrame(id);
  }, [view, friendId, social.user?.id]);

  const go = (v: View, id?: string) => {
    if (v === "group") setGroupId(id ?? null);
    else if (id !== undefined) setFriendId(id);
    if (v === "profile" && view !== "chat") setProfileFrom(view === "add" || view === "requests" ? view : "list");
    sound.play(v === "list" ? "back" : "open");
    // chaque vue repart sans le message de l'action précédente
    useInetbox.setState({ message: null, error: null });
    setView(v);
  };

  return (
    <div className="fixed inset-0 z-[70]">
      <motion.div
        aria-hidden
        className="absolute inset-0 bg-[#1b2030]/25 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Amis"
        data-nav-root
        data-nav-group="friends"
        initial={{ x: reduced ? 0 : "105%", opacity: reduced ? 0 : 1 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: reduced ? 0 : "105%", opacity: reduced ? 0 : 1 }}
        transition={SPRING.snappy}
        className="ibox-friends-panel absolute top-3 right-3 bottom-3 flex w-[min(27rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[1.8rem] bg-white/94 shadow-[0_24px_60px_-20px_rgba(30,40,70,0.5)] ring-1 ring-white/70 backdrop-blur-xl"
      >
        <header className="flex items-center gap-2 px-5 pt-5 pb-3">
          {view !== "list" ? (
            <RoundIcon icon="back" label="Retour" onClick={() => go(view === "chat" && friend ? "profile" : view === "profile" ? profileFrom : "list")} />
          ) : (
            <span className="grid size-10 place-items-center text-ink">
              <FriendsGlyph size={24} />
            </span>
          )}
          {view === "group" && group ? (
            <h2 data-no-i18n className="flex min-w-0 flex-1 items-center gap-2 truncate font-display text-[1.3rem] font-semibold text-ink">
              <GroupAvatar members={group.members} selfId={selfId} size={32} />
              <span className="truncate">{group.name}</span>
            </h2>
          ) : (view === "chat" || view === "profile") && friend ? (
            <h2 data-no-i18n className="flex min-w-0 flex-1 items-center gap-2 truncate font-display text-[1.3rem] font-semibold text-ink">
              {view === "chat" && <Avatar size={30} choice={friend.avatar ?? null} name={friend.displayName} />}
              <span className="truncate">{friend.displayName}</span>
            </h2>
          ) : (
            <h2 className="flex-1 font-display text-[1.45rem] font-semibold text-ink">
              {view === "newGroup" ? "Nouveau groupe" : view === "add" ? "Ajouter un ami" : view === "requests" ? "Invitations" : view === "activity" ? "Activité" : view === "profile" ? "Profil" : "Amis"}
            </h2>
          )}
          {social.user && view === "list" && <RoundIcon icon="gear" label="Mon compte iNetbox" onClick={onAccount} />}
          <RoundIcon icon="x" label="Fermer" onClick={onClose} />
        </header>

        {!social.user ? (
          <SignedOut onJoin={onAccount} />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={view}
              initial={{ opacity: 0, x: reduced ? 0 : view === "list" ? -18 : 18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={TWEEN.fast}
              className="flex min-h-0 flex-1 flex-col"
            >
              {(view === "list" || (view === "chat" && !friend) || (view === "group" && !group)) && (
                <ListView connected={connected} incoming={incoming.length} onAdd={() => go("add")} onRequests={() => go("requests")}
                  onActivity={() => go("activity")} onProfile={(id) => go("profile", id)} onChat={(id) => go("chat", id)}
                  onNewGroup={() => go("newGroup")} onGroup={(id) => go("group", id)} />
              )}
              {view === "newGroup" && <NewGroupView onCreated={(id) => go("group", id)} />}
              {view === "group" && group && <GroupChatView key={group.id} group={group} onLeft={() => go("list")} />}
              {view === "add" && <AddView onProfile={(id) => go("profile", id)} />}
              {view === "requests" && <RequestsView onProfile={(id) => go("profile", id)} />}
              {view === "activity" && <ActivityView />}
              {view === "profile" && friendId && (friend || invitation?.publicProfile) && <ProfileView key={`${friendId}-${!!friend}`} id={friendId} friend={friend} onChat={() => go("chat")} />}
              {view === "profile" && !friend && !invitation?.publicProfile && <p className="px-5 py-4 text-sm text-ink-soft">Ce profil est privé ou indisponible.</p>}
              {view === "chat" && friend && <ChatView friend={friend} />}
            </motion.div>
          </AnimatePresence>
        )}

        {social.status === "offline" && (
          <div className="mx-4 mb-4 flex items-center gap-3 rounded-2xl bg-cream-deep px-4 py-3">
            <span className="size-2.5 rounded-full" style={{ background: STATUS_COLOR.away }} />
            <span className="flex-1 text-[0.88rem] font-bold text-ink">Hors connexion</span>
            <RoundIcon icon="reset" label="Réessayer" onClick={() => void (social.user ? social.refresh() : social.restore())} />
          </div>
        )}
      </motion.aside>
    </div>
  );
}

// ——— Vues ———

function ListView({ connected, incoming, onAdd, onRequests, onActivity, onProfile, onChat, onNewGroup, onGroup }: {
  connected: boolean; incoming: number; onAdd: () => void; onRequests: () => void; onActivity: () => void; onProfile: (id: string) => void; onChat: (id: string) => void;
  onNewGroup: () => void; onGroup: (id: string) => void;
}) {
  const groups = useGroups((s) => s.groups);
  const groupsSupported = useGroups((s) => s.supported);
  const social = useInetbox();
  const avatar = useSettings((s) => s.profileAvatar);
  const me = social.user!;
  const sorted = [...social.friends].sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite));
  const favorites = sorted.filter((f) => f.favorite);
  const rest = sorted.filter((f) => !f.favorite);
  const online = connected ? rest.filter((f) => f.status !== "offline") : [];
  const offline = connected ? rest.filter((f) => f.status === "offline") : rest;
  const row = (f: InetFriend) => (
    <FriendRow key={f.id} friend={f} connected={connected} open={opened === f.id} onToggle={() => setOpened(opened === f.id ? null : f.id)}
      onProfile={() => onProfile(f.id)} onChat={() => onChat(f.id)} />
  );
  const [opened, setOpened] = useState<string | null>(null);
  const dnd = useSettings((s) => !!s.doNotDisturb);
  const visible = connected && me.privacy.shareOnline;

  return (
    <>
      {/* moi : statut en un geste */}
      <div className="ibox-light-surface relative isolate mx-4 overflow-hidden rounded-[1.6rem] bg-gradient-to-br from-[#EEF1FF] via-[#F6E9FF] to-[#FFEFE6] p-4 shadow-[0_12px_30px_-18px_rgba(30,40,70,0.6)]">
        <MyScenery />
        <div className="flex items-center gap-3.5">
          <span className="relative shrink-0 rounded-full p-[3px] shadow-md" style={{ background: "linear-gradient(140deg, #ffffff, var(--accent))" }}>
            <Avatar size={58} name={me.displayName} choice={avatar} />
            <StatusDot size={16} color={!visible ? STATUS_COLOR.offline : dnd ? STATUS_COLOR.away : STATUS_COLOR.online} />
          </span>
          <div className="min-w-0 flex-1">
            <div data-no-i18n className="truncate font-display text-[1.3rem] leading-tight text-ink drop-shadow-[0_1px_0_rgba(255,255,255,0.7)]">{me.displayName}</div>
            <div data-no-i18n className="truncate text-[0.74rem] font-bold text-ink-faint">@{me.username}</div>
            <div className="mt-0.5 inline-flex items-center gap-1.5 rounded-full bg-white/75 px-2 py-0.5 text-[0.72rem] font-extrabold text-ink-soft shadow-xs">
              <span className="size-2 rounded-full" style={{ background: !visible ? STATUS_COLOR.offline : dnd ? STATUS_COLOR.away : STATUS_COLOR.online }} />
              {!visible ? "Invisible pour vos amis" : dnd ? "En ligne · ne pas déranger" : "En ligne · visible par vos amis"}
            </div>
          </div>
        </div>
        <MyGame />
        <div className="mt-3 rounded-[1.3rem] bg-white/72 p-2 shadow-xs ring-1 ring-white/80 backdrop-blur-md">
          <PresencePicker wide />
          <div className={`mt-2 grid gap-2 ${social.socialSupported ? "grid-cols-3" : "grid-cols-2"}`}>
            <GameShareToggle tile />
            <LibraryShareToggle tile />
            <DoNotDisturbToggle tile />
          </div>
        </div>
      </div>

      {/* raccourcis, façon menu de console : grands boutons ronds */}
      <div data-nav-group="friends-actions" className={`mx-4 mt-3 grid gap-1 rounded-[1.4rem] bg-cream-deep/60 px-2 py-2.5 ${["grid-cols-2", "grid-cols-3", "grid-cols-4"][(social.socialSupported ? 1 : 0) + (groupsSupported ? 1 : 0)]}`}>
        <BigAction icon="plus" label="Ajouter" tint="var(--tone-green)" onClick={onAdd} autoFocus />
        <BigAction icon="sparkle" label="Invitations" tint="var(--tone-orange)" badge={incoming} onClick={onRequests} />
        {social.socialSupported && <BigAction icon="clock" label="Activité" tint="var(--tone-purple)" onClick={onActivity} />}
        {groupsSupported && <BigAction icon="chat" label="Groupe" tint="var(--tone-blue)" onClick={onNewGroup} />}
      </div>

      {social.gameInvites.length > 0 && <GameInvites invites={social.gameInvites} />}

      <div data-nav-group="friends-list" className="mt-4 min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {social.friends.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center">
            <div className="flex -space-x-3">
              {[0, 1, 2].map((i) => (
                <span key={i} className="grid size-11 place-items-center rounded-full border-[3px] border-white bg-cream-deep text-ink-faint">
                  <Icon name="user" size="1.1em" />
                </span>
              ))}
            </div>
            <p className="mt-3 text-[0.95rem] font-bold text-ink">Aucun ami pour l'instant</p>
            <button data-focusable onClick={onAdd} className="ibox-focusable mt-1 text-[0.88rem] font-bold text-accent-text [--ring-radius:999px]">
              Ajouter un ami
            </button>
          </div>
        ) : (
          <>
            {groups.length > 0 && <Group label="Groupes" count={groups.length} />}
            {groups.map((g) => <GroupRow key={g.id} group={g} onOpen={() => onGroup(g.id)} />)}
            {favorites.length > 0 && <Group label="Favoris" count={favorites.length} />}
            {favorites.map(row)}
            {online.length > 0 && <Group label="En ligne" count={online.length} />}
            {online.map(row)}
            {offline.length > 0 && <Group label="Hors ligne" count={offline.length} />}
            {offline.map(row)}
          </>
        )}
      </div>
    </>
  );
}

function FriendRow({ friend, connected, open, onToggle, onProfile, onChat }: {
  friend: InetFriend; connected: boolean; open: boolean; onToggle: () => void; onProfile: () => void; onChat: () => void;
}) {
  const act = useInetbox((s) => s.act);
  const busy = useInetbox((s) => s.busy);
  const social = useInetbox((s) => s.socialSupported);
  const unread = useInetbox((s) => s.unread.find((u) => u.friendId === friend.id)?.unread ?? 0);
  const [confirm, setConfirm] = useState<"remove" | "block" | null>(null);
  useEffect(() => { if (!open) setConfirm(null); }, [open]);
  const st = friendState(friend, connected);
  const faded = st.key === "offline";
  return (
    <div className={`my-1 rounded-2xl transition-colors ${open ? "bg-cream-deep" : ""}`}>
      <button
        data-focusable
        aria-expanded={open}
        onClick={() => {
          sound.play("select");
          onToggle();
        }}
        className="ibox-focusable relative isolate flex w-full items-center gap-3 overflow-hidden rounded-2xl px-2 py-2 text-left hover:bg-cream-deep/60 [--ring-radius:1rem]"
      >
        {friend.gameTitle && <FriendScenery title={friend.gameTitle} platformId={friend.platformId} />}
        <span className={`relative shrink-0 ${faded ? "opacity-55 grayscale" : ""}`}>
          <Avatar size={42} name={friend.displayName} choice={friend.avatar ?? null} />
          <StatusDot color={STATUS_COLOR[st.key]} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`flex items-center gap-1 truncate text-[0.98rem] font-bold ${faded ? "text-ink-soft" : "text-ink"}`}>
            <span data-no-i18n className="truncate">{friend.displayName}</span>
            {friend.favorite && <Icon name="star" size="0.85em" filled className="shrink-0 text-[#E9B44C]" />}
          </span>
          <span className="flex items-center gap-1.5 truncate text-[0.8rem] font-semibold" style={{ color: st.key === "playing" ? "#3C8E69" : undefined }}>
            {st.key === "playing" && <Icon name="play" size="0.9em" filled />}
            <span className={st.key === "playing" ? "" : "text-ink-soft"}>{st.label}</span>
          </span>
        </span>
        {unread > 0 && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#88CBF5] px-1 text-[0.7rem] font-extrabold text-white" aria-label={`${unread} message${unread > 1 ? "s" : ""} non lu${unread > 1 ? "s" : ""}`}>{unread}</span>
        )}
        <Icon name="chevronRight" size="1em" className={`text-ink-faint transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={TWEEN.fast}
            className="overflow-hidden"
          >
            {confirm ? (
              <div className="mx-2 mb-2 rounded-2xl bg-white p-3 shadow-xs">
                <p className="text-[0.88rem] font-bold text-ink">
                  {confirm === "remove" ? `Retirer ${friend.displayName} de vos amis ?` : `Bloquer ${friend.displayName} ?`}
                </p>
                <p className="mt-0.5 text-[0.78rem] font-semibold text-ink-soft">
                  {confirm === "remove" ? "Vos messages avec cet ami seront effacés." : "Cette personne ne pourra plus vous inviter."}
                </p>
                <div className="mt-2 flex gap-2">
                  <SmallAction icon="check" label="Confirmer" danger disabled={busy} onClick={() => void act(confirm, undefined, friend.id)} />
                  <SmallAction icon="x" label="Annuler" onClick={() => setConfirm(null)} />
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 px-2 pb-2">
                {social && <SmallAction icon="user" label="Profil" onClick={onProfile} />}
                {social && <SmallAction icon="sparkle" label="Message" onClick={onChat} />}
                {!faded && <InviteToPlay friend={friend} />}
                {social && (
                  <SmallAction icon="star" label={friend.favorite ? "Retirer des favoris" : "Favori"} disabled={busy}
                    onClick={() => { sound.play(friend.favorite ? "unfavorite" : "favorite"); void act(friend.favorite ? "unfavorite" : "favorite", undefined, friend.id); }} />
                )}
                <SmallAction icon="x" label="Retirer" disabled={busy} onClick={() => setConfirm("remove")} />
                <SmallAction icon="lock" label="Bloquer" disabled={busy} onClick={() => setConfirm("block")} />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Inviter un ami en ligne à rejoindre votre dernier jeu. */
function InviteToPlay({ friend }: { friend: InetFriend }) {
  const act = useInetbox((s) => s.act);
  const busy = useInetbox((s) => s.busy);
  const last = useLastPlayed();
  // serveur iNetbox pas encore mis à jour : pas de bouton qui ne mènerait à rien
  const supported = useInetbox((s) => s.gameInvitesSupported);
  if (!last || !supported) return null;
  return (
    <SmallAction
      icon="play"
      label={`Inviter à ${last.title.length > 22 ? `${last.title.slice(0, 21)}…` : last.title}`}
      disabled={busy}
      onClick={() => {
        sound.play("select");
        void act("gameInvite", { friendId: friend.id, game: { title: last.title.slice(0, 160), platformId: last.platformId } });
      }}
    />
  );
}

/** Invitations à jouer reçues : ouvrir le jeu (s'il est dans la bibliothèque) ou ignorer. */
function GameInvites({ invites }: { invites: GameInvite[] }) {
  const act = useInetbox((s) => s.act);
  const busy = useInetbox((s) => s.busy);
  const games = useLibrary((s) => s.realGames);
  const go = useNav((s) => s.go);
  return (
    <div data-nav-group="game-invites" className="mx-4 mt-3 flex flex-col gap-2">
      {invites.map((i) => {
        const mine = games.find((g) => g.platformId === i.platformId && g.title.toLowerCase() === i.gameTitle.toLowerCase());
        const platform = getPlatform(i.platformId)?.shortName;
        return (
          <div key={i.id} className="rounded-2xl bg-[var(--accent-soft)] p-3">
            <p className="text-[0.9rem] font-bold text-ink">
              <Icon name="play" size="0.9em" filled className="mr-1 inline text-accent-text" />
              {i.fromName} vous invite à jouer
            </p>
            <p className="truncate text-[0.85rem] font-semibold text-ink-soft">
              {i.gameTitle}
              {platform ? ` · ${platform}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {mine ? (
                <SmallAction
                  icon="open"
                  label="Ouvrir le jeu"
                  onClick={() => {
                    sound.play("select");
                    void act("dismissInvite", undefined, i.id);
                    go({ name: "game", gameId: mine.id });
                  }}
                />
              ) : (
                <span className="self-center text-[0.8rem] font-semibold text-ink-soft">Pas dans votre bibliothèque</span>
              )}
              <SmallAction icon="x" label="Ignorer" disabled={busy} onClick={() => void act("dismissInvite", undefined, i.id)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AddView({ onProfile }: { onProfile: (id: string) => void }) {
  const social = useInetbox();
  const code = social.user!.friendCode;
  const [copied, setCopied] = useState(false);
  const [parts, setParts] = useState(["", "", "", ""]);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const full = parts.join("-");
  const valid = parts.every((p) => /^[0-9A-F]{4}$/.test(p));
  const pending = social.invitations.filter((i) => i.outgoing);

  const setPart = (i: number, raw: string) => {
    const clean = raw.toUpperCase().replace(/[^0-9A-F]/g, "");
    // collage du code entier dans une case
    if (clean.length > 4) {
      const all = clean.slice(0, 16);
      setParts([0, 1, 2, 3].map((k) => all.slice(k * 4, k * 4 + 4)));
      boxes.current[Math.min(3, Math.floor((all.length - 1) / 4))]?.focus();
      return;
    }
    setParts((p) => p.map((v, k) => (k === i ? clean : v)));
    if (clean.length === 4 && i < 3) boxes.current[i + 1]?.focus();
  };

  const send = async () => {
    if (!valid) return;
    const ok = await social.act("invite", { friendCode: full });
    if (ok) {
      sound.play("select");
      setParts(["", "", "", ""]);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
      {/* mon code */}
      <section className="ibox-light-surface rounded-[1.4rem] bg-gradient-to-br from-[#E6F3FD] to-[#EEF1FF] p-4">
        <div className="text-[0.72rem] font-extrabold tracking-[0.14em] text-ink-soft uppercase">Mon code</div>
        <div className="mt-2 flex items-center gap-3">
          <code className="flex-1 font-mono text-[1.25rem] font-bold tracking-[0.06em] text-ink">{code}</code>
          <Button
            variant="primary"
            icon={copied ? "check" : "copy"}
            autoFocusScreen
            onClick={() =>
              void navigator.clipboard
                .writeText(code)
                .then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                })
                .catch(() => useInetbox.setState({ error: "Copie impossible : sélectionnez le code." }))
            }
          >
            {copied ? "Copié" : "Copier"}
          </Button>
        </div>
      </section>

      {/* code d'un ami */}
      <section className="mt-3 rounded-[1.4rem] bg-cream-deep/60 p-4">
        <div className="text-[0.72rem] font-extrabold tracking-[0.14em] text-ink-soft uppercase">Code de votre ami</div>
        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="flex items-center gap-1.5">
            {parts.map((p, i) => (
              <span key={i} className="contents">
                {i > 0 && <span className="text-ink-faint">–</span>}
                <input
                  ref={(el) => {
                    boxes.current[i] = el;
                  }}
                  data-focusable
                  aria-label={`Code de votre ami, partie ${i + 1} sur 4`}
                  value={p}
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="····"
                  onChange={(e) => setPart(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !p && i > 0) boxes.current[i - 1]?.focus();
                  }}
                  className={`ibox-focusable h-12 w-full min-w-0 rounded-xl bg-white text-center font-mono text-[1.05rem] font-bold tracking-[0.08em] text-ink uppercase shadow-xs [--ring-radius:0.75rem] placeholder:text-ink-faint ${p.length === 4 ? "ring-2 ring-[#5DBB8E]/50" : ""}`}
                />
              </span>
            ))}
          </div>
          <Button type="submit" variant="primary" icon="plus" disabled={!valid || social.busy} className="mt-3 w-full">
            {social.busy ? "Envoi…" : "Envoyer l'invitation"}
          </Button>
        </form>
        {social.message && <p className="mt-2 text-center text-[0.85rem] font-bold text-[#3C8E69]">{social.message}</p>}
        {social.error && <p className="mt-2 text-center text-[0.85rem] font-bold text-peach-deep">{social.error}</p>}
      </section>

      {pending.length > 0 && (
        <section className="mt-4">
          <Group label="En attente" count={pending.length} />
          {pending.map((i) => (
            <div key={i.id} className="my-1 flex items-center gap-3 rounded-2xl px-2 py-2">
              <Avatar size={38} name={i.displayName} choice={i.avatar ?? null} />
              <span className="min-w-0 flex-1 truncate text-[0.95rem] font-bold text-ink">{i.displayName}</span>
              {i.publicProfile && <SmallAction icon="user" label="Voir le profil" onClick={() => onProfile(i.id)} />}
              <SmallAction icon="x" label="Annuler" disabled={social.busy} onClick={() => void social.act("remove", undefined, i.id)} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function RequestsView({ onProfile }: { onProfile: (id: string) => void }) {
  const social = useInetbox();
  const incoming = social.invitations.filter((i) => !i.outgoing);
  if (incoming.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-cream-deep text-ink-faint">
          <Icon name="sparkle" size="1.5em" />
        </span>
        <p data-focusable tabIndex={0} className="ibox-focusable mt-3 rounded-lg px-2 text-[0.95rem] font-bold text-ink outline-none">
          Aucune invitation
        </p>
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
      {incoming.map((i) => (
        <motion.div
          key={i.id}
          layout
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="my-2 flex items-center gap-3 rounded-2xl bg-cream-deep/70 p-3"
        >
          <Avatar size={44} name={i.displayName} choice={i.avatar ?? null} />
          <span className="min-w-0 flex-1 truncate text-[1rem] font-bold text-ink">{i.displayName}</span>
          {i.publicProfile && <SmallAction icon="user" label="Voir le profil" onClick={() => onProfile(i.id)} />}
          <button
            data-focusable
            aria-label={`Accepter ${i.displayName}`}
            disabled={social.busy}
            onClick={() => {
              sound.play("select");
              void social.act("accept", undefined, i.id);
            }}
            className="ibox-focusable grid size-11 place-items-center rounded-full bg-[#5DBB8E] text-white shadow-sm [--ring-radius:999px] disabled:opacity-50"
          >
            <Icon name="check" size="1.2em" />
          </button>
          <button
            data-focusable
            aria-label={`Refuser ${i.displayName}`}
            disabled={social.busy}
            onClick={() => void social.act("remove", undefined, i.id)}
            className="ibox-focusable grid size-11 place-items-center rounded-full bg-white text-ink-soft shadow-xs [--ring-radius:999px] disabled:opacity-50"
          >
            <Icon name="x" size="1.15em" />
          </button>
        </motion.div>
      ))}
    </div>
  );
}

function SignedOut({ onJoin }: { onJoin: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 pb-12 text-center">
      <div className="flex -space-x-3">
        {["#BFE3FA", "#E9E1FB", "#FFD9C7"].map((c) => (
          <span key={c} className="grid size-12 place-items-center rounded-full border-[3px] border-white text-ink" style={{ background: c }}>
            <Icon name="user" size="1.15em" />
          </span>
        ))}
      </div>
      <p className="mt-4 text-[1.05rem] font-bold text-ink">Retrouvez vos amis</p>
      <Button variant="primary" icon="user" onClick={onJoin} className="mt-4" autoFocusScreen>
        Rejoindre iNetbox
      </Button>
    </div>
  );
}

// ——— Petits éléments ———

function Group({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-2 pt-3 pb-1 text-[0.7rem] font-extrabold tracking-[0.14em] text-ink-soft uppercase">
      {label}
      <span className="tabular-nums text-ink-faint">{count}</span>
    </div>
  );
}

function BigAction({ icon, label, onClick, badge = 0, autoFocus, tint = "var(--accent)" }: { icon: IconName; label: string; onClick: () => void; badge?: number; autoFocus?: boolean; tint?: string }) {
  return (
    <button
      data-focusable
      data-autofocus={autoFocus || undefined}
      onClick={onClick}
      className="group ibox-focusable relative flex flex-col items-center gap-1.5 rounded-2xl py-1 text-[0.8rem] font-bold text-ink [--ring-radius:1rem]"
    >
      <span className="relative grid size-[3.1rem] place-items-center rounded-full text-white shadow-[0_6px_14px_-6px_rgba(30,40,70,0.55)] ring-[3px] ring-white transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-105"
        style={{ background: compat(`radial-gradient(circle at 30% 25%, color-mix(in oklab, ${tint} 55%, white), color-mix(in oklab, ${tint} 82%, white) 70%)`) }}>
        <Icon name={icon} size="1.35rem" />
        {badge > 0 && (
          <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#E5735F] px-1 text-[0.7rem] font-extrabold text-white ring-2 ring-white">{badge}</span>
        )}
      </span>
      {label}
    </button>
  );
}

function SmallAction({ icon, label, onClick, disabled, danger }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      data-focusable
      disabled={disabled}
      onClick={onClick}
      className={`ibox-focusable flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[0.82rem] font-bold shadow-xs [--ring-radius:999px] disabled:opacity-50 ${danger ? "bg-[#EE8F80] text-white" : "bg-white text-ink"}`}
    >
      <Icon name={icon} size="1em" />
      {label}
    </button>
  );
}

function RoundIcon({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }): ReactNode {
  return (
    <button
      data-focusable
      aria-label={label}
      title={label}
      onClick={onClick}
      className="ibox-focusable grid size-10 shrink-0 place-items-center rounded-full bg-cream-deep text-ink [--ring-radius:999px]"
    >
      <Icon name={icon} size="1.1em" />
    </button>
  );
}

/** Deux silhouettes : pictogramme « amis ». */
function FriendsGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
      <circle cx="16.5" cy="9.5" r="2.6" />
      <path d="M15.5 14.2c2.6-.3 4.6 1.3 5 4.3" />
    </svg>
  );
}

/** Moi en jeu : le jeu lancé depuis iBox, avec son logo (ou sa jaquette). */
function MyGame() {
  const launched = useLauncher((s) => (s.phase === "running" || s.phase === "starting" ? s.current : null));
  // jeu PC lancé par sa boutique (Epic, Steam…) : détecté par iBox
  const [detected, setDetected] = useState<{ gameId: number; title: string } | null>(null);
  useEffect(() => {
    if (launched) return;
    let live = true;
    const check = () => void invoke<[number, string] | null>("pc_running_game").then((r) => live && setDetected(r ? { gameId: r[0], title: r[1] } : null), () => undefined);
    check();
    const t = window.setInterval(() => !interfaceAsleep() && check(), 10000);
    return () => { live = false; window.clearInterval(t); };
  }, [launched]);
  const running = launched ?? detected;
  const game = useLibrary((s) => (running ? s.realGames.find((g) => g.dbId === running.gameId) : undefined));
  if (!running) return null;
  const platform = game ? getPlatform(game.platformId)?.shortName : undefined;
  return (
    <div className="mt-3 flex items-center gap-3 overflow-hidden rounded-2xl bg-[linear-gradient(120deg,#2F7A57,#3C8E69)] p-2.5 pr-4 text-white shadow-sm">
      <span className="grid h-14 w-24 shrink-0 place-items-center overflow-hidden rounded-xl bg-black/20">
        {game ? <MyGameArt game={game} /> : <Icon name="gamepad" size="1.4em" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[0.68rem] font-extrabold tracking-[0.14em] uppercase opacity-90">
          <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-white/70" /><span className="relative inline-flex size-2 rounded-full bg-white" /></span>
          En jeu{platform ? ` · ${platform}` : ""}
        </span>
        <span data-no-i18n className="block truncate font-display text-[1.05rem]">{running.title}</span>
      </span>
    </div>
  );
}
function MyGameArt({ game }: { game: Game }) {
  const logo = useMediaUrl(game, "logo");
  return logo
    ? <img src={logo} alt="" draggable={false} className="max-h-[80%] max-w-[88%] object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)]" />
    : <span className="h-full w-full"><CoverImage game={game} /></span>;
}

/** Fond de la carte « moi » : jeu en cours, sinon jeu mis en avant sur le profil, sinon dernier joué. */
function MyScenery() {
  const featuredId = useSettings((st) => st.profileGame);
  const featured = useLibrary((st) => (featuredId ? st.realGames.find((g) => g.id === featuredId) : undefined));
  const playingId = useLauncher((st) => (st.phase === "running" ? st.current?.gameId : undefined));
  const playing = useLibrary((st) => (playingId !== undefined ? st.realGames.find((g) => g.dbId === playingId) : undefined));
  const last = useLastPlayed();
  const game = playing ?? featured ?? last;
  return game ? <SceneryImage key={game.id} game={game} veil="linear-gradient(100deg, rgba(255,250,244,0.94) 0%, rgba(255,250,244,0.78) 45%, rgba(255,250,244,0.25) 100%)" /> : null;
}

/** Fond d'une ligne d'ami en jeu, si le jeu est aussi dans votre bibliothèque. */
function FriendScenery({ title, platformId }: { title: string; platformId: string | null }) {
  const game = useLibrary((st) => st.realGames.find((g) => g.title.toLowerCase() === title.toLowerCase() && (!platformId || g.platformId === platformId)));
  return game ? <SceneryImage key={game.id} game={game} veil="linear-gradient(90deg, rgba(255,250,244,0.96) 30%, rgba(255,250,244,0.55) 100%)" /> : null;
}

function SceneryImage({ game, veil }: { game: Game; veil: string }) {
  const hero = useMediaUrl(game, "hero");
  if (!hero) return null;
  return (
    <>
      <img src={hero} alt="" aria-hidden draggable={false} className="ibox-kenburns absolute inset-0 -z-10 h-full w-full object-cover" />
      <span aria-hidden className="absolute inset-0 -z-10" style={{ background: veil }} />
    </>
  );
}
