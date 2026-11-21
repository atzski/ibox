import { SPRING } from "@/motion/tokens";
import { useEffect, useRef, useState } from "react";
import { useRemoteLatency } from "@/components/extras/PerfOverlay";
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
import { Icon } from "@/components/ui/Icon";
import { PadGlyph } from "@/components/shell/PadGlyph";
import { input } from "@/input/InputController";
import { useGamepad } from "@/input/gamepad";
import { useSettings } from "@/services/settings";
import { setFullscreen } from "@/services/native";
import { sound } from "@/services/sound";
import { isLinux } from "@/services/platform";
import { NativeGuestSession } from "@/services/nativeGuest";
import { useScenePause } from "@/services/scenePause";

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

/** Case à cocher iBox : toute la carte se coche (souris, clavier, manette). */
function CheckCard({ checked, onChange, tone = "neutral", children }: { checked: boolean; onChange: (v: boolean) => void; tone?: "neutral" | "warn"; children: React.ReactNode }) {
  const base = tone === "warn" ? "bg-peach-soft/60" : "bg-cream-deep";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      data-focusable
      onClick={() => onChange(!checked)}
      className={`ibox-focusable flex w-full items-start gap-3 rounded-2xl p-3 text-left text-[0.85rem] font-semibold text-ink transition-[background,box-shadow] duration-200 [--ring-radius:1rem] ${base} ${
        checked ? (tone === "warn" ? "ring-2 ring-peach-deep/60" : "ring-2 ring-accent/70") : "hover:brightness-[1.04]"
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 grid size-[1.35rem] shrink-0 place-items-center rounded-[0.45rem] transition-all duration-200 ${
          checked ? (tone === "warn" ? "scale-100 bg-peach-deep text-white" : "scale-100 bg-accent text-on-accent") : "bg-white/80 ring-2 ring-ink/20"
        }`}
      >
        <svg viewBox="0 0 16 16" className={`size-3.5 transition-[opacity,transform] duration-200 ${checked ? "scale-100 opacity-100" : "scale-50 opacity-0"}`} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      </span>
      <span className="min-w-0 leading-snug">{children}</span>
    </button>
  );
}

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
          <CheckCard tone="warn" checked={confirmed} onChange={setConfirmed}>
            <span>
              {many
                ? `Je confirme : ${who} pourront utiliser le clavier et la souris de ce PC sur l'écran partagé. Raccourci d'arrêt d'urgence : ${config.stopHotkey}.`
                : `Je confirme : ${who} pourra utiliser le clavier et la souris de ce PC sur l'écran partagé. Raccourci d'arrêt d'urgence : ${config.stopHotkey}.`}
            </span>
          </CheckCard>
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
          <CheckCard checked={launchAfter} onChange={setLaunchAfter}>
            <span>
              {many
                ? `Lancer ${gameTitle} après l'envoi (l'écran principal est partagé : vos amis voient le jeu dès qu'il démarre)`
                : `Lancer ${gameTitle} après l'envoi (l'écran principal est partagé : votre ami voit le jeu dès qu'il démarre)`}
            </span>
          </CheckCard>
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
          <div className="-m-2 grid max-h-[50vh] gap-2 overflow-y-auto p-2 sm:grid-cols-2">
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
    <div className="flex items-baseline justify-between gap-3 rounded-xl bg-[#fff]/10 px-3 py-1 text-[0.78rem]">
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

/** Qualité de la connexion en un mot et une couleur (pastille du menu). */
function quality(stats: GuestStats | null): { label: string; color: string } {
  if (!stats || stats.state !== "connected") return { label: "Connexion…", color: "#F7C631" };
  const rtt = stats.rttMs ?? 0;
  const loss = stats.lossPct ?? 0;
  if (rtt > 120 || loss > 3) return { label: "Connexion instable", color: "#F0504A" };
  if (rtt > 60 || loss > 1) return { label: "Connexion correcte", color: "#F7C631" };
  return { label: "Excellente connexion", color: "#4FD88A" };
}

/**
 * Vue de l'invité : l'image de l'hôte occupe tout l'écran (iBox passe en plein écran).
 * Une barre discrète apparaît quand la souris bouge ; Échap, Select + Start maintenus
 * ou la touche Guide ouvrent le menu de session (reprendre, clavier, statistiques, quitter).
 */
function GuestView({ join, onLeave }: { join: GuestJoin; onLeave: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(false);
  menuRef.current = menu;
  const [chrome, setChrome] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const { family } = useGamepad();
  const side = useSettings((st) => st.gamepadConfirm);
  // Steam Deck (WebKitGTK, sans WebRTC) : invité natif str0m + WebCodecs dans un canvas
  const native = isLinux();
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<GuestSession | NativeGuestSession | null>(null);
  const detach = useRef<(() => void) | null>(null);
  const [stats, setStats] = useState<GuestStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [controlling, setControlling] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [pad, setPad] = useState<string | null>(null);
  const status = useRemotePlayOnline((s) => s.status);
  const play = join.mode === "play";

  useEffect(() => {
    // la scène 3D s'arrête pendant la session : le fil principal reste au décodage
    useScenePause.setState({ paused: true });
    let s: GuestSession | NativeGuestSession;
    let unmute: (() => void) | null = null;
    if (native) {
      const n = new NativeGuestSession(canvas.current!, rumble, join.stunServers);
      // aucune image 20 s après la réponse : la connexion directe n'a pas abouti
      const failTimer = window.setTimeout(() => {
        if (!n.connected) setError("Connexion impossible : un pare-feu ou le routeur de l'un de vous bloque la connexion directe (iBox n'utilise aucun relais).");
      }, 20_000);
      n.onConnection = (now) => {
        if (now) window.clearTimeout(failTimer);
        void onlineApi.guestState(now).catch(() => undefined);
      };
      // le son démarre au premier geste (lecture sonore bloquée sans geste)
      unmute = () => n.unmute();
      window.addEventListener("pointerdown", unmute, true);
      window.addEventListener("keydown", unmute, true);
      void n
        .accept(join.offer)
        .then((answer) => onlineApi.answer(answer))
        .catch((e) => setError(errText(e)));
      s = n;
    } else {
      const w = new GuestSession(video.current!, rumble, join.stunServers);
      let connected = false;
      w.pc.addEventListener("connectionstatechange", () => {
        const now = w.pc.connectionState === "connected";
        if (now !== connected) {
          connected = now;
          void onlineApi.guestState(now).catch(() => undefined);
        }
        if (w.pc.connectionState === "failed") setError("Connexion impossible : un pare-feu ou le routeur de l'un de vous bloque la connexion directe (iBox n'utilise aucun relais).");
      });
      void w
        .accept(join.offer, 2500, (c) => void onlineApi.candidates([c]).catch(() => undefined))
        .then((answer) => onlineApi.answer(answer))
        .catch((e) => setError(errText(e)));
      s = w;
    }
    session.current = s;
    const timer = window.setInterval(
      () =>
        void s.stats().then((st) => {
          setStats(st);
          // panneau des performances : latence de la session en cours
          useRemoteLatency.setState({ latency: { pingMs: st.pingMs, rttMs: st.rttMs, decodeMs: st.decodeMs, fps: st.fps, bitrateKbps: st.bitrateKbps } });
        }, () => undefined),
      1000,
    );
    // en mode Joueur, la manette de l'invité est envoyée d'office, dès qu'elle apparaît
    const detachPad = join.mode === "play" ? attachPad(s, { onPad: setPad, onPadCapture: (a) => (padCapture.active = a), paused: () => menuRef.current }) : null;
    // la souris aussi, sur l'image seulement (l'hôte la refuse si le profil ne la donne pas)
    // la souris aussi (pavés tactiles du Steam Deck), sur l'image seulement
    const surface = native ? canvas.current : video.current;
    const detachMouse = join.mode === "play" && surface ? attachInputs(s, surface, { pad: false, keyboard: false }) : null;
    return () => {
      useScenePause.setState({ paused: false });
      useRemoteLatency.setState({ latency: null });
      if (unmute) {
        window.removeEventListener("pointerdown", unmute, true);
        window.removeEventListener("keydown", unmute, true);
      }
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
    const surface = native ? canvas.current : video.current;
    if (!session.current || !surface) return;
    // manette et souris sont déjà envoyées d'office : seul le clavier (capturé) s'ajoute ici
    detach.current = attachInputs(session.current, surface, { pad: false, mouse: false });
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

  // plein écran pendant toute la session, puis retour au choix de Paramètres
  useEffect(() => {
    void setFullscreen(true);
    return () => void setFullscreen(useSettings.getState().fullscreen);
  }, []);

  const openMenu = () => {
    if (menuRef.current) return;
    // le clavier revient à iBox le temps du menu
    if (detach.current) {
      detach.current();
      detach.current = null;
      setControlling(false);
    }
    menuRef.current = true;
    setMenu(true);
    sound.play("open");
  };
  const closeMenu = () => {
    menuRef.current = false;
    setMenu(false);
    sound.play("back");
  };
  const quit = () => {
    if (leaving) return;
    setLeaving(true);
    sound.play("back");
    window.setTimeout(() => onLeave(), 450);
  };

  // raccourcis du menu : Échap (maintenu 1 s si le clavier est envoyé), Select + Start, Guide
  useEffect(() => {
    let escAt = 0;
    let comboAt = 0;
    let guideWas = true;
    let frame = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menuRef.current) return; // Échap ferme le menu (navigation d'iBox)
      if (!detach.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openMenu();
        return;
      }
      if (!e.repeat) escAt = performance.now();
      else if (escAt && performance.now() - escAt > 900) {
        escAt = 0;
        e.preventDefault();
        e.stopImmediatePropagation();
        openMenu();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Escape") escAt = 0;
    };
    const poll = () => {
      const pad = navigator.getGamepads?.().find((p): p is Gamepad => !!p && p.connected);
      if (pad && !menuRef.current) {
        const combo = !!pad.buttons[8]?.pressed && !!pad.buttons[9]?.pressed;
        const guide = !!pad.buttons[16]?.pressed;
        if (combo) {
          comboAt ||= performance.now();
          if (performance.now() - comboAt > 700) {
            comboAt = 0;
            openMenu();
          }
        } else comboAt = 0;
        if (guide && !guideWas) openMenu();
        guideWas = guide;
      } else {
        comboAt = 0;
        guideWas = true;
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Retour (B / Échap) ferme le menu ; la navigation d'iBox y fonctionne à la manette
  useEffect(() => {
    if (!menu) return;
    const off = input.onBack(() => {
      closeMenu();
      return true;
    });
    const id = requestAnimationFrame(() => input.focusInitial());
    return () => {
      off();
      cancelAnimationFrame(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);

  // barre du haut : visible au début, puis seulement quand la souris bouge
  useEffect(() => {
    let t = window.setTimeout(() => setChrome(false), 4500);
    const wake = () => {
      setChrome(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setChrome(false), 2200);
    };
    window.addEventListener("pointermove", wake, { passive: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pointermove", wake);
    };
  }, []);

  const q = quality(stats);
  const glyphs = (
    <span className="inline-flex items-center gap-1">
      <PadGlyph k="select" family={family} side={side} size={20} />
      <span className="text-[0.75rem] font-bold opacity-70">+</span>
      <PadGlyph k="start" family={family} side={side} size={20} />
    </span>
  );

  return createPortal(
    <div data-nav-root className="fixed inset-0 z-[80] overflow-hidden bg-black text-[#F4F4F6]">
      {native && (
        <canvas
          ref={canvas}
          className={`absolute inset-0 h-full w-full bg-black object-contain transition-[filter,transform] duration-300 ${menu || leaving ? "scale-[0.985] blur-[6px] brightness-[0.45]" : ""}`}
        />
      )}
      <video
        hidden={native}
        ref={video}
        className={`absolute inset-0 h-full w-full bg-black object-contain transition-[filter,transform] duration-300 ${menu || leaving ? "scale-[0.985] blur-[6px] brightness-[0.45]" : ""}`}
        autoPlay
        playsInline
        muted
        tabIndex={-1}
      />

      {/* barre discrète en haut : hôte, qualité, raccourci du menu */}
      <motion.div
        initial={false}
        animate={{ opacity: chrome && !menu && !leaving ? 1 : 0, y: chrome && !menu && !leaving ? 0 : -18 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="pointer-events-none absolute top-4 left-1/2 z-10 -translate-x-1/2"
      >
        <div className={`flex items-center gap-3 rounded-full bg-black/55 py-1.5 pr-1.5 pl-4 shadow-2xl ring-1 ring-[#fff]/10 backdrop-blur-xl ${chrome && !menu ? "pointer-events-auto" : ""}`}>
          <span className="size-2 rounded-full" style={{ background: q.color, boxShadow: `0 0 10px ${q.color}` }} />
          <span className="text-[0.88rem] font-bold">
            Session de <span data-no-i18n>{join.hostName}</span>
          </span>
          <span className="text-[0.78rem] font-semibold opacity-65">{play ? "Joueur" : "Spectateur"}</span>
          <span className="hidden items-center gap-1.5 text-[0.75rem] font-semibold opacity-65 md:inline-flex">
            {controlling ? "Maintenir Échap" : "Échap"} ou {glyphs} : menu
          </span>
          <button
            type="button"
            onClick={openMenu}
            className="flex items-center gap-1.5 rounded-full bg-[#fff]/12 px-3 py-1.5 text-[0.8rem] font-bold transition hover:bg-[#fff]/22"
          >
            <Icon name="grid" size="1em" /> Menu
          </button>
        </div>
      </motion.div>

      {(error || ended) && !menu && !leaving && (
        <div role="alert" className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-2xl bg-black/70 px-4 py-3 shadow-2xl ring-1 ring-[#F0504A]/40 backdrop-blur-xl">
          <span className="max-w-[36rem] text-[0.9rem] font-semibold text-[#FFB4B4]">{error ?? status?.error ?? "Session terminée."}</span>
          <Button variant="primary" icon="back" onClick={quit}>
            Retour à iBox
          </Button>
        </div>
      )}

      {/* menu de session */}
      {menu && !leaving && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 z-20 grid place-items-center bg-black/35"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeMenu();
          }}
        >
          <motion.div
            role="dialog"
            aria-label="Menu de la session"
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={SPRING.snappy}
            className="w-[min(30rem,calc(100vw-2rem))] rounded-[1.75rem] bg-[#16161c]/85 p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] ring-1 ring-[#fff]/10 backdrop-blur-2xl"
          >
            <div className="flex items-start gap-3">
              <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--accent-deep)] text-on-accent">
                <Icon name="gamepad" size="1.5em" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[0.75rem] font-bold tracking-wider uppercase opacity-55">Remote Play</p>
                <p className="truncate text-[1.25rem] font-extrabold">
                  Session de <span data-no-i18n>{join.hostName}</span>
                </p>
                <p className="mt-0.5 flex items-center gap-2 text-[0.82rem] font-semibold opacity-75">
                  <span className="size-2 rounded-full" style={{ background: q.color }} />
                  {q.label} · {play ? "Joueur" : "Spectateur"}
                </p>
              </div>
              <ExperimentalBadge />
            </div>

            <div className="mt-4 flex items-center justify-between rounded-2xl bg-[#fff]/6 px-4 py-2.5 text-[0.82rem]">
              <span className="font-semibold opacity-70">Code de sécurité</span>
              <span className="flex items-center gap-2">
                <b className="font-mono text-[0.95rem] tracking-[0.2em]">{join.safetyCode}</b>
                <span className="text-[0.72rem] opacity-60">{trustLabel(join.trust)}</span>
              </span>
            </div>
            {play && (
              <p className="mt-2 px-1 text-[0.78rem] font-semibold opacity-60">
                {pad ? (
                  <>
                    Manette : <span data-no-i18n>{pad.replace(/\s*\(.*\)\s*$/, "")}</span>
                  </>
                ) : (
                  "Manette : branchez-la et appuyez sur un bouton"
                )}
              </p>
            )}

            {showStats && stats && (
              <div className="mt-3 grid grid-cols-2 gap-1">
                <Stat label="Images/s" value={fmt(stats.fps, 0)} />
                <Stat label="Débit" value={fmt(stats.bitrateKbps === null ? null : stats.bitrateKbps / 1000, 1, " Mbit/s")} />
                <Stat label="Aller-retour" value={fmt(stats.rttMs, 1, " ms")} />
                <Stat label="Ping des commandes" value={fmt(stats.pingMs, 1, " ms")} />
                <Stat label="Pertes" value={fmt(stats.lossPct, 2, " %")} />
                <Stat label="Image" value={stats.resolution ?? "—"} />
              </div>
            )}

            <div className="mt-5 flex flex-col gap-2">
              <Button variant="primary" icon="play" onClick={closeMenu} className="w-full">
                Reprendre
              </Button>
              <div className="grid grid-cols-2 gap-2">
                {play && !ended && (
                  <Button
                    icon="key"
                    className="w-full"
                    onClick={() => {
                      closeMenu();
                      toggleControl();
                    }}
                  >
                    {controlling ? "Rendre le clavier" : "Envoyer mon clavier"}
                  </Button>
                )}
                <Button icon="search" className={`w-full ${play && !ended ? "" : "col-span-2"}`} onClick={() => setShowStats(!showStats)}>
                  {showStats ? "Masquer les statistiques" : "Statistiques"}
                </Button>
              </div>
              <button
                type="button"
                data-focusable
                onClick={quit}
                className="ibox-focusable mt-1 flex w-full items-center justify-center gap-2 rounded-full bg-[#F0504A]/15 px-5 py-3 font-bold text-[#FF9A95] ring-1 ring-[#F0504A]/30 transition hover:bg-[#F0504A]/28 [--ring-radius:999px]"
              >
                <Icon name="power" size="1.1em" /> Quitter la session
              </button>
            </div>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-[0.72rem] font-semibold opacity-50">
              Échap ou {glyphs} pour revenir au jeu
            </p>
          </motion.div>
        </motion.div>
      )}

      {/* sortie propre : l'hôte est prévenu, puis retour à iBox */}
      {leaving && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 z-30 grid place-items-center bg-black/70">
          <div className="flex flex-col items-center gap-3">
            <motion.span
              className="size-9 rounded-full border-[3px] border-[#fff]/20 border-t-[#fff]"
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
            />
            <p className="text-[0.95rem] font-bold">Fin de la session…</p>
          </div>
        </motion.div>
      )}
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
