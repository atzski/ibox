import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { padCapture } from "@/input/gamepad";
import { useNav } from "@/app/navigation";
import { remotePlayApi, type GuestProfile, type HostStats, type RemotePlayConfig } from "@/services/remotePlay";
import { attachInputs, attachPad, GuestSession, type GuestStats } from "@/services/remotePlayGuest";
import {
  MAX_PARTY_GUESTS,
  natLabel,
  needsConfirmation,
  onlineApi,
  pathLabel,
  trustLabel,
  useRemotePlayOnline,
  type GuestJoin,
  type IncomingInvite,
  type OnlineStatus,
  type SourceChoice,
  type Sources,
} from "@/services/remotePlayOnline";
import { Avatar } from "@/components/profile/Avatar";
import { notify } from "@/services/notifications";
import { useInetbox, type InetFriend } from "@/services/inetbox";

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : String((e as { message?: string })?.message ?? e));
const fmt = (v: number | null | undefined, digits = 1, unit = "") => (v === null || v === undefined || Number.isNaN(v) ? "—" : `${v.toFixed(digits)}${unit}`);

/** Étiquette « Expérimental » de la fonction. */
export function ExperimentalBadge() {
  return <span className="rounded-full bg-peach-soft px-2 py-0.5 text-[0.7rem] font-extrabold tracking-wide text-ink uppercase">Expérimental</span>;
}

/** Avertissement unique avant la première session P2P. */
function IpWarning({ config, onDone }: { config: RemotePlayConfig; onDone: (c: RemotePlayConfig) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3 rounded-2xl bg-peach-soft/70 p-4 text-ink">
      <p className="font-bold">Avant votre première session Remote Play</p>
      <p className="text-[0.9rem]">
        La connexion est directe entre les deux ordinateurs (pair à pair) : votre ami peut voir votre adresse IP publique, et vous la sienne. iBox
        n'utilise aucun relais. Ne jouez qu'avec des personnes de confiance.
      </p>
      <Button
        variant="primary"
        icon="check"
        disabled={busy}
        autoFocus
        onClick={() => {
          setBusy(true);
          remotePlayApi.setConfig({ ...config, ipWarningSeen: true }).then(onDone, () => setBusy(false));
        }}
      >
        J'ai compris
      </Button>
    </div>
  );
}

function useConfig() {
  const [config, setConfig] = useState<RemotePlayConfig | null>(null);
  useEffect(() => {
    remotePlayApi.config().then(setConfig, () => setConfig(null));
  }, []);
  return [config, setConfig] as const;
}

function NotEnabled({ onClose }: { onClose: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-[0.9rem] text-ink-soft">Remote Play est désactivé. Activez-le dans Paramètres › Remote Play (fonction expérimentale).</p>
      <Button
        variant="primary"
        icon="gear"
        autoFocus
        onClick={() => {
          onClose();
          useNav.getState().go({ name: "settings" });
        }}
      >
        Ouvrir les paramètres
      </Button>
    </div>
  );
}

const PROFILES: { id: GuestProfile; label: string; note: string }[] = [
  { id: "spectator", label: "Spectateur", note: "Regarde seulement : aucune commande." },
  { id: "player", label: "Joueur", note: "Joue avec sa manette sur ce PC." },
  { id: "collaborator", label: "Collaborateur", note: "Clavier et souris sur l'écran partagé (pas sur une fenêtre de jeu)." },
];

/** « Léa », « Léa et Tom », « Léa, Tom et Sam ». */
function namesList(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

/** Formulaire d'invitation (droits, source partagée) pour un ou plusieurs amis. */
function InviteForm({
  config,
  friends,
  defaultProfile = "spectator",
  gameTitle,
  onSent,
  onCancel,
}: {
  config: RemotePlayConfig;
  /** Amis invités ensemble, avec les mêmes droits et la même source. */
  friends: { id: string; name: string }[];
  defaultProfile?: GuestProfile;
  /** Invitation lancée depuis la fiche d'un jeu : propose de le lancer s'il ne tourne pas. */
  gameTitle?: string;
  onSent: (launchGame: boolean) => void;
  onCancel: () => void;
}) {
  const [sources, setSources] = useState<Sources | null>(null);
  const [profile, setProfile] = useState<GuestProfile>(defaultProfile);
  const [source, setSource] = useState<string>("primary");
  const [confirmed, setConfirmed] = useState(false);
  const [launchAfter, setLaunchAfter] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Résultat par ami quand certaines invitations ont échoué. */
  const [results, setResults] = useState<{ name: string; error: string | null }[] | null>(null);
  const many = friends.length > 1;
  const who = namesList(friends.map((f) => f.name));

  useEffect(() => {
    onlineApi.sources().then((s) => {
      setSources(s);
      if (s.game !== null) setSource(`window:${s.game}`);
    }, () => undefined);
  }, []);

  const choice = (): SourceChoice => {
    const [kind, id] = source.split(":");
    return kind === "window" ? { kind: "window", id: Number(id) } : kind === "monitor" ? { kind: "monitor", id: Number(id) } : { kind: "primary" };
  };
  const windowShare = source.startsWith("window:");
  const gameRunning = sources?.game !== null && sources?.game !== undefined;
  const offerLaunch = !!gameTitle && !!sources && !gameRunning;

  // une invitation après l'autre : la première crée la partie, les suivantes la rejoignent
  const send = async () => {
    setBusy(true);
    setError(null);
    const out: { name: string; error: string | null }[] = [];
    for (const f of friends) {
      try {
        await onlineApi.invite(f.id, f.name, profile, choice(), confirmed);
        out.push({ name: f.name, error: null });
      } catch (e) {
        out.push({ name: f.name, error: errText(e) });
      }
    }
    const sent = out.filter((r) => !r.error).length;
    if (sent === out.length) {
      onSent(offerLaunch && launchAfter);
      return;
    }
    if (sent === 0 && !many) {
      setError(out[0].error);
      setBusy(false);
      return;
    }
    // envoi partiel : le détail reste affiché, la partie continue avec ceux qui sont invités
    setResults(out);
    setBusy(false);
  };

  if (results) {
    return (
      <div className="space-y-3">
        <ul className="space-y-1.5">
          {results.map((r) => (
            <li key={r.name} className="flex items-start gap-2 rounded-xl bg-cream-deep px-3 py-2 text-[0.88rem]">
              <span className={`mt-0.5 font-extrabold ${r.error ? "text-peach-deep" : "text-mint-deep"}`}>{r.error ? "×" : "✓"}</span>
              <span className="min-w-0">
                <span data-no-i18n className="font-bold text-ink">
                  {r.name}
                </span>
                <span className="block text-[0.8rem] font-semibold text-ink-soft">{r.error ?? "Invitation envoyée"}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button variant="primary" autoFocus onClick={() => onSent(offerLaunch && launchAfter && results.some((r) => !r.error))}>
            {offerLaunch && launchAfter && results.some((r) => !r.error) ? `Lancer ${gameTitle}` : "Fermer"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-[0.8rem] font-extrabold tracking-wide text-ink-soft uppercase">{many ? "Droits de vos amis" : "Droits de votre ami"}</p>
        <div className="flex flex-wrap gap-2">
          {PROFILES.map((p) => (
            <Button key={p.id} aria-pressed={profile === p.id} variant={profile === p.id ? "primary" : "soft"} onClick={() => setProfile(p.id)} autoFocus={p.id === defaultProfile}>
              {p.label}
            </Button>
          ))}
        </div>
        <p className="text-[0.85rem] text-ink-soft">{PROFILES.find((p) => p.id === profile)?.note}</p>
        {profile !== "spectator" && (
          <p className="text-[0.8rem] text-ink-soft">
            {many
              ? "Chaque manette invitée apparaît sur ce PC comme une manette Xbox de plus, à la suite de la vôtre."
              : "Sa manette apparaît sur ce PC comme une manette Xbox de plus : P2 si vous jouez déjà avec la vôtre."}
          </p>
        )}
        {needsConfirmation(profile) && (
          <label className="flex items-start gap-2 rounded-xl bg-peach-soft/60 p-3 text-[0.85rem] font-semibold text-ink">
            <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>
              {many
                ? `Je confirme : ${who} pourront utiliser le clavier et la souris de ce PC sur l'écran partagé. Raccourci d'arrêt d'urgence : ${config.stopHotkey}.`
                : `Je confirme : ${who} pourra utiliser le clavier et la souris de ce PC sur l'écran partagé. Raccourci d'arrêt d'urgence : ${config.stopHotkey}.`}
            </span>
          </label>
        )}
        {profile === "collaborator" && windowShare && (
          <p className="text-[0.8rem] text-ink-soft">Sur une fenêtre de jeu, sa souris et son clavier restent confinés à cette fenêtre (ignorés quand elle n'est pas au premier plan).</p>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-[0.8rem] font-extrabold tracking-wide text-ink-soft uppercase">Ce qui est partagé</p>
        <select className="ibox-focusable w-full rounded-xl bg-white px-3 py-2 text-ink" value={source} onChange={(e) => setSource(e.target.value)} data-focusable>
          <option value="primary">Écran principal</option>
          {sources?.items.map((s) =>
            s.kind === "monitor" ? (
              <option key={`m${s.id}`} value={`monitor:${s.id}`}>
                {`${s.name} (${s.width}×${s.height})${s.primary ? " — principal" : ""}`}
              </option>
            ) : (
              <option key={`w${s.id}`} value={`window:${s.id}`}>
                {`${s.id === sources.game ? "🎮 " : ""}${s.title}`}
              </option>
            ),
          )}
        </select>
        {sources?.gameTitle && gameRunning && <p className="text-[0.8rem] text-ink-soft">{`Jeu lancé depuis iBox sélectionné : ${sources.gameTitle}`}</p>}
        {offerLaunch && (
          <label className="flex items-start gap-2 rounded-xl bg-cream-deep p-3 text-[0.85rem] font-semibold text-ink">
            <input type="checkbox" className="mt-1" checked={launchAfter} onChange={(e) => setLaunchAfter(e.target.checked)} />
            <span>
              {many
                ? `Lancer ${gameTitle} après l'envoi (l'écran principal est partagé : vos amis voient le jeu dès qu'il démarre)`
                : `Lancer ${gameTitle} après l'envoi (l'écran principal est partagé : votre ami voit le jeu dès qu'il démarre)`}
            </span>
          </label>
        )}
      </div>
      <p className="text-[0.8rem] text-ink-soft">
        {many
          ? `${who} ont chacun 2 minutes pour accepter. Pendant le partage, un indicateur reste affiché en haut de l'écran ; verrouiller Windows coupe la session.`
          : `${who} a 2 minutes pour accepter. Pendant le partage, un indicateur reste affiché en haut de l'écran ; verrouiller Windows coupe la session.`}
      </p>
      {error && <p role="alert" className="text-[0.85rem] font-semibold text-peach-deep">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Annuler</Button>
        <Button variant="primary" icon="play" disabled={busy || (needsConfirmation(profile) && !confirmed)} onClick={() => void send()}>
          {busy ? "Envoi…" : many ? `Inviter les ${friends.length}` : "Inviter"}
        </Button>
      </div>
    </div>
  );
}

/** Étapes préalables : chargement, activation, avertissement IP. */
function Gate({ config, setConfig, onClose, inline }: { config: RemotePlayConfig | null; setConfig: (c: RemotePlayConfig) => void; onClose: () => void; inline?: boolean }) {
  const [busy, setBusy] = useState(false);
  if (!config) return <p className="text-ink-soft">Chargement…</p>;
  if (!config.enabled) {
    if (!inline) return <NotEnabled onClose={onClose} />;
    return (
      <div className="space-y-3">
        <p className="text-[0.9rem] text-ink-soft">
          Remote Play est désactivé. Activé, vos amis iNetbox peuvent voir votre jeu et jouer avec leur manette, directement d'ordinateur à ordinateur.
        </p>
        <Button
          variant="primary"
          icon="check"
          autoFocus
          disabled={busy}
          onClick={() => {
            setBusy(true);
            remotePlayApi.setConfig({ ...config, enabled: true }).then(setConfig, () => setBusy(false));
          }}
        >
          Activer Remote Play
        </Button>
      </div>
    );
  }
  return <IpWarning config={config} onDone={setConfig} />;
}

const isReady = (c: RemotePlayConfig | null): c is RemotePlayConfig => !!c?.enabled && !!c.ipWarningSeen;

/** « Inviter à jouer » depuis le profil d'un ami. */
export function InviteDialog({ friendId, friendName, onClose }: { friendId: string; friendName: string; onClose: () => void }) {
  const [config, setConfig] = useConfig();
  return (
    <Modal title={`Inviter ${friendName} à jouer`} subtitle="Remote Play · expérimental" onClose={onClose}>
      {isReady(config) ? (
        <InviteForm config={config} friends={[{ id: friendId, name: friendName }]} onSent={onClose} onCancel={onClose} />
      ) : (
        <Gate config={config} setConfig={setConfig} onClose={onClose} />
      )}
    </Modal>
  );
}

const STATUS_TEXT = { online: "En ligne", away: "Absent", offline: "Hors ligne" } as const;
const statusRank = (f: InetFriend) => (f.status === "online" ? 0 : f.status === "away" ? 1 : 2);

/** Bouton « Remote Play » d'une fiche de jeu : choisir un ami et l'inviter, sans passer par les paramètres. */
export function RemotePlayGameDialog({ gameTitle, onLaunch, onClose }: { gameTitle: string; onLaunch?: () => void; onClose: () => void }) {
  const [config, setConfig] = useConfig();
  const user = useInetbox((s) => s.user);
  const friends = useInetbox((s) => s.friends);
  const hostStatus = useRemotePlayOnline((s) => (s.status?.role === "host" ? s.status : null));
  // amis cochés, puis formulaire commun (droits, source) pour tous
  const [picked, setPicked] = useState<InetFriend[]>([]);
  const [ready, setReady] = useState(false);
  // partie déjà lancée : ses invités comptent dans la limite et ne sont plus proposés
  // (le natif refuse de toute façon un ami déjà présent ou une partie complète)
  const others = (hostStatus?.players ?? []).filter((p) => p.stage !== "ended" && p.stage !== "failed");
  const inPartyNames = new Set(others.map((p) => p.peerName));
  const room = MAX_PARTY_GUESTS - (hostStatus ? 1 + others.length : 0);
  const sorted = [...friends]
    .filter((f) => f.id !== hostStatus?.peerId && !inPartyNames.has(f.displayName))
    .sort((a, b) => statusRank(a) - statusRank(b) || a.displayName.localeCompare(b.displayName));
  const toggle = (f: InetFriend) =>
    setPicked((p) => (p.some((x) => x.id === f.id) ? p.filter((x) => x.id !== f.id) : p.length >= room ? p : [...p, f]));

  return (
    <Modal title="Remote Play" subtitle={`${gameTitle} · expérimental`} onClose={onClose}>
      {!isReady(config) ? (
        <Gate config={config} setConfig={setConfig} onClose={onClose} inline />
      ) : !user ? (
        <div className="space-y-3">
          <p className="text-[0.9rem] text-ink-soft">Connectez-vous à iNetbox pour inviter un ami à jouer.</p>
          <Button
            variant="primary"
            icon="user"
            autoFocus
            onClick={() => {
              onClose();
              useNav.getState().go({ name: "settings" });
            }}
          >
            Ouvrir les paramètres
          </Button>
        </div>
      ) : ready && picked.length > 0 ? (
        <div className="space-y-4">
          <button
            data-focusable
            onClick={() => setReady(false)}
            className="ibox-focusable flex max-w-full items-center gap-2 rounded-full bg-cream-deep py-1 pr-3 pl-1 text-[0.85rem] font-bold text-ink [--ring-radius:999px]"
          >
            <span className="flex shrink-0 -space-x-2">
              {picked.slice(0, 5).map((f) => (
                <span key={f.id} className="rounded-full ring-2 ring-cream-deep">
                  <Avatar size={28} choice={f.avatar ?? null} name={f.displayName} />
                </span>
              ))}
            </span>
            <span data-no-i18n className="min-w-0 truncate">
              {namesList(picked.map((f) => f.displayName))}
            </span>
            <span className="shrink-0 text-ink-soft">· Changer</span>
          </button>
          <InviteForm
            config={config}
            friends={picked.map((f) => ({ id: f.id, name: f.displayName }))}
            defaultProfile="player"
            gameTitle={onLaunch ? gameTitle : undefined}
            onCancel={onClose}
            onSent={(launch) => {
              onClose();
              if (launch) onLaunch?.();
            }}
          />
        </div>
      ) : sorted.length === 0 ? (
        <p className="text-[0.9rem] text-ink-soft">Ajoutez d'abord un ami sur iNetbox pour jouer ensemble à distance.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[0.8rem] font-extrabold tracking-wide text-ink-soft uppercase">Inviter des amis</p>
            <p className="text-[0.78rem] font-semibold text-ink-soft">
              {room > 1 ? `Jusqu'à ${room} amis à la fois` : room === 1 ? "Encore 1 place dans la partie" : "La partie est complète"}
            </p>
          </div>
          <div className="grid max-h-[50vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {sorted.map((f, i) => {
              const on = picked.some((x) => x.id === f.id);
              const full = !on && picked.length >= room;
              return (
                <button
                  key={f.id}
                  data-focusable
                  autoFocus={i === 0}
                  role="checkbox"
                  aria-checked={on}
                  disabled={full}
                  onClick={() => toggle(f)}
                  className={`ibox-focusable flex items-center gap-3 rounded-2xl p-2.5 text-left transition-colors disabled:opacity-45 ${
                    on ? "bg-accent-soft ring-2 ring-accent" : "bg-cream-deep hover:bg-white"
                  }`}
                >
                  <Avatar size={40} choice={f.avatar ?? null} name={f.displayName} />
                  <span className="min-w-0 flex-1">
                    <span data-no-i18n className="block truncate font-bold text-ink">{f.displayName}</span>
                    <span className={`block text-[0.78rem] font-semibold ${f.status === "online" ? "text-mint-deep" : "text-ink-soft"}`}>{STATUS_TEXT[f.status]}</span>
                  </span>
                  <span
                    aria-hidden
                    className={`grid size-6 shrink-0 place-items-center rounded-full text-[0.8rem] font-extrabold transition-colors ${
                      on ? "bg-accent text-on-accent" : "bg-white/70 text-transparent ring-1 ring-ink/15"
                    }`}
                  >
                    ✓
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-end gap-2">
            {picked.length > 0 && (
              <Button variant="ghost" onClick={() => setPicked([])}>
                Tout décocher
              </Button>
            )}
            <Button variant="primary" icon="chevronRight" disabled={picked.length === 0} onClick={() => setReady(true)}>
              {picked.length === 0 ? "Choisissez des amis" : picked.length === 1 ? "Continuer avec 1 ami" : `Continuer avec ${picked.length} amis`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Invitation reçue : Accepter / Refuser. */
function IncomingDialog({ invite, onJoin }: { invite: IncomingInvite; onJoin: (j: GuestJoin) => void }) {
  const [config, setConfig] = useConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => useRemotePlayOnline.getState().setOpen(null);
  const accept = () => {
    setBusy(true);
    setError(null);
    onlineApi.accept(invite.id).then(
      (j) => {
        close();
        onJoin(j);
      },
      (e) => {
        setError(errText(e));
        setBusy(false);
      },
    );
  };
  const decline = () => {
    void onlineApi.decline(invite.id).catch(() => undefined);
    close();
  };
  return (
    <Modal title={`${invite.fromName} vous invite`} subtitle="Remote Play · expérimental" onClose={close}>
      {!config ? (
        <p className="text-ink-soft">Chargement…</p>
      ) : !config.enabled ? (
        <NotEnabled onClose={close} />
      ) : !config.ipWarningSeen ? (
        <IpWarning config={config} onDone={setConfig} />
      ) : (
        <div className="space-y-4">
          <p className="text-ink">{invite.mode === "play" ? "à jouer sur son ordinateur, avec votre manette." : "à regarder son écran."}</p>
          <p className="text-[0.85rem] text-ink-soft">L'image vient directement de son PC. Vous pourrez quitter à tout moment ; il peut aussi tout arrêter.</p>
          {busy && <p className="text-[0.85rem] font-semibold text-ink-soft">Connexion sécurisée en cours…</p>}
          {error && <p role="alert" className="text-[0.85rem] font-semibold text-[#B4232C]">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button icon="close" onClick={decline} disabled={busy}>
              Refuser
            </Button>
            <Button variant="primary" icon="check" onClick={accept} disabled={busy} autoFocus>
              Accepter
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-xl bg-white/10 px-3 py-1 text-[0.78rem]">
      <span className="font-semibold opacity-80">{label}</span>
      <span className="font-extrabold tabular-nums">{value}</span>
    </div>
  );
}

function rumble(_pad: number, large: number, small: number) {
  const pad = navigator.getGamepads?.().find((p): p is Gamepad => !!p && p.connected);
  const actuator = (pad as (Gamepad & { vibrationActuator?: { playEffect: (t: string, p: object) => Promise<unknown> } }) | undefined)?.vibrationActuator;
  void actuator?.playEffect("dual-rumble", { duration: 250, strongMagnitude: large / 255, weakMagnitude: small / 255 }).catch(() => undefined);
}

/** Vue de l'invité : image de l'hôte, code de sécurité, commandes, statistiques. */
function GuestView({ join, onLeave }: { join: GuestJoin; onLeave: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const session = useRef<GuestSession | null>(null);
  const detach = useRef<(() => void) | null>(null);
  const [stats, setStats] = useState<GuestStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [controlling, setControlling] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [pad, setPad] = useState<string | null>(null);
  const status = useRemotePlayOnline((s) => s.status);
  const play = join.mode === "play";

  useEffect(() => {
    const s = new GuestSession(video.current!, rumble, join.stunServers);
    session.current = s;
    let connected = false;
    s.pc.addEventListener("connectionstatechange", () => {
      const now = s.pc.connectionState === "connected";
      if (now !== connected) {
        connected = now;
        void onlineApi.guestState(now).catch(() => undefined);
      }
      if (s.pc.connectionState === "failed") setError("Connexion impossible : un pare-feu ou le routeur de l'un de vous bloque la connexion directe (iBox n'utilise aucun relais).");
    });
    void s
      .accept(join.offer, 2500, (c) => void onlineApi.candidates([c]).catch(() => undefined))
      .then((answer) => onlineApi.answer(answer))
      .catch((e) => setError(errText(e)));
    const timer = window.setInterval(() => void s.stats().then(setStats, () => undefined), 1000);
    // en mode Joueur, la manette de l'invité est envoyée d'office, dès qu'elle apparaît
    const detachPad = join.mode === "play" ? attachPad(s, { onPad: setPad, onPadCapture: (a) => (padCapture.active = a) }) : null;
    // la souris aussi, sur l'image seulement (l'hôte la refuse si le profil ne la donne pas)
    const detachMouse = join.mode === "play" && video.current ? attachInputs(s, video.current, { pad: false, keyboard: false }) : null;
    return () => {
      window.clearInterval(timer);
      detachPad?.();
      detachMouse?.();
      detach.current?.();
      detach.current = null;
      padCapture.active = false;
      s.close();
    };
  }, [join]);

  const toggleControl = () => {
    if (detach.current) {
      detach.current();
      detach.current = null;
      setControlling(false);
      return;
    }
    if (!session.current || !video.current) return;
    // manette et souris sont déjà envoyées d'office : seul le clavier (capturé) s'ajoute ici
    detach.current = attachInputs(session.current, video.current, { pad: false, mouse: false });
    setControlling(true);
  };

  const ended = status?.role === "guest" && (status.stage === "ended" || status.stage === "failed");
  // fin décidée par l'hôte (message « bye » ou canal fermé) : retour direct à iBox
  const leaveRef = useRef(onLeave);
  leaveRef.current = onLeave;
  const [hostGone, setHostGone] = useState(false);
  useEffect(() => {
    const s = session.current;
    if (s) s.onHostGone = () => setHostGone(true);
  }, [join]);
  const finished = (status?.role === "guest" && status.stage === "ended") || hostGone;
  useEffect(() => {
    if (!finished) return;
    const name = join.hostName;
    const t = window.setTimeout(() => {
      leaveRef.current();
      notify({ title: "Remote Play", body: `${name} a terminé la session.`, icon: "close", tone: "info" });
    }, 900);
    return () => window.clearTimeout(t);
  }, [finished, join.hostName]);

  return createPortal(
    <div data-nav-root className="fixed inset-0 z-[80] flex flex-col bg-black text-white">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <ExperimentalBadge />
        <span className="font-bold" data-no-i18n>
          {join.hostName}
        </span>
        <span className="text-[0.85rem] opacity-80">{join.mode === "play" ? "Joueur" : "Spectateur"}</span>
        <span className="ml-auto text-[0.8rem] opacity-90">
          Code de sécurité : <b className="font-mono tracking-wider">{join.safetyCode}</b>
        </span>
        <span className="text-[0.75rem] opacity-70">{trustLabel(join.trust)}</span>
      </div>
      <video
        ref={video}
        className="min-h-0 w-full flex-1 bg-black object-contain"
        autoPlay
        playsInline
        muted
        tabIndex={-1}
        onDoubleClick={() => void video.current?.requestFullscreen().catch(() => undefined)}
      />
      {(error || ended) && <p className="px-4 py-2 text-[0.9rem] font-semibold text-[#FFB4B4]">{error ?? status?.error ?? "Session terminée."}</p>}
      {showStats && stats && (
        <div className="grid grid-cols-2 gap-1 px-4 py-2 md:grid-cols-4">
          <Stat label="Connexion" value={stats.state} />
          <Stat label="Images/s" value={fmt(stats.fps, 0)} />
          <Stat label="Débit" value={fmt(stats.bitrateKbps === null ? null : stats.bitrateKbps / 1000, 1, " Mbit/s")} />
          <Stat label="Aller-retour" value={fmt(stats.rttMs, 1, " ms")} />
          <Stat label="Ping des commandes" value={fmt(stats.pingMs, 1, " ms")} />
          <Stat label="Pertes" value={fmt(stats.lossPct, 2, " %")} />
          <Stat label="Tampon de gigue" value={fmt(stats.jitterBufferMs, 1, " ms")} />
          <Stat label="Image" value={stats.resolution ?? "—"} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        {play && !ended && (
          <Button icon="gamepad" onClick={toggleControl}>
            {controlling ? "Rendre le clavier" : "Envoyer mon clavier"}
          </Button>
        )}
        {play && !ended && (
          <span className={`rounded-full px-3 py-1.5 text-[0.8rem] font-bold ${pad ? "bg-[#33B86B]/25 text-[#9BE8B9]" : "bg-white/10 opacity-85"}`}>
            {pad ? (
              <>
                Manette connectée : <span data-no-i18n>{pad.replace(/\s*\(.*\)\s*$/, "")}</span>
              </>
            ) : (
              "Manette : branchez-la et appuyez sur un bouton"
            )}
          </span>
        )}
        <Button icon="front" onClick={() => void video.current?.requestFullscreen().catch(() => undefined)}>
          Plein écran
        </Button>
        <Button icon="search" onClick={() => setShowStats(!showStats)}>
          {showStats ? "Masquer les statistiques" : "Statistiques"}
        </Button>
        <Button variant="primary" icon="close" onClick={onLeave} autoFocus>
          Quitter
        </Button>
      </div>
    </div>,
    document.body,
  );
}

const STAGE: Record<OnlineStatus["stage"], string> = {
  inviting: "En attente de la réponse de votre ami…",
  connecting: "Connexion directe en cours…",
  live: "Partage en cours",
  ended: "Session terminée",
  failed: "Échec de la session",
};

/** Carte de l'hôte (fenêtre principale) : étape, code de sécurité, type de connexion. */
function HostCard({ status }: { status: OnlineStatus }) {
  const [stats, setStats] = useState<HostStats | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [adding, setAdding] = useState(false);
  const players = status.players ?? [];
  const liveStage = (s: OnlineStatus["stage"]) => s !== "ended" && s !== "failed";
  const livePlayers = players.filter((p) => liveStage(p.stage));
  // la partie continue tant qu'un invité (premier ou supplémentaire) est là
  const done = !liveStage(status.stage) && livePlayers.length === 0;
  const guests = (liveStage(status.stage) ? 1 : 0) + livePlayers.length;
  useEffect(() => {
    if (done || hidden) return;
    const timer = window.setInterval(() => void remotePlayApi.hostStats().then(setStats, () => undefined), 1000);
    return () => window.clearInterval(timer);
  }, [done, hidden]);
  // une fin ou un échec réaffiche la carte (message, bouton Fermer)
  useEffect(() => {
    if (done) setHidden(false);
  }, [done]);
  if (hidden && !done) {
    // témoin réduit : un partage ne doit jamais devenir invisible
    return (
      <button
        type="button"
        role="status"
        onClick={() => setHidden(false)}
        title="Afficher"
        className="fixed right-4 bottom-4 z-[70] flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-[0.8rem] font-bold text-ink shadow-xl ring-1 ring-black/5"
      >
        <span className={`h-2.5 w-2.5 rounded-full ${status.stage === "live" ? "animate-pulse bg-[#E5484D]" : "bg-[#F5A524]"}`} />
        <span>Remote Play</span>
        <span data-no-i18n className="max-w-[8rem] truncate font-semibold text-ink-soft">
          {status.peerName}
        </span>
      </button>
    );
  }
  return (
    <div role="status" className="fixed right-4 bottom-4 z-[70] w-[22rem] space-y-2 rounded-2xl bg-white/95 p-3 text-ink shadow-xl ring-1 ring-black/5">
      <div className="flex items-center gap-2">
        <ExperimentalBadge />
        <span className="font-bold">Remote Play</span>
        <span data-no-i18n className="truncate text-ink-soft">
          {status.peerName}
        </span>
      </div>
      <p className="text-[0.9rem] font-semibold">{STAGE[status.stage]}</p>
      {status.error && <p className={`text-[0.85rem] font-semibold ${status.stage === "failed" ? "text-[#B4232C]" : "text-ink-soft"}`}>{status.error}</p>}
      {status.safetyCode && (
        <p className="text-[0.85rem]">
          Code de sécurité : <b className="font-mono tracking-wider">{status.safetyCode}</b>
          <span className="block text-[0.75rem] text-ink-soft">{trustLabel(status.trust)}</span>
        </p>
      )}
      {stats && !done && (
        <p className="text-[0.8rem] text-ink-soft">
          {`Connexion : ${pathLabel(stats.path)}`} · {`IPv4 ${natLabel(stats.natV4)}`}
          {stats.natV6 && <> · {`IPv6 ${natLabel(stats.natV6)}`}</>}
        </p>
      )}
      {open && stats && (
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#1E2233] p-2 text-[0.75rem] text-white">
          <Stat label="Images/s" value={fmt(stats.fps, 0)} />
          <Stat label="Débit" value={fmt(stats.sentKbps / 1000, 1, " Mbit/s")} />
          <Stat label="Aller-retour" value={fmt(stats.rttMs, 1, " ms")} />
          <Stat label="Pertes" value={fmt(stats.lossPct, 2, " %")} />
          <Stat label="Encodeur" value={stats.encoder ?? "—"} />
          <Stat label="Entrées refusées" value={String(stats.inputs.rejected + stats.inputs.denied)} />
        </div>
      )}
      {status.rejected > 0 && <p className="text-[0.75rem] text-[#B4232C]">{`${status.rejected} message(s) de signalisation refusé(s).`}</p>}
      {players.length > 0 && (
        <ul className="space-y-1">
          {players.map((p, i) => (
            <motion.li
              key={p.sessionId}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-2 rounded-xl bg-cream-deep px-2.5 py-1.5 text-[0.82rem]"
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white text-[0.7rem] font-extrabold">{`P${i + 3}`}</span>
              <span data-no-i18n className="min-w-0 flex-1 truncate font-bold">
                {p.peerName}
              </span>
              <span className={`text-[0.75rem] font-semibold ${p.stage === "failed" ? "text-[#B4232C]" : "text-ink-soft"}`}>{STAGE[p.stage]}</span>
            </motion.li>
          ))}
        </ul>
      )}
      {!done && guests > 0 && (
        <p className="text-[0.75rem] font-semibold text-ink-soft">{`${guests + 1} joueurs sur 6 au plus`}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {!done && guests < MAX_PARTY_GUESTS && (
          <Button icon="plus" onClick={() => setAdding(true)}>
            Inviter un ami de plus
          </Button>
        )}
        {!done && (
          <Button icon="search" onClick={() => setOpen(!open)}>
            {open ? "Moins" : "Statistiques"}
          </Button>
        )}
        {!done && (
          <Button icon="minus" onClick={() => setHidden(true)}>
            Masquer
          </Button>
        )}
        <Button
          icon="close"
          variant={done ? "soft" : "primary"}
          onClick={() => (done ? useRemotePlayOnline.setState({ status: null }) : void onlineApi.stop().catch(() => undefined))}
        >
          {done ? "Fermer" : status.stage === "inviting" && livePlayers.length === 0 ? "Annuler l'invitation" : "Terminer"}
        </Button>
      </div>
      {adding && <RemotePlayGameDialog gameTitle={status.source ?? "Écran"} onClose={() => setAdding(false)} />}
    </div>
  );
}

/** Couche globale de la fenêtre principale : invitations reçues, vue invité, carte hôte. */
export function RemotePlayLayer() {
  const open = useRemotePlayOnline((s) => s.open);
  const status = useRemotePlayOnline((s) => s.status);
  const invites = useRemotePlayOnline((s) => s.invites);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!invites.length) return;
    const t = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(t);
  }, [invites.length]);
  const pending = invites.find((i) => i.expiresAt > now) ?? null;
  const [join, setJoin] = useState<GuestJoin | null>(null);
  const leave = () => {
    setJoin(null);
    void onlineApi.stop().catch(() => undefined);
  };
  return (
    <>
      {open && <IncomingDialog invite={open} onJoin={setJoin} />}
      {join && <GuestView join={join} onLeave={leave} />}
      {!join && status?.role === "host" && <HostCard status={status} />}
      {!join && status?.role === "guest" && status.stage === "failed" && (
        <div role="alert" className="fixed right-4 bottom-4 z-[70] w-[22rem] space-y-2 rounded-2xl bg-white/95 p-3 text-ink shadow-xl">
          <p className="font-bold">Remote Play</p>
          <p className="text-[0.85rem] font-semibold text-[#B4232C]">{status.error}</p>
          <Button onClick={() => useRemotePlayOnline.setState({ status: null })}>
            Fermer
          </Button>
        </div>
      )}
      {/* rappel visible même si les notifications sont coupées */}
      {!join && !open && !(status && status.stage !== "ended" && status.stage !== "failed") && pending && (
        <div role="status" className="fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-full bg-white/95 py-1.5 pr-1.5 pl-4 text-ink shadow-xl ring-1 ring-black/5">
          <span className="text-[0.9rem] font-semibold">
            Invitation Remote Play de <b data-no-i18n>{pending.fromName}</b>
          </span>
          <Button variant="primary" onClick={() => useRemotePlayOnline.getState().setOpen(pending)}>
            Répondre
          </Button>
        </div>
      )}
    </>
  );
}
