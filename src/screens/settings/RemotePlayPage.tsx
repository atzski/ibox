import { useEffect, useState } from "react";
import { tr } from "@/i18n";
import { useSettings } from "@/services/settings";
import { Button } from "@/components/ui/Button";
import { RemotePlaySession } from "@/components/remoteplay/RemotePlaySession";
import { ExperimentalBadge } from "@/components/remoteplay/RemotePlayOnline";
import { onlineApi } from "@/services/remotePlayOnline";
import { diagnoseGuest, remotePlayApi, testNetwork, type GuestReport, type HostReport, type NetworkReport, type RemotePlayConfig } from "@/services/remotePlay";
import { Group, Row, Toggle } from "./ui";

// ——— Remote Play ———

/** Mêmes serveurs que `remote_play::config::Config::default` (repli hors application native). */
const DEFAULT_STUN = ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"];

export function RemotePlayPage() {
  const [config, setConfig] = useState<RemotePlayConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [host, setHost] = useState<HostReport | null>(null);
  const [guest, setGuest] = useState<GuestReport | null>(null);
  const [net, setNet] = useState<NetworkReport | null>(null);
  const lang = useSettings((st) => st.language) ?? "fr";
  const t = (text: string) => tr(text, lang);

  useEffect(() => {
    remotePlayApi.config().then(setConfig, () => setConfig(null));
  }, []);

  const toggle = (enabled: boolean) => {
    if (!config) return;
    remotePlayApi.setConfig({ ...config, enabled }).then(setConfig, (e) => setError(String(e)));
  };
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const setAccept = (accept: boolean) => {
    if (!config) return;
    setAcceptError(null);
    onlineApi.setAccept(accept).then(
      (acceptRequests) => setConfig({ ...config, acceptRequests }),
      (e) => setAcceptError(typeof e === "string" ? e : String((e as { message?: string })?.message ?? e)),
    );
  };

  const diagnose = async () => {
    setRunning(true);
    setError(null);
    // chaque partie est indépendante : un échec n'empêche pas les autres mesures
    const [h, g, n] = await Promise.allSettled([remotePlayApi.diagnoseHost(), diagnoseGuest(), testNetwork(config?.stunServers ?? DEFAULT_STUN)]);
    setHost(h.status === "fulfilled" ? h.value : null);
    setGuest(g.status === "fulfilled" ? g.value : null);
    setNet(n.status === "fulfilled" ? n.value : null);
    if (h.status === "rejected") setError("Diagnostic de Windows indisponible : il nécessite l'application iBox.");
    setRunning(false);
  };

  const [installingPad, setInstallingPad] = useState(false);
  const [padError, setPadError] = useState<string | null>(null);
  const installPad = () => {
    setInstallingPad(true);
    setPadError(null);
    remotePlayApi
      .installPadDriver()
      .then(
        (d) => setHost((h) => (h ? { ...h, virtualPadDriver: d.installed } : h)),
        (e) => setPadError(typeof e === "string" ? e : String((e as { message?: string })?.message ?? e)),
      )
      .finally(() => setInstallingPad(false));
  };

  const yes = (ok: boolean, good: string, bad: string) => (
    <span className={`shrink-0 rounded-full px-3 py-1 text-[0.8rem] font-extrabold ${ok ? "bg-mint-soft text-mint-deep ring-1 ring-mint-deep/30" : "bg-peach-soft text-peach-deep ring-1 ring-peach-deep/30"}`}>{ok ? good : bad}</span>
  );
  const encoders = (list: string[]) => (list.length ? list.join(" · ") : t("Aucun"));

  return (
    <>
      <Group
        title="Remote Play"
        icon="play"
        note="Fonction expérimentale. Jouez à distance avec vos amis iNetbox, directement d'ordinateur à ordinateur : le jeu tourne chez l'hôte, l'image et les commandes ne passent jamais par les serveurs iNetbox. Pour inviter un ami : son profil › « Inviter à jouer »."
      >
        <Row label="Activer Remote Play" note="Expérimental, désactivé par défaut. Désactivé, aucune capture, aucun contrôle à distance et aucune recherche d'invitations ne tourne.">
          <span className="flex items-center gap-3">
            <ExperimentalBadge />
            <Toggle checked={!!config?.enabled} onChange={toggle} label="Activer Remote Play" />
          </span>
        </Row>
        {config?.enabled && (
          <Row
            label="Accepter les demandes Remote Play de mes amis"
            note={acceptError ?? "Désactivé par défaut. Activé, vos amis iNetbox peuvent vous inviter ; vous acceptez ou refusez chaque invitation."}
          >
            <Toggle checked={!!config?.acceptRequests} onChange={setAccept} label="Accepter les demandes Remote Play de mes amis" />
          </Row>
        )}
        {config?.enabled && (
          <Row
            label="Masquer l'écho Discord"
            note="Activé par défaut. Le son de Discord (vos appels vocaux) n'est pas envoyé à vos invités : ils ne s'entendent plus en écho. Le jeu et le reste du son passent normalement. Discord doit être ouvert avant le début du partage."
          >
            <Toggle
              checked={config.hideDiscordEcho !== false}
              onChange={(hideDiscordEcho) => remotePlayApi.setConfig({ ...config, hideDiscordEcho }).then(setConfig, (e) => setError(String(e)))}
              label="Masquer l'écho Discord"
            />
          </Row>
        )}
        <Row label="Connexions directes" note="En pair à pair, vos participants voient votre adresse IP (avertissement avant la première session). Aucun relais n'est utilisé. Verrouiller Windows coupe le partage.">
          <span />
        </Row>
      </Group>

      {config?.enabled && (
        <Group
          title="Session d'essai"
          icon="play"
          note="Sans serveur iNetbox : sur ce PC (boucle locale, vous êtes spectateur de votre propre écran) ou entre deux PC du même réseau en échangeant l'offre et la réponse à la main. Arrêt d'urgence de l'hôte : son raccourci (Ctrl+Alt+Shift+F12 par défaut)."
        >
          <RemotePlaySession />
        </Group>
      )}

      <Group title="Diagnostic de cet ordinateur" icon="search" note="Mesures réelles de Windows, de la carte graphique et du réseau. Le test réseau contacte uniquement les serveurs STUN.">
        <Row label="Lancer le diagnostic">
          <Button variant="primary" icon="search" onClick={() => void diagnose()} disabled={running}>
            {running ? "Analyse…" : "Analyser"}
          </Button>
        </Row>
        {error && <p className="py-3 text-[0.85rem] font-semibold text-peach-deep">{error}</p>}
        {host && (
          <>
            <Row label="Windows" note={host.windowsLabel}>
              {yes(host.graphicsCapture, "Compatible", "Trop ancien")}
            </Row>
            <Row label="Capture de l'écran et des fenêtres" note={host.borderlessCapture ? "Windows Graphics Capture, sans bordure de capture" : "Windows Graphics Capture (bordure jaune visible)"}>
              {yes(host.graphicsCapture, "Disponible", "Indisponible")}
            </Row>
            <Row label="Carte graphique" note={host.gpus.map((g) => `${g.name} (${Math.round(g.dedicatedMb / 1024)} ${t("Go")})`).join(" · ") || "Aucune carte détectée"}>
              {yes(host.gpus.length > 0, "Détectée", "Absente")}
            </Row>
            <Row label="Encodage matériel H.264" note={encoders(host.hardwareEncoders.h264)}>
              {yes(host.hardwareEncoders.h264.length > 0, "Oui", "Logiciel seulement")}
            </Row>
            <Row label="Encodage matériel HEVC" note={encoders(host.hardwareEncoders.hevc)}>
              {yes(host.hardwareEncoders.hevc.length > 0, "Oui", "Non")}
            </Row>
            <Row label="Encodage matériel AV1" note={encoders(host.hardwareEncoders.av1)}>
              {yes(host.hardwareEncoders.av1.length > 0, "Oui", "Non")}
            </Row>
            <Row label="Son" note={`${host.audioOutputs} sortie(s), ${host.audioInputs} entrée(s)${host.processAudio ? " · son du jeu seul possible" : ""}`}>
              {yes(host.audioOutputs > 0, "Prêt", "Aucune sortie")}
            </Row>
            <Row
              label="Manettes des invités"
              note={host.virtualPadDriver ? "Pilote ViGEmBus présent" : padError ?? "Pilote ViGEmBus absent : nécessaire pour que la manette de votre invité fonctionne (Windows demandera votre accord)"}
            >
              {host.virtualPadDriver ? (
                yes(true, "Prêt", "")
              ) : (
                <Button variant="primary" icon="download" onClick={installPad} disabled={installingPad}>
                  {installingPad ? "Installation…" : "Installer"}
                </Button>
              )}
            </Row>
            {host.errors.map((e) => (
              <p key={e} className="py-2 text-[0.82rem] font-semibold text-ink-soft">{e}</p>
            ))}
          </>
        )}
        {guest && (
          <Row
            label="Réception d'un stream"
            note={
              (Object.entries(guest.decode) as [string, { hardware: boolean }][])
                .map(([codec, d]) => `${codec.toUpperCase()} ${t(d.hardware ? "matériel" : "logiciel")}`)
                .join(" · ") || "Aucun codec vidéo WebRTC"
            }
          >
            {yes(guest.webrtc && Object.keys(guest.decode).length > 0, "Prêt", "Indisponible")}
          </Row>
        )}
        {net && (
          <Row
            label="Connexion directe (UDP, STUN)"
            note={
              net.stun
                ? `Adresse publique obtenue en ${net.elapsedMs} ms : ${net.publicFamilies.join(t(" et "))}`
                : "Aucune réponse STUN : l'UDP sortant semble bloqué (pare-feu, réseau d'entreprise ou d'école)."
            }
          >
            {yes(net.stun, "Fonctionne", "Bloquée")}
          </Row>
        )}
      </Group>
    </>
  );
}
