/**
 * Invité Remote Play natif (Steam Deck, option A de docs/STEAMDECK.md §6.2 ; prototype D3).
 *
 * WebKitGTK n'a pas de WebRTC : str0m reçoit le flux en Rust (`remote_play/guest`), les images
 * H.264 arrivent ici par un `Channel` Tauri binaire, puis WebCodecs (`VideoDecoder`) les décode
 * et elles sont dessinées dans un `<canvas>`. Trame : voir `remote_play/guest/mod.rs`.
 */

/** En-tête binaire d'une trame (16 octets). */
export const HEADER = 16;
export const enum Kind {
  Video = 1,
  Audio = 2,
  Control = 3,
  Connected = 4,
  Disconnected = 5,
}

export interface Frame {
  kind: Kind;
  keyframe: boolean;
  /** Temps RTP (90 kHz pour l'image, 48 kHz pour le son). */
  rtpTime: number;
  /** Arrivée du premier paquet, en µs depuis le début de la session (horloge Rust). */
  arrivedUs: number;
  data: Uint8Array;
}

export function parseFrame(buf: ArrayBuffer): Frame | null {
  if (buf.byteLength < HEADER) return null;
  const v = new DataView(buf);
  return {
    kind: v.getUint8(0) as Kind,
    keyframe: (v.getUint8(1) & 1) === 1,
    rtpTime: Number(v.getBigUint64(4, true)),
    arrivedUs: v.getUint32(12, true),
    data: new Uint8Array(buf, HEADER),
  };
}

/** Extrait enregistré (`enregistre_un_extrait`) : `[u32 longueur][u8 clé][u64 temps RTP][données]`. */
export function parseSample(buf: ArrayBuffer): Frame[] {
  const out: Frame[] = [];
  const v = new DataView(buf);
  let at = 0;
  while (at + 13 <= buf.byteLength) {
    const len = v.getUint32(at, true);
    if (at + 13 + len > buf.byteLength) break;
    out.push({ kind: Kind.Video, keyframe: v.getUint8(at + 4) === 1, rtpTime: Number(v.getBigUint64(at + 5, true)), arrivedUs: 0, data: new Uint8Array(buf, at + 13, len) });
    at += 13 + len;
  }
  return out;
}

/** Chaîne de codec WebCodecs (`avc1.PPCCLL`) lue dans le SPS d'une image clé Annex B. */
export function codecFromKeyframe(data: Uint8Array): string | null {
  for (let i = 0; i + 4 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1 && (data[i + 3] & 0x1f) === 7 && i + 6 < data.length) {
      const hex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
      return `avc1.${hex(data[i + 4])}${hex(data[i + 5])}${hex(data[i + 6])}`;
    }
  }
  return null;
}

/** Unités NAL d'un flux Annex B (codes de début de 3 ou 4 octets retirés). */
export function splitNals(data: Uint8Array): Uint8Array[] {
  const starts: number[] = [];
  for (let i = 0; i + 2 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      starts.push(i + 3);
      i += 2;
    }
  }
  return starts.map((st, k) => {
    let end = k + 1 < starts.length ? starts[k + 1] - 3 : data.length;
    // code de début sur 4 octets : le zéro qui le précède n'appartient pas à l'unité
    while (end > st && data[end - 1] === 0 && k + 1 < starts.length) end--;
    return data.subarray(st, end);
  });
}

/** Annex B → AVC (longueur sur 4 octets avant chaque unité), format qu'exige WebKitGTK. */
export function annexBToAvc(data: Uint8Array): Uint8Array {
  const nals = splitNals(data);
  const out = new Uint8Array(nals.reduce((n, u) => n + 4 + u.length, 0));
  const v = new DataView(out.buffer);
  let at = 0;
  for (const u of nals) {
    v.setUint32(at, u.length);
    out.set(u, at + 4);
    at += 4 + u.length;
  }
  return out;
}

/**
 * En-tête `avcC` (ISO/IEC 14496-15) construit avec le SPS et le PPS d'une image clé : la
 * `description` du décodeur. Sans elle, WebKitGTK annonce un flux AVC sans `codec_data` et le
 * décodage échoue (`h264parse` refuse le flux).
 */
export function avcConfig(keyframe: Uint8Array): Uint8Array | null {
  const nals = splitNals(keyframe);
  const sps = nals.find((u) => (u[0] & 0x1f) === 7);
  const pps = nals.find((u) => (u[0] & 0x1f) === 8);
  if (!sps || !pps || sps.length < 4) return null;
  const out = new Uint8Array(11 + sps.length + pps.length);
  out.set([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 0xff]);
  out.set(sps, 8);
  out.set([1, pps.length >> 8, pps.length & 0xff], 8 + sps.length);
  out.set(pps, 11 + sps.length);
  return out;
}

/** Profils H.264 sondés : Baseline, Main, High (niveau 4.1), High 5.1 (4K). */
export const PROBE_CODECS: Record<string, string> = {
  baseline: "avc1.42E01F",
  main: "avc1.4D401F",
  high: "avc1.640029",
  high51: "avc1.640033",
};

export interface ProbeResult {
  userAgent: string;
  videoDecoder: boolean;
  audioDecoder: boolean;
  /** API Gamepad exposée (navigation à la manette : libmanette sous WebKitGTK). */
  gamepadApi: boolean;
  /** Profil → { matériel, logiciel } accepté par `isConfigSupported`. */
  codecs: Record<string, { hardware: boolean; software: boolean }>;
}

/** Mesure 1 du prototype : ce que WebCodecs accepte dans ce moteur web. */
export async function probeWebCodecs(): Promise<ProbeResult> {
  const result: ProbeResult = {
    userAgent: navigator.userAgent,
    videoDecoder: typeof VideoDecoder !== "undefined",
    audioDecoder: typeof AudioDecoder !== "undefined",
    gamepadApi: typeof navigator.getGamepads === "function",
    codecs: {},
  };
  if (!result.videoDecoder) return result;
  for (const [name, codec] of Object.entries(PROBE_CODECS)) {
    const ask = async (hardwareAcceleration: HardwareAcceleration) => {
      try {
        return (await VideoDecoder.isConfigSupported({ codec, hardwareAcceleration, optimizeForLatency: true })).supported === true;
      } catch {
        return false;
      }
    };
    result.codecs[name] = { hardware: await ask("prefer-hardware"), software: await ask("prefer-software") };
  }
  return result;
}

/**
 * Affichage d'une image décodée : `2d` (`drawImage`), `webgl` (texture), `bitmap`
 * (`createImageBitmap` + `bitmaprenderer`), `none` (mesure du seul décodage).
 */
export type Paint = "2d" | "webgl" | "bitmap" | "none";

/** Dessin WebGL minimal : un rectangle plein cadre texturé par l'image. */
function webglPainter(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, desynchronized: true } as WebGLContextAttributes);
  if (!gl) return null;
  const shader = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, "attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.)/2.,(1.-p.y)/2.);gl_Position=vec4(p,0.,1.);}"));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, "precision mediump float;varying vec2 uv;uniform sampler2D t;void main(){gl_FragColor=texture2D(t,uv);}"));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE);
  for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
  return (img: VideoFrame) => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
}

export interface DecodeStats {
  received: number;
  decoded: number;
  dropped: number;
  errors: number;
  keyframeRequests: number;
  /** Décodage : de la remise de l'image au décodeur à sa sortie (ms), médiane et maximum. */
  decodeMedianMs: number | null;
  decodeMaxMs: number | null;
  /** Arrivée réseau (Rust) → image décodée prête à dessiner (ms), médiane. */
  totalMedianMs: number | null;
  codec: string | null;
  /** Coût de l'affichage d'une image sur le fil principal (ms), médiane. */
  paintMedianMs: number | null;
  /** Dernière erreur du décodeur (message). */
  lastError: string | null;
  /** Décodeur demandé : matériel en priorité (VA-API sur le Deck), logiciel après un échec. */
  decoder: "auto" | "software";
  width: number;
  height: number;
}

function median(v: number[]): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Décode les images reçues et les dessine dans `canvas`. Sur erreur ou perte, le décodeur est
 * remis à zéro et une image clé est redemandée (`onKeyframeNeeded`).
 */
export class H264Renderer {
  private decoder: VideoDecoder | null = null;
  private config: string | null = null;
  /** Repli logiciel : après un échec du décodeur choisi d'office (matériel). */
  private accel: HardwareAcceleration = "no-preference";
  private waitingKey = true;
  private pending = new Map<number, { submitted: number; arrivedUs: number; rtp: number }>();
  /** Image dessinée : temps RTP, réception (Rust) et dessin, en ms de `performance.now()`. */
  onDisplayed?: (rtp: number, receivedMs: number, displayedMs: number) => void;
  private decodeMs: number[] = [];
  private totalMs: number[] = [];
  private paintMs: number[] = [];
  private gl: ((img: VideoFrame) => void) | null = null;
  private stats: DecodeStats = { received: 0, decoded: 0, dropped: 0, errors: 0, keyframeRequests: 0, decodeMedianMs: null, decodeMaxMs: null, totalMedianMs: null, codec: null, paintMedianMs: null, lastError: null, decoder: "auto", width: 0, height: 0 };
  /** Correspondance horloge Rust (µs depuis le début) → `performance.now()`, fixée à la 1re image. */
  private clockOffset: number | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private onKeyframeNeeded: () => void,
    /** Images en attente au-delà desquelles on jette (le décodeur ne suit pas). */
    private maxQueue = 3,
    private paint: Paint = "2d",
  ) {}

  push(frame: Frame) {
    if (frame.kind !== Kind.Video) return;
    this.stats.received++;
    const now = performance.now();
    if (this.clockOffset === null) this.clockOffset = now - frame.arrivedUs / 1000;
    if (frame.keyframe) {
      const codec = codecFromKeyframe(frame.data);
      const description = avcConfig(frame.data);
      const key = description ? description.join(",") : null;
      if (codec && description && (key !== this.config || !this.decoder || this.decoder.state === "closed")) {
        this.config = key;
        this.configure(codec, description);
      }
      this.waitingKey = false;
    }
    if (this.waitingKey || !this.decoder || this.decoder.state !== "configured") {
      this.stats.dropped++;
      return;
    }
    // trop d'images en attente : le décodeur ne suit pas, on attend la prochaine image clé
    if (this.decoder.decodeQueueSize > this.maxQueue && !frame.keyframe) {
      this.stats.dropped++;
      return;
    }
    const timestamp = Math.round((frame.rtpTime * 1e6) / 90000);
    this.pending.set(timestamp, { submitted: now, arrivedUs: frame.arrivedUs, rtp: frame.rtpTime });
    try {
      this.decoder.decode(new EncodedVideoChunk({ type: frame.keyframe ? "key" : "delta", timestamp, data: annexBToAvc(frame.data) }));
    } catch (e) {
      this.fail(e);
    }
  }

  private configure(codec: string, description: Uint8Array) {
    this.decoder?.close();
    this.stats.codec = codec;
    this.decoder = new VideoDecoder({
      output: (img) => this.draw(img),
      error: (e) => this.fail(e),
    });
    // format AVC avec `description` (avcC) : accepté par WebKitGTK comme par Chromium
    try {
      this.decoder.configure({ codec, description, optimizeForLatency: true, hardwareAcceleration: this.accel });
    } catch (e) {
      this.fail(e);
    }
  }

  private draw(img: VideoFrame) {
    const now = performance.now();
    const p = this.pending.get(img.timestamp);
    this.pending.delete(img.timestamp);
    if (p) {
      this.decodeMs.push(now - p.submitted);
      if (this.clockOffset !== null) {
        this.totalMs.push(now - (this.clockOffset + p.arrivedUs / 1000));
        this.onDisplayed?.(p.rtp, this.clockOffset + p.arrivedUs / 1000, now);
      }
      if (this.decodeMs.length > 600) this.decodeMs.shift();
      if (this.totalMs.length > 600) this.totalMs.shift();
    }
    if (this.canvas.width !== img.displayWidth || this.canvas.height !== img.displayHeight) {
      this.canvas.width = img.displayWidth;
      this.canvas.height = img.displayHeight;
    }
    this.stats.width = img.displayWidth;
    this.stats.height = img.displayHeight;
    this.stats.decoded++;
    const t = performance.now();
    const done = () => {
      this.paintMs.push(performance.now() - t);
      if (this.paintMs.length > 600) this.paintMs.shift();
    };
    if (this.paint === "2d") {
      this.canvas.getContext("2d")?.drawImage(img, 0, 0);
    } else if (this.paint === "webgl") {
      this.gl ??= webglPainter(this.canvas);
      this.gl?.(img);
    } else if (this.paint === "bitmap") {
      void createImageBitmap(img).then((bmp) => {
        this.canvas.getContext("bitmaprenderer")?.transferFromImageBitmap(bmp);
        done();
      });
      img.close();
      return;
    }
    img.close();
    if (this.paint !== "none") done();
  }

  private fail(e?: unknown) {
    this.stats.errors++;
    // premier échec : on repasse en décodage logiciel (FFmpeg LGPL), la prochaine image clé le configure
    if (this.accel !== "prefer-software") {
      this.accel = "prefer-software";
      this.stats.decoder = "software";
      this.config = null;
    }
    this.stats.lastError = e instanceof Error ? `${e.name}: ${e.message}` : e === undefined ? null : String(e);
    this.waitingKey = true;
    this.pending.clear();
    this.decoder?.close();
    this.decoder = null;
    this.stats.keyframeRequests++;
    this.onKeyframeNeeded();
  }

  snapshot(): DecodeStats {
    return {
      ...this.stats,
      decodeMedianMs: median(this.decodeMs),
      decodeMaxMs: this.decodeMs.length ? Math.max(...this.decodeMs) : null,
      totalMedianMs: median(this.totalMs),
      paintMedianMs: median(this.paintMs),
    };
  }

  close() {
    this.decoder?.close();
    this.decoder = null;
  }
}

/** Session d'invité natif : réponse à l'offre, réception et rendu. */
export async function startNativeGuest(offer: string, canvas: HTMLCanvasElement, opts: { loopback?: boolean; stunServers?: string[] } = {}) {
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const keyframe = () => void invoke("remote_play_native_guest_keyframe");
  const renderer = new H264Renderer(canvas, keyframe);
  let connected = false;
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = (buf) => {
    const f = parseFrame(buf);
    if (!f) return;
    if (f.kind === Kind.Connected) connected = true;
    else if (f.kind === Kind.Disconnected) connected = false;
    else renderer.push(f);
  };
  const answer = await invoke<string>("remote_play_native_guest_start", { offer, loopback: !!opts.loopback, stunServers: opts.stunServers ?? [], events: channel });
  return {
    answer,
    renderer,
    connected: () => connected,
    stats: () => invoke<Record<string, unknown> | null>("remote_play_native_guest_stats"),
    send: (ch: "input" | "control", bytes: Uint8Array) => invoke<boolean>("remote_play_native_guest_send", { channel: ch, bytes: Array.from(bytes) }),
    stop: async () => {
      renderer.close();
      return invoke("remote_play_native_guest_stop");
    },
  };
}

/** Écrit un rapport de mesure dans le journal d'iBox (`[webcodecs] …`). */
export async function report(data: unknown) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("remote_play_webcodecs_report", { report: data }).catch(() => undefined);
}

// ——— Session d'invité native (Steam Deck), même interface que `GuestSession` ———

/**
 * Son de l'hôte : paquets Opus décodés par `AudioDecoder`, joués par un `AudioContext` avec une
 * avance fixe (tampon de gigue minimal). Sans `AudioDecoder`, la session reste muette.
 */
export class OpusPlayer {
  private ctx: AudioContext | null = null;
  private decoder: AudioDecoder | null = null;
  private next = 0;
  private timestamp = 0;
  /** Avance de lecture (s) : assez pour absorber la gigue du réseau, assez peu pour rester réactif. */
  static readonly LEAD = 0.06;

  push(data: Uint8Array) {
    if (typeof AudioDecoder === "undefined") return;
    if (!this.decoder) {
      this.ctx = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
      this.decoder = new AudioDecoder({ output: (a) => this.play(a), error: () => this.reset() });
      this.decoder.configure({ codec: "opus", sampleRate: 48000, numberOfChannels: 2 });
    }
    if (this.decoder.state !== "configured") return;
    // horodatage croissant (20 ms par paquet Opus de l'hôte)
    this.timestamp += 20_000;
    try {
      this.decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: this.timestamp, data }));
    } catch {
      this.reset();
    }
  }

  private play(a: AudioData) {
    const ctx = this.ctx;
    if (!ctx) return a.close();
    const buf = ctx.createBuffer(a.numberOfChannels, a.numberOfFrames, a.sampleRate);
    for (let c = 0; c < a.numberOfChannels; c++) {
      a.copyTo(buf.getChannelData(c), { planeIndex: c, format: "f32-planar" });
    }
    a.close();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    // retard accumulé ou trou : on repart avec l'avance de base
    if (this.next < now || this.next > now + 4 * OpusPlayer.LEAD) this.next = now + OpusPlayer.LEAD;
    src.start(this.next);
    this.next += buf.duration;
  }

  /** Reprise après un geste de l'utilisateur (lecture sonore bloquée au démarrage). */
  resume() {
    void this.ctx?.resume();
  }

  private reset() {
    this.decoder?.close();
    this.decoder = null;
  }

  close() {
    this.reset();
    void this.ctx?.close();
    this.ctx = null;
  }
}

/** Statistiques de réception de l'invité natif (`GuestStats` côté Rust). */
export interface NativeStats {
  connected: boolean;
  fps: number;
  kbps: number;
  rttMs: number | null;
  jitterMs: number | null;
  loss: number | null;
  frames: number;
  gaps: number;
}

/**
 * Invité natif : réception en Rust (str0m), image par WebCodecs dans `canvas`, son par
 * `OpusPlayer`. Mêmes méthodes que `GuestSession` pour `attachPad` et l'écran de l'invité.
 */
export class NativeGuestSession {
  private renderer: H264Renderer;
  private audio = new OpusPlayer();
  private seq = 0;
  private pingTimer = 0;
  private pingId = 0;
  private pings = new Map<number, number>();
  private pingMs: number | null = null;
  private lastPong = 0;
  private closed = false;
  private offer = "";
  private answer = "";
  private tracker: import("./remotePlayGuest").LatencyTracker | null = null;
  connected = false;
  onHostGone?: () => void;
  onConnection?: (connected: boolean) => void;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly onRumble?: (pad: number, large: number, small: number) => void,
    private readonly stunServers: string[] = [],
  ) {
    this.renderer = new H264Renderer(canvas, () => void this.invoke("remote_play_native_guest_keyframe"));
  }

  private async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }

  nextSeq(): number {
    this.seq = (this.seq + 1) >>> 0;
    return this.seq;
  }

  /** Répond à l'offre : réponse SDP (candidats inclus) à transmettre par la signalisation. */
  async accept(offer: string): Promise<string> {
    const { Channel } = await import("@tauri-apps/api/core");
    const { decodeHost, LatencyTracker } = await import("./remotePlayGuest");
    const tracker = new LatencyTracker();
    this.tracker = tracker;
    this.renderer.onDisplayed = (rtp, received, displayed) => tracker.frame(rtp, performance.timeOrigin + received, performance.timeOrigin + displayed);
    const channel = new Channel<ArrayBuffer>();
    channel.onmessage = (buf) => {
      const f = parseFrame(buf);
      if (!f || this.closed) return;
      if (f.kind === Kind.Video) this.renderer.push(f);
      else if (f.kind === Kind.Audio) this.audio.push(f.data);
      else if (f.kind === Kind.Control) {
        const msg = decodeHost(f.data.slice().buffer);
        if (msg?.type === "pong") {
          const sent = this.pings.get(msg.id);
          if (sent !== undefined) {
            this.pingMs = performance.now() - sent;
            tracker.ping(this.pingMs);
          }
          this.pings.delete(msg.id);
          this.lastPong = performance.now();
        } else if (msg?.type === "rumble") this.onRumble?.(msg.pad, msg.large, msg.small);
        else if (msg?.type === "timing") tracker.timing(msg, performance.timeOrigin + performance.now());
      } else if (f.kind === Kind.Connected) {
        this.connected = true;
        this.onConnection?.(true);
        this.startPings();
      } else if (f.kind === Kind.Disconnected) {
        this.connected = false;
        this.onConnection?.(false);
        if (!this.closed) this.onHostGone?.();
      }
    };
    this.offer = offer;
    const stunServers = this.stunServers.filter((u) => u.startsWith("stun:"));
    this.answer = await this.invoke<string>("remote_play_native_guest_start", { offer, loopback: false, stunServers, events: channel });
    return this.answer;
  }

  async verificationCode(): Promise<string | null> {
    const { fingerprintOf, verificationCode } = await import("./remotePlayGuest");
    const a = fingerprintOf(this.offer);
    const b = fingerprintOf(this.answer);
    return a && b ? verificationCode(a, b) : null;
  }

  send(channel: "input" | "control", data: Uint8Array<ArrayBuffer>): boolean {
    if (!this.connected) return false;
    void this.invoke("remote_play_native_guest_send", { channel, bytes: Array.from(data) }).catch(() => undefined);
    return true;
  }

  private startPings() {
    if (this.pingTimer) return;
    void import("./remotePlayGuest").then(({ encode, sendReport }) => {
      if (this.closed || this.pingTimer) return;
      this.pingTimer = window.setInterval(() => {
        this.pingId += 1;
        const now = performance.now();
        this.pings.set(this.pingId, now);
        if (this.pings.size > 20) this.pings.delete(this.pings.keys().next().value!);
        this.send("control", encode.ping(this.pingId, now * 1000));
        if (this.tracker) sendReport(this, this.tracker);
        // l'hôte se tait depuis 6 s (PC éteint, iBox fermé) : fin de session
        if (this.lastPong && now - this.lastPong > 6000 && !this.closed) {
          this.lastPong = 0;
          this.onHostGone?.();
        }
      }, 1000);
    });
  }

  /** Statistiques au format de l'écran de l'invité (`GuestStats`). */
  async stats() {
    const net = await this.invoke<NativeStats | null>("remote_play_native_guest_stats").catch(() => null);
    const d = this.renderer.snapshot();
    return {
      state: (this.closed ? "closed" : this.connected ? "connected" : "connecting") as RTCPeerConnectionState,
      rttMs: net?.rttMs ?? null,
      pingMs: this.pingMs,
      fps: net ? net.fps : null,
      bitrateKbps: net ? net.kbps : null,
      jitterMs: net?.jitterMs ?? null,
      packetsLost: null,
      lossPct: net?.loss != null ? net.loss * 100 : null,
      jitterBufferMs: null,
      decodeMs: d.decodeMedianMs,
      framesDropped: d.dropped,
      freezeCount: net ? net.gaps : null,
      resolution: d.width ? `${d.width}×${d.height}` : null,
      decoder: d.codec ? `WebCodecs ${d.codec}` : null,
      hardwareDecoder: null,
      captureToDisplayMs: null,
      minimalBuffer: true,
      latency: this.tracker?.snapshot() ?? { totalMs: null, hostMs: null, networkMs: null, guestMs: null },
    };
  }

  /** Geste de l'utilisateur : le son peut démarrer. */
  unmute() {
    this.audio.resume();
  }

  close() {
    this.closed = true;
    window.clearInterval(this.pingTimer);
    this.renderer.close();
    this.audio.close();
    void this.invoke("remote_play_native_guest_stop").catch(() => undefined);
  }
}
