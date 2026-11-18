/**
 * Remote Play — côté invité, dans le WebView2 d'iBox (Phases 1c/2, `docs/REMOTE-PLAY.md` §11).
 *
 * L'hôte (Rust, str0m) fait l'offre : une piste vidéo H.264 en envoi seul et deux DataChannels,
 * `input` (non ordonné, 0 retransmission) et `control` (fiable). L'invité répond, lit la vidéo
 * avec le plus petit tampon possible et envoie souris, clavier et manette au format binaire v1
 * (`src-tauri/src/remote_play/protocol.rs`). Toutes les statistiques viennent de `getStats()`.
 */

// ——— Protocole v1 (petit-boutiste, longueur exacte) ———

export const MSG = {
  mouseAbs: 0x10,
  mouseRel: 0x11,
  mouseButton: 0x12,
  wheel: 0x13,
  key: 0x20,
  keyState: 0x21,
  gamepad: 0x30,
  rumble: 0x31,
  chat: 0x40,
  ping: 0x50,
  pong: 0x51,
} as const;

export const MAX_HELD_KEYS = 16;

const i16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v))) + 0; // + 0 : pas de -0
const u16 = (v: number) => Math.max(0, Math.min(65535, Math.round(v)));

function message(type: number, size: number, fill: (v: DataView) => void): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(1 + size);
  buf[0] = type;
  fill(new DataView(buf.buffer, 1));
  return buf;
}

export const encode = {
  /** x, y : 0–65535 normalisés sur l'image partagée. */
  mouseAbs: (seq: number, x: number, y: number) =>
    message(MSG.mouseAbs, 8, (v) => {
      v.setUint32(0, seq >>> 0, true);
      v.setUint16(4, u16(x), true);
      v.setUint16(6, u16(y), true);
    }),
  /** 0 gauche, 1 droit, 2 milieu, 3 X1 (précédent), 4 X2 (suivant). */
  mouseButton: (button: number, down: boolean) => message(MSG.mouseButton, 2, (v) => (v.setUint8(0, button), v.setUint8(1, down ? 1 : 0))),
  /** Unités Windows (120 = un cran) ; dy > 0 = vers le haut, dx > 0 = vers la droite. */
  wheel: (dx: number, dy: number) => message(MSG.wheel, 4, (v) => (v.setInt16(0, i16(dx), true), v.setInt16(2, i16(dy), true))),
  key: (scancode: number, down: boolean) => message(MSG.key, 3, (v) => (v.setUint16(0, scancode, true), v.setUint8(2, down ? 1 : 0))),
  keyState: (seq: number, held: number[]) => {
    const keys = held.slice(0, MAX_HELD_KEYS);
    return message(MSG.keyState, 5 + keys.length * 2, (v) => {
      v.setUint32(0, seq >>> 0, true);
      v.setUint8(4, keys.length);
      keys.forEach((k, i) => v.setUint16(5 + i * 2, k, true));
    });
  },
  gamepad: (pad: number, seq: number, s: PadWire) =>
    message(MSG.gamepad, 17, (v) => {
      v.setUint8(0, pad);
      v.setUint32(1, seq >>> 0, true);
      v.setUint16(5, s.buttons, true);
      v.setUint8(7, s.lt);
      v.setUint8(8, s.rt);
      [s.lx, s.ly, s.rx, s.ry].forEach((a, i) => v.setInt16(9 + i * 2, i16(a), true));
    }),
  ping: (id: number, micros: number) =>
    message(MSG.ping, 12, (v) => {
      v.setUint32(0, id >>> 0, true);
      v.setBigUint64(4, BigInt(Math.max(0, Math.floor(micros))), true);
    }),
};

export type HostMessage = { type: "pong"; id: number; micros: number } | { type: "rumble"; pad: number; large: number; small: number };

/** Messages hôte → invité (canal `control`) ; tout le reste est ignoré. */
export function decodeHost(data: ArrayBuffer): HostMessage | null {
  const v = new DataView(data);
  if (v.byteLength === 13 && v.getUint8(0) === MSG.pong) return { type: "pong", id: v.getUint32(1, true), micros: Number(v.getBigUint64(5, true)) };
  if (v.byteLength === 4 && v.getUint8(0) === MSG.rumble && v.getUint8(1) < 4) return { type: "rumble", pad: v.getUint8(1), large: v.getUint8(2), small: v.getUint8(3) };
  return null;
}

// ——— Clavier : KeyboardEvent.code → code de balayage (jeu 1, 0xE0xx = étendu) ———

const ROWS: [string, number][] = [
  ["Escape", 0x01], ["Minus", 0x0c], ["Equal", 0x0d], ["Backspace", 0x0e], ["Tab", 0x0f],
  ["BracketLeft", 0x1a], ["BracketRight", 0x1b], ["Enter", 0x1c], ["ControlLeft", 0x1d],
  ["Semicolon", 0x27], ["Quote", 0x28], ["Backquote", 0x29], ["ShiftLeft", 0x2a], ["Backslash", 0x2b],
  ["Comma", 0x33], ["Period", 0x34], ["Slash", 0x35], ["ShiftRight", 0x36], ["NumpadMultiply", 0x37],
  ["AltLeft", 0x38], ["Space", 0x39], ["CapsLock", 0x3a], ["NumLock", 0x45], ["ScrollLock", 0x46],
  ["Numpad7", 0x47], ["Numpad8", 0x48], ["Numpad9", 0x49], ["NumpadSubtract", 0x4a], ["Numpad4", 0x4b],
  ["Numpad5", 0x4c], ["Numpad6", 0x4d], ["NumpadAdd", 0x4e], ["Numpad1", 0x4f], ["Numpad2", 0x50],
  ["Numpad3", 0x51], ["Numpad0", 0x52], ["NumpadDecimal", 0x53], ["IntlBackslash", 0x56], ["F11", 0x57], ["F12", 0x58],
  ["NumpadEnter", 0xe01c], ["ControlRight", 0xe01d], ["NumpadDivide", 0xe035], ["PrintScreen", 0xe037],
  ["AltRight", 0xe038], ["Home", 0xe047], ["ArrowUp", 0xe048], ["PageUp", 0xe049], ["ArrowLeft", 0xe04b],
  ["ArrowRight", 0xe04d], ["End", 0xe04f], ["ArrowDown", 0xe050], ["PageDown", 0xe051], ["Insert", 0xe052],
  ["Delete", 0xe053], ["MetaLeft", 0xe05b], ["MetaRight", 0xe05c], ["ContextMenu", 0xe05d],
];

export const SCANCODES: Record<string, number> = Object.fromEntries([
  ...ROWS,
  ..."1234567890".split("").map((d, i) => [`Digit${d}`, 0x02 + i] as [string, number]),
  ..."QWERTYUIOP".split("").map((k, i) => [`Key${k}`, 0x10 + i] as [string, number]),
  ..."ASDFGHJKL".split("").map((k, i) => [`Key${k}`, 0x1e + i] as [string, number]),
  ..."ZXCVBNM".split("").map((k, i) => [`Key${k}`, 0x2c + i] as [string, number]),
  ...Array.from({ length: 10 }, (_, i) => [`F${i + 1}`, 0x3b + i] as [string, number]),
]);

// ——— Manette : API Gamepad (disposition standard) → XInput ———

export interface PadWire {
  buttons: number;
  lt: number;
  rt: number;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
}

/** Bit XInput de chaque bouton de la disposition standard (index = bouton du navigateur). */
const XINPUT_BITS = [
  0x1000, 0x2000, 0x4000, 0x8000, // A B X Y
  0x0100, 0x0200, 0, 0, // LB RB (LT/RT : analogiques)
  0x0020, 0x0010, 0x0040, 0x0080, // Back Start LS RS
  0x0001, 0x0002, 0x0004, 0x0008, // haut bas gauche droite
  0x0400, // Guide
];

export function padWire(buttons: { pressed: boolean; value: number }[], axes: readonly number[]): PadWire {
  let bits = 0;
  buttons.forEach((b, i) => {
    if (b.pressed && XINPUT_BITS[i]) bits |= XINPUT_BITS[i];
  });
  const axis = (i: number, invert = false) => (axes[i] ?? 0) * (invert ? -32767 : 32767);
  const trigger = (i: number) => Math.round(Math.max(0, Math.min(1, buttons[i]?.value ?? 0)) * 255);
  // XInput : Y positif vers le haut ; navigateur : vers le bas
  return { buttons: bits, lt: trigger(6), rt: trigger(7), lx: i16(axis(0)), ly: i16(axis(1, true)), rx: i16(axis(2)), ry: i16(axis(3, true)) };
}

// ——— Souris : position dans l'image affichée (object-fit: contain) ———

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Rectangle réellement occupé par l'image dans l'élément (bandes noires exclues). */
export function contentRect(videoW: number, videoH: number, el: Box): Box {
  if (!videoW || !videoH || !el.width || !el.height) return el;
  const scale = Math.min(el.width / videoW, el.height / videoH);
  const width = videoW * scale;
  const height = videoH * scale;
  return { left: el.left + (el.width - width) / 2, top: el.top + (el.height - height) / 2, width, height };
}

/** Point de l'écran → 0–65535 sur l'image, ou `null` hors de l'image. */
export function normalizePoint(x: number, y: number, r: Box): [number, number] | null {
  const nx = (x - r.left) / r.width;
  const ny = (y - r.top) / r.height;
  if (!(nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1)) return null;
  return [Math.round(nx * 65535), Math.round(ny * 65535)];
}

/** Molette du navigateur → unités Windows (120 = un cran, positif = vers le haut). */
export function wheelUnits(deltaX: number, deltaY: number, deltaMode: number): [number, number] {
  const notch = deltaMode === 1 ? 3 : deltaMode === 2 ? 1 / 3 : 100; // lignes, pages, pixels
  return [i16((deltaX / notch) * 120), i16((-deltaY / notch) * 120)];
}

// ——— Échange manuel des SDP (LAN) et code de vérification ———

const PREFIX = { offer: "IBOX-RP1-OFFRE:", answer: "IBOX-RP1-REPONSE:" } as const;

export function packSdp(kind: keyof typeof PREFIX, sdp: string): string {
  const bytes = new TextEncoder().encode(sdp);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return PREFIX[kind] + btoa(bin);
}

export function unpackSdp(kind: keyof typeof PREFIX, text: string): string {
  const t = text.replace(/\s+/g, "");
  if (!t.startsWith(PREFIX[kind])) throw new Error(kind === "offer" ? "Ce n'est pas une offre iBox Remote Play." : "Ce n'est pas une réponse iBox Remote Play.");
  const bin = atob(t.slice(PREFIX[kind].length));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Empreinte DTLS normalisée (`sha-256 AB:…`), comme `signaling::envelope::normalize_fingerprint`. */
export function fingerprintOf(sdp: string): string | null {
  const line = sdp.split(/\r?\n/).find((l) => l.startsWith("a=fingerprint:"));
  if (!line) return null;
  const [algo, hex] = line.slice("a=fingerprint:".length).trim().split(/\s+/);
  if (!algo || !hex || algo.toLowerCase() !== "sha-256" || !/^([0-9a-fA-F]{2}:){31}[0-9a-fA-F]{2}$/.test(hex)) return null;
  return `sha-256 ${hex.toUpperCase()}`;
}

/** Même calcul que `transport::sdp::verification_code` (Rust). */
export async function verificationCode(offerFingerprint: string, answerFingerprint: string): Promise<string> {
  const data = new TextEncoder().encode(`ibox-rp-lan/1\n${offerFingerprint}\n${answerFingerprint}`);
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [0, 2, 4].map((i) => String(((d[i] << 8) | d[i + 1]) % 10000).padStart(4, "0")).join(" ");
}

// ——— Session ———

export interface GuestStats {
  state: RTCPeerConnectionState;
  /** RTT de la paire ICE (STUN) et du ping applicatif sur `control`. */
  rttMs: number | null;
  pingMs: number | null;
  fps: number | null;
  bitrateKbps: number | null;
  jitterMs: number | null;
  packetsLost: number | null;
  lossPct: number | null;
  /** Retard moyen ajouté par le tampon de gigue sur la dernière période. */
  jitterBufferMs: number | null;
  decodeMs: number | null;
  framesDropped: number | null;
  freezeCount: number | null;
  resolution: string | null;
  decoder: string | null;
  hardwareDecoder: boolean | null;
  /** Capture chez l'hôte → affichage prévu ici (requestVideoFrameCallback, horloge RTCP). */
  captureToDisplayMs: number | null;
  /** Le navigateur a-t-il accepté `jitterBufferTarget = 0` ? */
  minimalBuffer: boolean;
}

interface Prev {
  at: number;
  bytes: number;
  packets: number;
  lost: number;
  jbDelay: number;
  jbCount: number;
  decodeTime: number;
  decoded: number;
}

type VideoFrameMeta = { captureTime?: number; expectedDisplayTime: number };
type FrameCallbackVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: VideoFrameMeta) => void) => number };

export class GuestSession {
  readonly pc: RTCPeerConnection;
  private input: RTCDataChannel | null = null;
  private control: RTCDataChannel | null = null;
  private prev: Prev | null = null;
  private pings = new Map<number, number>();
  private pingMs: number | null = null;
  private pingTimer = 0;
  private pingId = 0;
  private latency: number[] = [];
  private minimalBuffer = false;
  private closed = false;
  private seq = 0;
  private readonly media = new MediaStream();

  /** Numéro de séquence des entrées, commun à toute la session : l'hôte refuse tout numéro déjà vu
   * (un compteur qui repartirait de 1 après « Rendre les commandes » serait ignoré). */
  nextSeq(): number {
    this.seq = (this.seq + 1) >>> 0;
    return this.seq;
  }

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly onRumble?: (pad: number, large: number, small: number) => void,
    /** Par Internet : serveurs STUN (adresse publique de l'invité) ; jamais de TURN. */
    stunServers: string[] = [],
  ) {
    // sans STUN (boucle locale, LAN), l'invité est découvert par ses requêtes (peer-reflexive)
    const urls = stunServers.filter((u) => u.startsWith("stun:"));
    this.pc = new RTCPeerConnection({ iceServers: urls.length ? [{ urls }] : [], bundlePolicy: "max-bundle", iceTransportPolicy: "all" });
    this.pc.ontrack = (e) => {
      const receiver = e.receiver as RTCRtpReceiver & { jitterBufferTarget?: number | null; playoutDelayHint?: number };
      // image et son (piste Opus de l'hôte) dans un seul flux lu par l'élément <video>
      if (!this.media.getTracks().includes(e.track)) this.media.addTrack(e.track);
      if (this.video.srcObject !== this.media) this.video.srcObject = this.media;
      if (e.track.kind === "audio") {
        // tampon audio minimal aussi (le son a son propre flux : il ne retarde plus l'image)
        try {
          receiver.jitterBufferTarget = 0;
        } catch {
          /* tampon par défaut */
        }
        this.unmute();
        return;
      }
      try {
        receiver.jitterBufferTarget = 0;
        this.minimalBuffer = receiver.jitterBufferTarget === 0;
      } catch {
        this.minimalBuffer = false;
      }
      if (!this.minimalBuffer && "playoutDelayHint" in receiver) receiver.playoutDelayHint = 0;
      if (!this.media.getAudioTracks().length) this.video.muted = true;
      void this.video.play().catch(() => undefined);
      this.watchFrames();
    };
    this.pc.ondatachannel = (e) => {
      const ch = e.channel;
      ch.binaryType = "arraybuffer";
      if (ch.label === "input") this.input = ch;
      if (ch.label === "control") {
        this.control = ch;
        ch.onmessage = (m) => m.data instanceof ArrayBuffer && this.onHost(decodeHost(m.data));
        ch.onopen = () => this.startPings();
        if (ch.readyState === "open") this.startPings();
        // l'hôte a arrêté (canal fermé de son côté) : l'invité retrouve iBox aussitôt
        ch.onclose = () => {
          if (!this.closed) this.onHostGone?.();
        };
      }
    };
    this.pc.addEventListener("connectionstatechange", () => {
      if (!this.closed && this.pc.connectionState === "closed") this.onHostGone?.();
    });
  }

  /** Appelé une fois quand l'hôte met fin à la session (canal de contrôle fermé de son côté). */
  onHostGone?: () => void;

  /**
   * Accepte l'offre de l'hôte et renvoie la réponse (candidats trouvés dans `gatherMs`).
   * `onLateCandidate` reçoit ensuite les candidats trouvés trop tard (trickle).
   */
  async accept(offer: string, gatherMs = 1500, onLateCandidate?: (candidate: string) => void): Promise<string> {
    let answered = false;
    this.pc.addEventListener("icecandidate", (e) => {
      if (answered && e.candidate?.candidate) onLateCandidate?.(e.candidate.candidate);
    });
    await this.pc.setRemoteDescription({ type: "offer", sdp: offer });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await new Promise<void>((resolve) => {
      if (this.pc.iceGatheringState === "complete") return resolve();
      const done = () => this.pc.iceGatheringState === "complete" && resolve();
      this.pc.addEventListener("icegatheringstatechange", done);
      setTimeout(resolve, gatherMs);
    });
    const sdp = this.pc.localDescription?.sdp;
    if (!sdp) throw new Error("Réponse WebRTC indisponible");
    answered = true;
    return sdp;
  }

  /** Code à comparer avec celui affiché par l'hôte. */
  async verificationCode(): Promise<string | null> {
    const a = fingerprintOf(this.pc.remoteDescription?.sdp ?? "");
    const b = fingerprintOf(this.pc.localDescription?.sdp ?? "");
    return a && b ? verificationCode(a, b) : null;
  }

  send(channel: "input" | "control", data: Uint8Array<ArrayBuffer>): boolean {
    const ch = channel === "input" ? this.input : this.control;
    if (!ch || ch.readyState !== "open") return false;
    // canal non fiable : inutile d'empiler si le réseau ne suit pas, l'état suivant remplacera celui-ci
    if (channel === "input" && ch.bufferedAmount > 16 * 1024) return false;
    ch.send(data);
    return true;
  }

  private onHost(msg: HostMessage | null) {
    if (msg?.type === "pong") {
      const sent = this.pings.get(msg.id);
      if (sent !== undefined) {
        this.pingMs = performance.now() - sent;
        this.pings.delete(msg.id);
      }
      this.lastPong = performance.now();
    } else if (msg?.type === "rumble") {
      this.onRumble?.(msg.pad, msg.large, msg.small);
    }
  }

  private startPings() {
    if (this.pingTimer) return;
    this.pingTimer = window.setInterval(() => {
      this.pingId += 1;
      const now = performance.now();
      this.pings.set(this.pingId, now);
      if (this.pings.size > 20) this.pings.delete(this.pings.keys().next().value!);
      this.send("control", encode.ping(this.pingId, now * 1000));
      // l'hôte répondait et se tait depuis 6 s (PC éteint, iBox fermé, session coupée) : fin
      if (this.lastPong && now - this.lastPong > 6000 && !this.closed) {
        this.lastPong = 0;
        this.onHostGone?.();
      }
    }, 1000);
  }
  private lastPong = 0;

  private watchFrames() {
    const v = this.video as FrameCallbackVideo;
    if (!v.requestVideoFrameCallback) return;
    const onFrame = (_: number, meta: VideoFrameMeta) => {
      if (this.closed) return;
      if (typeof meta.captureTime === "number" && meta.captureTime > 0) {
        this.latency.push(meta.expectedDisplayTime - meta.captureTime);
        if (this.latency.length > 120) this.latency.shift();
      }
      v.requestVideoFrameCallback!(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
  }

  async stats(): Promise<GuestStats> {
    const report = await this.pc.getStats();
    let inbound: Record<string, number | string | boolean | undefined> | null = null;
    let pairId: string | undefined;
    const pairs: Record<string, Record<string, unknown>> = {};
    report.forEach((s: Record<string, unknown>) => {
      if (s.type === "inbound-rtp" && s.kind === "video") inbound = s as typeof inbound;
      if (s.type === "transport" && typeof s.selectedCandidatePairId === "string") pairId = s.selectedCandidatePairId;
      if (s.type === "candidate-pair") pairs[s.id as string] = s;
    });
    const pair = (pairId && pairs[pairId]) || Object.values(pairs).find((p) => p.nominated && p.state === "succeeded");
    const rtt = typeof pair?.currentRoundTripTime === "number" ? pair.currentRoundTripTime * 1000 : null;
    const out: GuestStats = {
      state: this.pc.connectionState,
      rttMs: rtt,
      pingMs: this.pingMs,
      fps: null,
      bitrateKbps: null,
      jitterMs: null,
      packetsLost: null,
      lossPct: null,
      jitterBufferMs: null,
      decodeMs: null,
      framesDropped: null,
      freezeCount: null,
      resolution: null,
      decoder: null,
      hardwareDecoder: null,
      captureToDisplayMs: this.latency.length ? [...this.latency].sort((a, b) => a - b)[this.latency.length >> 1] : null,
      minimalBuffer: this.minimalBuffer,
    };
    const s = inbound as Record<string, number | string | boolean | undefined> | null;
    if (!s) return out;
    const n = (k: string) => (typeof s[k] === "number" ? (s[k] as number) : 0);
    const now = n("timestamp") || performance.now();
    const cur: Prev = {
      at: now,
      bytes: n("bytesReceived"),
      packets: n("packetsReceived"),
      lost: n("packetsLost"),
      jbDelay: n("jitterBufferDelay"),
      jbCount: n("jitterBufferEmittedCount"),
      decodeTime: n("totalDecodeTime"),
      decoded: n("framesDecoded"),
    };
    out.fps = typeof s.framesPerSecond === "number" ? s.framesPerSecond : null;
    out.jitterMs = typeof s.jitter === "number" ? s.jitter * 1000 : null;
    out.packetsLost = cur.lost;
    out.framesDropped = typeof s.framesDropped === "number" ? s.framesDropped : null;
    out.freezeCount = typeof s.freezeCount === "number" ? s.freezeCount : null;
    out.resolution = s.frameWidth ? `${s.frameWidth}×${s.frameHeight}` : null;
    out.decoder = typeof s.decoderImplementation === "string" ? s.decoderImplementation : null;
    out.hardwareDecoder = typeof s.powerEfficientDecoder === "boolean" ? s.powerEfficientDecoder : null;
    const p = this.prev;
    if (p && cur.at > p.at) {
      const dt = (cur.at - p.at) / 1000;
      out.bitrateKbps = ((cur.bytes - p.bytes) * 8) / 1000 / dt;
      const lost = cur.lost - p.lost;
      const total = cur.packets - p.packets + lost;
      out.lossPct = total > 0 ? (Math.max(0, lost) / total) * 100 : 0;
      if (cur.jbCount > p.jbCount) out.jitterBufferMs = ((cur.jbDelay - p.jbDelay) / (cur.jbCount - p.jbCount)) * 1000;
      if (cur.decoded > p.decoded) out.decodeMs = ((cur.decodeTime - p.decodeTime) / (cur.decoded - p.decoded)) * 1000;
    }
    this.prev = cur;
    return out;
  }

  /** Active le son ; si le navigateur refuse la lecture sonore sans geste, l'image reste lue
   * (muette) et le son revient au premier clic ou à la première touche. */
  private unmute() {
    this.video.muted = false;
    this.video.volume = 1;
    this.video.play().catch(() => {
      this.video.muted = true;
      void this.video.play().catch(() => undefined);
      const retry = () => {
        window.removeEventListener("pointerdown", retry, true);
        window.removeEventListener("keydown", retry, true);
        if (this.closed) return;
        this.video.muted = false;
        void this.video.play().catch(() => undefined);
      };
      window.addEventListener("pointerdown", retry, true);
      window.addEventListener("keydown", retry, true);
    });
  }

  close() {
    this.closed = true;
    window.clearInterval(this.pingTimer);
    this.media.getTracks().forEach((t) => this.media.removeTrack(t));
    this.pc.close();
    this.video.srcObject = null;
  }
}

// ——— Entrées de l'invité ———

/** `pointerrawupdate` : chaque mouvement de souris dès qu'il arrive, sans attendre l'image suivante
 * comme `pointermove` (Chromium les regroupe par image affichée). Repli sur `pointermove`. */
const MOVE_EVENT = typeof window !== "undefined" && "onpointerrawupdate" in window ? "pointerrawupdate" : "pointermove";

/** Première manette branchée et vue par Windows (le navigateur n'en montre aucune avant le premier
 * appui sur un de ses boutons). */
function firstPad(): Gamepad | undefined {
  return navigator.getGamepads?.().find((p): p is Gamepad => !!p && p.connected);
}

/**
 * Envoie la première manette de l'invité à l'hôte tant que la fonction renvoyée n'est pas appelée,
 * dès qu'elle apparaît (branchée en cours de session comprise). `onPad` reçoit son nom, ou `null`
 * tant qu'aucune n'est visible ; `onPadCapture` dit si iBox doit cesser de naviguer avec.
 */
/** Ce qu'il faut à `attachPad` : la session du WebView ou celle de l'invité natif (Steam Deck). */
export type InputSink = Pick<GuestSession, "send" | "nextSeq">;

export function attachPad(
  session: InputSink,
  opts: { onPad?: (name: string | null) => void; onPadCapture?: (active: boolean) => void; paused?: () => boolean } = {},
): () => void {
  // lue toutes les 4 ms (fréquence d'échantillonnage de Chromium) et non à chaque image affichée :
  // jusqu'à 12 ms de moins entre l'appui et l'envoi
  let timer = 0;
  let lastPad = "";
  let lastSent = 0;
  let name: string | null | undefined;
  const announce = (pad: Gamepad | undefined) => {
    const next = pad ? pad.id : null;
    if (next === name) return;
    name = next;
    opts.onPad?.(next);
    opts.onPadCapture?.(!!pad);
  };
  let wasPaused = false;
  const pollPad = () => {
    const pad = firstPad();
    // menu de l'invité ouvert : la manette sert à iBox, l'hôte la voit relâchée
    const paused = !!opts.paused?.();
    if (paused !== wasPaused) {
      wasPaused = paused;
      if (paused && name) session.send("input", encode.gamepad(0, session.nextSeq(), padWire([], [])));
      opts.onPadCapture?.(!paused && !!name);
      lastPad = "";
    }
    if (paused) {
      announce(pad);
      if (pad) opts.onPadCapture?.(false);
      return;
    }
    announce(pad);
    if (pad) {
      const wire = padWire([...pad.buttons], pad.axes);
      const sig = JSON.stringify(wire);
      const now = performance.now();
      // état complet : envoyé à chaque changement et toutes les 100 ms (canal non fiable)
      if (sig !== lastPad || now - lastSent > 100) {
        session.send("input", encode.gamepad(0, session.nextSeq(), wire));
        lastPad = sig;
        lastSent = now;
      }
    }
  };
  timer = window.setInterval(pollPad, 4);
  return () => {
    window.clearInterval(timer);
    if (name) session.send("input", encode.gamepad(0, session.nextSeq(), padWire([], [])));
    opts.onPadCapture?.(false);
  };
}

/**
 * Branche souris, clavier et (si `pad` n'est pas `false`) première manette sur `session` tant que
 * la fonction renvoyée n'est pas appelée. Le clavier est capturé avant la navigation d'iBox ; tout
 * ce qui est tenu est relâché à la sortie (et l'hôte relâche tout à la déconnexion).
 */
/** Surface de l'image de l'hôte : `<video>` (WebRTC) ou `<canvas>` (invité natif, Steam Deck). */
export type Surface = HTMLVideoElement | HTMLCanvasElement;

/** Taille de l'image affichée (et non de l'élément), pour situer la souris. */
const frameSize = (s: Surface): [number, number] => (s instanceof HTMLVideoElement ? [s.videoWidth, s.videoHeight] : [s.width, s.height]);

export function attachInputs(
  session: InputSink,
  video: Surface,
  opts: { pad?: boolean; mouse?: boolean; keyboard?: boolean; onPad?: (name: string | null) => void; onPadCapture?: (active: boolean) => void } = {},
): () => void {
  const withMouse = opts.mouse !== false;
  const withKeys = opts.keyboard !== false;
  const held = new Set<number>();
  const next = () => session.nextSeq();
  const area = () => contentRect(...frameSize(video), video.getBoundingClientRect());
  // écouteurs typés : une surface reste un élément HTML
  const el: HTMLElement = video;

  const move = (e: PointerEvent) => {
    const p = normalizePoint(e.clientX, e.clientY, area());
    if (p) session.send("input", encode.mouseAbs(next(), p[0], p[1]));
  };
  const BUTTONS = [0, 2, 1, 3, 4]; // navigateur (gauche, milieu, droit, précédent, suivant) → protocole
  const button = (down: boolean) => (e: PointerEvent) => {
    const b = BUTTONS[e.button];
    if (b === undefined) return;
    move(e);
    session.send("control", encode.mouseButton(b, down));
    e.preventDefault();
  };
  const onDown = button(true);
  const onUp = button(false);
  const onWheel = (e: WheelEvent) => {
    const [dx, dy] = wheelUnits(e.deltaX, e.deltaY, e.deltaMode);
    if (dx || dy) session.send("control", encode.wheel(dx, dy));
    e.preventDefault();
  };
  const onContext = (e: Event) => e.preventDefault();

  const key = (down: boolean) => (e: KeyboardEvent) => {
    const code = SCANCODES[e.code];
    // capture avant la navigation d'iBox (InputController écoute en phase de bouillonnement)
    e.preventDefault();
    e.stopImmediatePropagation();
    if (code === undefined || (down && e.repeat)) return;
    if (down) {
      if (held.size >= MAX_HELD_KEYS && !held.has(code)) return;
      held.add(code);
    } else held.delete(code);
    session.send("control", encode.key(code, down));
  };
  const onKeyDown = key(true);
  const onKeyUp = key(false);
  const pressed = new Set<number>();
  const releaseAll = () => {
    if (withKeys) {
      for (const code of held) session.send("control", encode.key(code, false));
      held.clear();
      session.send("input", encode.keyState(next(), []));
    }
    for (const b of pressed) session.send("control", encode.mouseButton(b, false));
    pressed.clear();
  };
  const keyState = withKeys ? window.setInterval(() => session.send("input", encode.keyState(next(), [...held])), 250) : 0;
  const trackDown = (e: PointerEvent) => {
    const b = BUTTONS[e.button];
    if (b !== undefined) pressed.add(b);
    onDown(e);
  };
  const trackUp = (e: PointerEvent) => {
    const b = BUTTONS[e.button];
    if (b !== undefined) pressed.delete(b);
    onUp(e);
  };

  const detachPad = opts.pad === false ? null : attachPad(session, opts);

  if (withMouse) {
    el.addEventListener(MOVE_EVENT, move as EventListener);
    el.addEventListener("pointerdown", trackDown);
    el.addEventListener("pointerup", trackUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", onContext);
  }
  if (withKeys) {
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
  }
  window.addEventListener("blur", releaseAll);
  return () => {
    releaseAll();
    if (keyState) window.clearInterval(keyState);
    detachPad?.();
    el.removeEventListener(MOVE_EVENT, move as EventListener);
    el.removeEventListener("pointerdown", trackDown);
    el.removeEventListener("pointerup", trackUp);
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("contextmenu", onContext);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", releaseAll);
  };
}
