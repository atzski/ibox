import { isTauri } from "@/services/native";

/** Réglages Remote Play gardés côté natif (`remote_play::config::Config`). */
export interface RemotePlayConfig {
  enabled: boolean;
  computerName: string;
  height: number | null;
  fps: number;
  bitrateKbps: number | null;
  quality: "latency" | "performance" | "balanced" | "quality" | "maximum" | "auto";
  codec: "auto" | "h264" | "hevc" | "av1";
  audio: "system" | "gameOnly" | "none";
  keepHostAudio: boolean;
  /** « Masquer l'écho Discord » : le son de Discord n'est pas envoyé aux invités. */
  hideDiscordEcho: boolean;
  maxGuests: number;
  uploadLimitKbps: number | null;
  defaultProfile: "spectator" | "player" | "collaborator" | "fullControl";
  confirmConnections: boolean;
  inviteTtlSecs: number;
  idleTimeoutMins: number;
  lanDiscovery: boolean;
  stunServers: string[];
  showStats: boolean;
  blockedAccounts: string[];
  /** Raccourci global d'arrêt d'urgence, ex. « Ctrl+Alt+Shift+F12 ». */
  stopHotkey: string;
  /** « Accepter les demandes Remote Play de mes amis » (modifié par `onlineApi.setAccept`). */
  acceptRequests: boolean;
  /** Avertissement sur l'adresse IP lu avant la première session P2P. */
  ipWarningSeen: boolean;
}

export interface HostReport {
  windowsBuild: number;
  windowsLabel: string;
  graphicsCapture: boolean;
  borderlessCapture: boolean;
  processAudio: boolean;
  gpus: { name: string; vendor: string; dedicatedMb: number }[];
  hardwareEncoders: { h264: string[]; hevc: string[]; av1: string[] };
  softwareEncoders: { h264: string[]; hevc: string[]; av1: string[] };
  audioOutputs: number;
  audioInputs: number;
  virtualPadDriver: boolean;
  errors: string[];
}

/** Ce que le WebView de cet ordinateur sait recevoir (rôle d'invité). */
export interface GuestReport {
  webrtc: boolean;
  /** codec → décodage matériel (powerEfficient) ; absent = non pris en charge */
  decode: Partial<Record<"h264" | "hevc" | "av1", { smooth: boolean; hardware: boolean }>>;
  gamepadApi: boolean;
}

const MIME: Record<keyof GuestReport["decode"], string> = { h264: "video/H264", hevc: "video/H265", av1: "video/AV1" };

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Statistiques réelles de l'hôte (`remote_play::transport::stats::TransportStats`). */
export interface HostStats {
  state: string;
  connected: boolean;
  error: string | null;
  connectMs: number | null;
  elapsedS: number;
  rttMs: number | null;
  lossPct: number | null;
  packetsLost: number | null;
  jitterMs: number | null;
  bweKbps: number | null;
  targetKbps: number;
  sentKbps: number;
  fps: number;
  frames: number;
  keyframes: number;
  plis: number;
  firs: number;
  nacks: number;
  bitrateChanges: number;
  encoder: string | null;
  resolution: [number, number] | null;
  encodeMsP50: number | null;
  encodeMsMax: number | null;
  /** Image capturée → envoyée à l'encodeur (attente de cadence), médiane en ms. */
  captureWaitMsP50: number | null;
  /** Image encodée → dernier paquet remis au réseau (file d'envoi), en ms. */
  sendQueueMsP50: number | null;
  sendQueueMsMax: number | null;
  /** Image capturée → dernier paquet remis au réseau : toute la part de l'hôte, en ms. */
  hostMsP50: number | null;
  hostMsMax: number | null;
  /** Commande reçue du réseau → injectée, en ms. */
  inputMsP50: number | null;
  inputMsMax: number | null;
  /** Images non encodées parce que la file d'envoi n'était pas vide. */
  framesSkipped: number;
  /** Mesuré par l'invité : capture → affichage, et sa propre part (réception → affichage), en ms. */
  guestLatencyMs: number | null;
  guestDisplayMs: number | null;
  localCandidate: string | null;
  remoteCandidate: string | null;
  /** Type de connexion : `loopback`, `lan` ou `internet` (P2P direct, jamais de relais). */
  path: string | null;
  natV4: string | null;
  natV6: string | null;
  inputs: { received: number; rejected: number; denied: number; injected: number; failed: number; pings: number };
}

export type GuestProfile = "spectator" | "player" | "collaborator";

export const remotePlayApi = {
  config: () => (isTauri() ? invoke<RemotePlayConfig>("remote_play_config") : Promise.reject(new Error("iBox natif requis"))),
  setConfig: (config: RemotePlayConfig) => invoke<RemotePlayConfig>("remote_play_set_config", { config }),
  diagnoseHost: () => invoke<HostReport>("remote_play_diagnose"),
  /** Démarre l'hôte : boucle locale (127.0.0.1, invité spectateur) ou réseau local. Renvoie l'offre SDP. */
  hostStart: (lan: boolean, profile?: GuestProfile) => invoke<{ sdp: string; lan: boolean }>("remote_play_host_start", { args: { lan, profile } }),
  /** Réponse de l'invité ; renvoie le code de vérification. */
  hostAnswer: (sdp: string) => invoke<string>("remote_play_host_answer", { sdp }),
  hostStats: () => invoke<HostStats | null>("remote_play_host_stats"),
  hostStop: () => invoke<HostStats | null>("remote_play_host_stop"),
  /** Pilote ViGEmBus (manettes des invités) et manette d'invité en attente. */
  padDriver: () => invoke<PadDriver>("remote_play_pad_driver"),
  /** Télécharge et installe ViGEmBus ; Windows demande l'accord (UAC). */
  installPadDriver: () => invoke<PadDriver>("remote_play_install_pad_driver"),
  /** Bandeau de l'hôte réduit en pastille ou affiché en entier. */
  indicatorCompact: (compact: boolean) => invoke<void>("remote_play_indicator_compact", { compact }),
};

export interface PadDriver {
  installed: boolean;
  guestPadWaiting: boolean;
}

export interface NetworkReport {
  /** UDP sortant fonctionne et un serveur STUN a répondu */
  stun: boolean;
  /** familles d'adresses publiques obtenues par STUN (jamais l'adresse elle-même) */
  publicFamilies: ("IPv4" | "IPv6")[];
  elapsedMs: number;
}

/**
 * Test réel de connectivité : rassemble les candidats ICE auprès des serveurs STUN configurés.
 * Seul le serveur STUN est contacté (il voit l'adresse publique, comme tout STUN).
 */
export async function testNetwork(stunServers: string[], timeoutMs = 5000): Promise<NetworkReport> {
  const started = performance.now();
  const pc = new RTCPeerConnection({ iceServers: stunServers.length ? [{ urls: stunServers }] : [] });
  const families = new Set<"IPv4" | "IPv6">();
  try {
    pc.createDataChannel("probe");
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, timeoutMs);
      pc.onicecandidate = (e) => {
        if (!e.candidate) {
          window.clearTimeout(timer);
          resolve();
          return;
        }
        const { type, address } = e.candidate;
        const v6 = !!address && address.includes(":");
        if (type === "srflx") families.add(v6 ? "IPv6" : "IPv4");
      };
      void pc.createOffer().then((o) => pc.setLocalDescription(o));
    });
  } finally {
    pc.close();
  }
  return { stun: families.size > 0, publicFamilies: [...families], elapsedMs: Math.round(performance.now() - started) };
}

/** Interroge réellement la pile WebRTC du WebView (aucune valeur supposée). */
export async function diagnoseGuest(): Promise<GuestReport> {
  const webrtc = typeof RTCPeerConnection !== "undefined" && typeof RTCRtpReceiver?.getCapabilities === "function";
  const caps = webrtc ? RTCRtpReceiver.getCapabilities("video")?.codecs ?? [] : [];
  const decode: GuestReport["decode"] = {};
  for (const [name, mime] of Object.entries(MIME) as [keyof GuestReport["decode"], string][]) {
    if (!caps.some((c) => c.mimeType.toLowerCase() === mime.toLowerCase())) continue;
    let smooth = false;
    let hardware = false;
    try {
      const info = await navigator.mediaCapabilities.decodingInfo({
        type: "webrtc",
        video: { contentType: mime, width: 1920, height: 1080, bitrate: 20_000_000, framerate: 60 },
      });
      smooth = info.smooth;
      hardware = info.powerEfficient;
    } catch {
      /* mediaCapabilities indisponible : le codec reste listé, sans précision matérielle */
    }
    decode[name] = { smooth, hardware };
  }
  return { webrtc, decode, gamepadApi: typeof navigator.getGamepads === "function" };
}
