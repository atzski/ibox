import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { padCapture } from "@/input/gamepad";
import { remotePlayApi, type GuestProfile, type HostStats } from "@/services/remotePlay";
import { attachInputs, GuestSession, packSdp, unpackSdp, type GuestStats } from "@/services/remotePlayGuest";

type Mode = "idle" | "loopback" | "host" | "join";

const fmt = (v: number | null | undefined, digits = 1, unit = "") => (v === null || v === undefined || Number.isNaN(v) ? "—" : `${v.toFixed(digits)}${unit}`);

function rumble(_pad: number, large: number, small: number) {
  const pad = navigator.getGamepads?.().find((p): p is Gamepad => !!p && p.connected);
  const actuator = (pad as (Gamepad & { vibrationActuator?: { playEffect: (t: string, p: object) => Promise<unknown> } }) | undefined)?.vibrationActuator;
  void actuator?.playEffect("dual-rumble", { duration: 250, strongMagnitude: large / 255, weakMagnitude: small / 255 }).catch(() => undefined);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-xl bg-cream-deep/60 px-3 py-1.5 text-[0.8rem]">
      <span className="font-semibold text-ink-soft">{label}</span>
      <span className="font-extrabold tabular-nums text-ink">{value}</span>
    </div>
  );
}

function HostStatsView({ s }: { s: HostStats }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
      <Stat label="État" value={s.error ? `${s.state} : ${s.error}` : s.state} />
      <Stat label="Encodeur" value={s.encoder ? `${s.encoder}${s.resolution ? ` ${s.resolution[0]}×${s.resolution[1]}` : ""}` : "—"} />
      <Stat label="Images/s envoyées" value={fmt(s.fps, 1)} />
      <Stat label="Débit émis" value={fmt(s.sentKbps / 1000, 1, " Mbit/s")} />
      <Stat label="Consigne encodeur" value={fmt(s.targetKbps / 1000, 1, " Mbit/s")} />
      <Stat label="Estimation réseau" value={fmt(s.bweKbps === null ? null : s.bweKbps / 1000, 1, " Mbit/s")} />
      <Stat label="Aller-retour" value={fmt(s.rttMs, 1, " ms")} />
      <Stat label="Pertes" value={fmt(s.lossPct, 2, " %")} />
      <Stat label="Gigue (invité)" value={fmt(s.jitterMs, 1, " ms")} />
      <Stat label="Encodage (médiane)" value={fmt(s.encodeMsP50, 2, " ms")} />
      <Stat label="Capture → envoi (médiane / max)" value={`${fmt(s.hostMsP50, 1)} / ${fmt(s.hostMsMax, 1, " ms")}`} />
      <Stat label="File d'envoi (médiane / max)" value={`${fmt(s.sendQueueMsP50, 1)} / ${fmt(s.sendQueueMsMax, 1, " ms")}`} />
      <Stat label="Images écartées (réseau saturé)" value={String(s.framesSkipped ?? 0)} />
      <Stat label="Commande reçue → injectée" value={fmt(s.inputMsP50, 2, " ms")} />
      <Stat label="Latence mesurée par l'invité" value={fmt(s.guestLatencyMs, 1, " ms")} />
      <Stat label="Demandes d'image clé" value={String(s.plis + s.firs)} />
      <Stat label="Entrées reçues / refusées" value={`${s.inputs.received} / ${s.inputs.rejected + s.inputs.denied}`} />
    </div>
  );
}

function GuestStatsView({ s }: { s: GuestStats }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
      <Stat label="Connexion" value={s.state} />
      <Stat label="Image reçue" value={s.resolution ?? "—"} />
      <Stat label="Images/s affichées" value={fmt(s.fps, 0)} />
      <Stat label="Débit reçu" value={fmt(s.bitrateKbps === null ? null : s.bitrateKbps / 1000, 1, " Mbit/s")} />
      <Stat label="Aller-retour" value={fmt(s.rttMs, 1, " ms")} />
      <Stat label="Ping des commandes" value={fmt(s.pingMs, 1, " ms")} />
      <Stat label="Pertes" value={fmt(s.lossPct, 2, " %")} />
      <Stat label="Gigue" value={fmt(s.jitterMs, 1, " ms")} />
      <Stat label="Tampon de gigue" value={fmt(s.jitterBufferMs, 1, " ms")} />
      <Stat label="Décodage" value={`${fmt(s.decodeMs, 2, " ms")}${s.hardwareDecoder === null ? "" : s.hardwareDecoder ? " (matériel)" : " (logiciel)"}`} />
      <Stat label="Capture → affichage" value={fmt(s.latency.totalMs ?? s.captureToDisplayMs, 1, " ms")} />
      <Stat label="Hôte / réseau / invité" value={`${fmt(s.latency.hostMs, 1)} / ${fmt(s.latency.networkMs, 1)} / ${fmt(s.latency.guestMs, 1, " ms")}`} />
      <Stat label="Images perdues / gels" value={`${s.framesDropped ?? "—"} / ${s.freezeCount ?? "—"}`} />
    </div>
  );
}

/**
 * Session d'essai Remote Play (Phases 1c/2) : boucle locale sur ce PC, ou deux PC du même réseau
 * avec échange manuel de l'offre et de la réponse, en attendant la signalisation iNetbox.
 */
export function RemotePlaySession() {
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [offerBlob, setOfferBlob] = useState("");
  const [answerBlob, setAnswerBlob] = useState("");
  const [pasted, setPasted] = useState("");
  const [profile, setProfile] = useState<GuestProfile>("player");
  const [hostStats, setHostStats] = useState<HostStats | null>(null);
  const [guestStats, setGuestStats] = useState<GuestStats | null>(null);
  const [controlling, setControlling] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const guest = useRef<GuestSession | null>(null);
  const detach = useRef<(() => void) | null>(null);
  const hosting = mode === "loopback" || mode === "host";

  const stop = async () => {
    detach.current?.();
    detach.current = null;
    setControlling(false);
    guest.current?.close();
    guest.current = null;
    if (hosting) setHostStats(await remotePlayApi.hostStop().catch(() => null));
    setMode("idle");
    setCode(null);
    setOfferBlob("");
    setAnswerBlob("");
    setPasted("");
  };

  // arrêt propre si l'écran est quitté
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => () => void stopRef.current(), []);

  // statistiques réelles, une fois par seconde
  useEffect(() => {
    if (mode === "idle") return;
    const timer = window.setInterval(() => {
      if (hosting) void remotePlayApi.hostStats().then(setHostStats, () => undefined);
      if (guest.current) void guest.current.stats().then(setGuestStats, () => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [mode, hosting]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const newGuest = () => {
    guest.current?.close();
    guest.current = new GuestSession(video.current!, rumble);
    return guest.current;
  };

  const startLoopback = () =>
    run(async () => {
      setHostStats(null);
      setGuestStats(null);
      const offer = await remotePlayApi.hostStart(false);
      setMode("loopback");
      const answer = await newGuest().accept(offer.sdp);
      setCode(await remotePlayApi.hostAnswer(answer));
    });

  const startHost = () =>
    run(async () => {
      setHostStats(null);
      const offer = await remotePlayApi.hostStart(true, profile);
      setOfferBlob(packSdp("offer", offer.sdp));
      setMode("host");
    });

  const acceptAnswer = () => run(async () => setCode(await remotePlayApi.hostAnswer(unpackSdp("answer", pasted))));

  const join = () =>
    run(async () => {
      setGuestStats(null);
      const offer = unpackSdp("offer", pasted);
      setMode("join");
      const session = newGuest();
      setAnswerBlob(packSdp("answer", await session.accept(offer)));
      setCode(await session.verificationCode());
    });

  const toggleControl = () => {
    if (detach.current) {
      detach.current();
      detach.current = null;
      setControlling(false);
      return;
    }
    if (!guest.current || !video.current) return;
    detach.current = attachInputs(guest.current, video.current, { onPadCapture: (a) => (padCapture.active = a) });
    setControlling(true);
  };

  const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => undefined);
  const showVideo = mode === "loopback" || mode === "join";

  return (
    <div className="flex flex-col gap-3 py-3">
      {mode === "idle" && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon="play" onClick={() => void startLoopback()} disabled={busy}>
              Boucle locale sur ce PC
            </Button>
            <Button icon="globe" onClick={() => void startHost()} disabled={busy}>
              Héberger sur le réseau local
            </Button>
          </div>
          <label className="flex items-center gap-2 text-[0.85rem] font-semibold text-ink-soft">
            Droits de l'invité (réseau local)
            <select className="rounded-lg bg-white px-2 py-1 text-ink" value={profile} onChange={(e) => setProfile(e.target.value as GuestProfile)}>
              <option value="spectator">Spectateur</option>
              <option value="player">Joueur (manette)</option>
              <option value="collaborator">Collaborateur (clavier, souris)</option>
            </select>
          </label>
          {profile !== "spectator" && (
            <p className="text-[0.78rem] font-semibold text-ink-soft">
              La manette de l'invité apparaît sur ce PC comme une manette Xbox de plus : P2 si vous jouez déjà avec la vôtre.
            </p>
          )}
          <textarea
            className="h-20 w-full rounded-xl bg-white p-2 font-mono text-[0.7rem] text-ink"
            placeholder="Pour rejoindre : collez ici l'offre reçue de l'hôte"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <div>
            <Button icon="open" onClick={() => void join()} disabled={busy || !pasted.trim()}>
              Rejoindre
            </Button>
          </div>
        </>
      )}

      {mode === "host" && (
        <>
          <p className="text-[0.85rem] font-semibold text-ink-soft">1. Envoyez cette offre à l'invité (elle contient l'adresse de ce PC sur le réseau local).</p>
          <textarea readOnly className="h-20 w-full rounded-xl bg-white p-2 font-mono text-[0.7rem] text-ink" value={offerBlob} />
          <div>
            <Button icon="copy" onClick={() => copy(offerBlob)}>
              Copier l'offre
            </Button>
          </div>
          {!code && (
            <>
              <p className="text-[0.85rem] font-semibold text-ink-soft">2. Collez la réponse de l'invité.</p>
              <textarea className="h-20 w-full rounded-xl bg-white p-2 font-mono text-[0.7rem] text-ink" value={pasted} onChange={(e) => setPasted(e.target.value)} />
              <div>
                <Button variant="primary" icon="check" onClick={() => void acceptAnswer()} disabled={busy || !pasted.trim()}>
                  Valider la réponse
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {mode === "join" && answerBlob && (
        <>
          <p className="text-[0.85rem] font-semibold text-ink-soft">Renvoyez cette réponse à l'hôte.</p>
          <textarea readOnly className="h-20 w-full rounded-xl bg-white p-2 font-mono text-[0.7rem] text-ink" value={answerBlob} />
          <div>
            <Button icon="copy" onClick={() => copy(answerBlob)}>
              Copier la réponse
            </Button>
          </div>
        </>
      )}

      {code && (
        <p className="text-[0.9rem] font-bold text-ink">
          Code de vérification : <span className="font-mono tracking-wider">{code}</span>
          <span className="block text-[0.78rem] font-semibold text-ink-soft">Il doit être identique sur les deux ordinateurs ; sinon, arrêtez la session.</span>
        </p>
      )}

      <video
        ref={video}
        className={showVideo ? "aspect-video w-full rounded-xl bg-black object-contain" : "hidden"}
        autoPlay
        playsInline
        muted
        tabIndex={-1}
        onDoubleClick={() => void video.current?.requestFullscreen().catch(() => undefined)}
      />

      {mode !== "idle" && (
        <div className="flex flex-wrap gap-2">
          {mode === "join" && (
            <Button icon="gamepad" onClick={toggleControl}>
              {controlling ? "Rendre les commandes" : "Envoyer mes commandes"}
            </Button>
          )}
          {showVideo && (
            <Button icon="front" onClick={() => void video.current?.requestFullscreen().catch(() => undefined)}>
              Plein écran
            </Button>
          )}
          <Button icon="close" onClick={() => void stop()}>
            Arrêter la session
          </Button>
        </div>
      )}

      {controlling && <p className="text-[0.8rem] font-semibold text-ink-soft">Clavier, souris sur l'image et première manette sont envoyés à l'hôte. Il peut tout arrêter avec son raccourci d'urgence.</p>}
      {error && <p className="text-[0.85rem] font-semibold text-peach-deep">{error}</p>}
      {hostStats && (
        <>
          <p className="pt-1 text-[0.8rem] font-extrabold uppercase tracking-wide text-ink-soft">Hôte (ce PC)</p>
          <HostStatsView s={hostStats} />
        </>
      )}
      {guestStats && (
        <>
          <p className="pt-1 text-[0.8rem] font-extrabold uppercase tracking-wide text-ink-soft">Invité (ce PC)</p>
          <GuestStatsView s={guestStats} />
          {!guestStats.minimalBuffer && <p className="text-[0.78rem] font-semibold text-ink-soft">Ce WebView refuse le tampon minimal (jitterBufferTarget) : tampon par défaut.</p>}
        </>
      )}
    </div>
  );
}
