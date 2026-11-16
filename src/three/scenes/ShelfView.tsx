import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { AnimatePresence, motion } from "motion/react";
import { Object3D, Vector3, type Camera, type Group, type PerspectiveCamera, type SpotLight, type WebGLRenderer } from "three";
import type { Game, Platform } from "@/domain/types";
import { requirePlatform } from "@/domain/platforms";
import { CaseModel } from "../cases/CaseModel";
import { caseFor, type CaseSpec } from "../cases/caseSpecs";
import { useCaseTextures } from "../useCaseTextures";
import { createGlareMaterial } from "./flowGlare";
import { tuneRenderer } from "../rendererTuning";
import { sound } from "@/services/sound";
import { markShelfHandoff, returnFlightPending, setFlightTarget, setViewerReady, startFlight, takeViewerPose, type ScreenPose } from "../handoff";
import { focusAmbientGame } from "@/app/shellState";
import { input } from "@/input/InputController";
import { useLauncher } from "@/services/launcher";
import { usePlayState } from "@/components/library/PlayControls";
import { Icon, type IconName } from "@/components/ui/Icon";
import { relativeDay } from "@/domain/text";
import { getArtCanvas } from "@/art/covers";
import { loadAssets } from "@/art/assets";
import { metadataApi } from "@/services/metadata";
import { isTauri } from "@/services/native";
import { MediaModal } from "@/components/library/MediaModal";
import { usePlatformArt } from "@/services/platformArt";
import { PlatformGlyph } from "@/components/platform/PlatformGlyph";

/*
 * Étagère 3D « coverflow » : une seule rangée par console. Le jeu choisi
 * avance au centre, légèrement tourné pour montrer sa tranche ; les autres
 * s'empilent de chaque côté, tournés à 60° vers le centre. Chaque boîtier
 * glisse vers sa place avec une courbe d'accélération douce (pas de ressort
 * qui rebondit), comme un vrai carrousel de console de salon.
 */

/** Durée de la sortie du boîtier avant d'afficher la fiche. */
const PULL_MS = 430;
/** Boîtiers montés de chaque côté de la sélection. */
const WINDOW = 10;
/** Place sur l'écran du centre de la rangée (fraction de la hauteur). */
const TRACK_Y = 0.34;
/** Hauteur d'un boîtier rangé, en fraction de la hauteur de la vue. */
const CASE_SHARE = 0.46;
/** Délai avant de charger le décor d'une sélection stabilisée. */
const DECOR_SETTLE_MS = 300;
/** Distance de la caméra, en largeurs de boîtier (perspective du carrousel). */
const PERSPECTIVE = 7.5;
const DEG = Math.PI / 180;

type Pose = { x: number; y: number; z: number; ry: number };

interface Shelf {
  id: string;
  platform: Platform;
  games: Game[];
  specs: CaseSpec[];
}

/**
 * Une rangée par console (la plus fournie d'abord). Pendant une recherche :
 * une seule rangée avec tous les résultats, toutes consoles confondues.
 */
function buildShelves(games: Game[], mixed = false): Shelf[] {
  if (mixed && games.length > 0) {
    const specs = games.map((g) => caseFor(g.platformId));
    return [{ id: "search", platform: requirePlatform(games[0].platformId), games, specs }];
  }
  const map = new Map<string, Game[]>();
  for (const g of games) {
    const list = map.get(g.platformId);
    if (list) list.push(g);
    else map.set(g.platformId, [g]);
  }
  return [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([id, list]) => ({ id, platform: requirePlatform(id), games: list, specs: list.map((g) => caseFor(g.platformId)) }));
}

/** Place d'un boîtier selon son écart à la sélection (bw, bd : largeur et épaisseur de référence). */
function slotPose(d: number, bw: number, bd: number): Pose {
  if (d === 0) return { x: 0, y: 0, z: bw * 1.05, ry: 22 * DEG };
  const ad = Math.abs(d);
  const sg = Math.sign(d);
  return { x: sg * (bw * 1.22 + (ad - 1) * (bw * 0.22 + bd * 0.9)), y: 0, z: -bw * 0.7 - ad * bw * 0.025, ry: -sg * 60 * DEG };
}

// ——— Courbes ———

/** Courbe de Bézier cubique (comme `cubic-bezier()` en CSS). */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      const s = dx(t);
      if (Math.abs(e) < 1e-5 || Math.abs(s) < 1e-6) break;
      t -= e / s;
    }
    return sy(Math.min(1, Math.max(0, t)));
  };
}
/** Glissement d'une place à l'autre : départ franc, arrivée très douce. */
const SLIDE = bezier(0.22, 0.9, 0.25, 1);
/** Retournement du boîtier. */
const TURN = bezier(0.3, 0.95, 0.25, 1);

/**
 * Transition d'une pose vers une autre : quand la cible change en cours de
 * route, on repart de la pose actuelle (aucun saut), comme une transition CSS.
 */
class PoseTween {
  from: Pose;
  to: Pose;
  now: Pose;
  t0 = 0;
  dur = 0.55;
  constructor(p: Pose) {
    this.from = { ...p };
    this.to = { ...p };
    this.now = { ...p };
  }
  aim(p: Pose, time: number, dur: number, delay = 0) {
    const t = this.to;
    if (Math.abs(t.x - p.x) + Math.abs(t.y - p.y) + Math.abs(t.z - p.z) + Math.abs(t.ry - p.ry) < 1e-5) return;
    this.from = { ...this.now };
    this.to = { ...p };
    this.t0 = time + delay;
    this.dur = dur;
  }
  step(time: number, ease: (x: number) => number): Pose {
    const k = ease((time - this.t0) / this.dur);
    const f = this.from;
    const t = this.to;
    const n = this.now;
    n.x = f.x + (t.x - f.x) * k;
    n.y = f.y + (t.y - f.y) * k;
    n.z = f.z + (t.z - f.z) * k;
    n.ry = f.ry + (t.ry - f.ry) * k;
    return n;
  }
  jump(p: Pose) {
    this.from = { ...p };
    this.to = { ...p };
    this.now = { ...p };
  }
}

/** Place d'un boîtier à l'écran : centre et hauteur projetés par la caméra. */
function screenPose(grp: Object3D, spec: CaseSpec, camera: Camera, canvas: HTMLCanvasElement, yaw: number, pitch: number): ScreenPose {
  const rect = canvas.getBoundingClientRect();
  const toScreen = (v: Vector3) => {
    const p = v.project(camera);
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  };
  const top = toScreen(grp.localToWorld(new Vector3(0, spec.height / 2, 0)));
  const bottom = toScreen(grp.localToWorld(new Vector3(0, -spec.height / 2, 0)));
  const centre = toScreen(grp.localToWorld(new Vector3(0, 0, 0)));
  return { cx: centre.x, cy: centre.y, h: Math.abs(bottom.y - top.y), yaw, pitch };
}

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

// ——— Un boîtier de la rangée ———

function FlowCase({
  game,
  offset,
  spec,
  bw,
  bd,
  reduced,
  flipped,
  spin,
  bump,
  leaving,
  flown,
  returning,
  entering,
  onClick,
  register,
}: {
  game: Game;
  offset: number;
  spec: CaseSpec;
  bw: number;
  bd: number;
  reduced: boolean;
  flipped: boolean;
  /** Rotation libre du boîtier choisi (stick droit), en radians. */
  spin: { current: number };
  /** Butée en bout de rangée (sens, instant). */
  bump: { current: { dir: number; at: number } };
  leaving: boolean;
  flown: boolean;
  returning: boolean;
  /** Arrivée de la rangée : les boîtiers se posent en vague. */
  entering: boolean;
  onClick: () => void;
  register: (id: string, g: Group | null) => void;
}) {
  const slot = useRef<Group>(null);
  const box = useRef<Group>(null);
  const textures = useCaseTextures(game, spec);
  const [hover, setHover] = useState(false);
  const selected = offset === 0;

  const rest = slotPose(offset, bw, bd);
  const pulledPose: Pose = { x: 0, y: 0.32, z: rest.z + 2.1, ry: 0 };
  const tween = useRef<PoseTween | null>(null);
  if (!tween.current) {
    const start = returning ? pulledPose : entering && !reduced ? { ...rest, z: rest.z - bw * 1.6, y: -0.12, ry: rest.ry + Math.sign(offset || 1) * 0.5 } : rest;
    tween.current = new PoseTween(start);
  }
  const turn = useRef<PoseTween>(new PoseTween({ x: 0, y: 0, z: 0, ry: 0 }));
  const sheenAt = useRef(-1);
  const wasSelected = useRef(false);
  const born = useRef(true);

  const glare = useMemo(
    () => createGlareMaterial(spec.width + 0.004, spec.height + 0.004, spec.model === "keep" ? Math.max(spec.radius, 0.035) : 0.012),
    [spec],
  );
  useEffect(() => () => glare.dispose(), [glare]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const s = slot.current;
    const b = box.current;
    if (!s || !b) return;
    const time = state.clock.elapsedTime;
    // vol retour : le boîtier est encore porté par la couche de vol ; on publie sa
    // place d'arrivée et on attend qu'il s'y pose
    if (returning && returnFlightPending(game.id)) {
      s.visible = false;
      s.position.set(pulledPose.x, pulledPose.y, pulledPose.z);
      s.rotation.y = pulledPose.ry;
      s.updateWorldMatrix(true, true);
      setFlightTarget(screenPose(b, spec, state.camera, state.gl.domElement, 0, 0.14));
      if (textures) setViewerReady();
      return;
    }
    if (!textures || (leaving && selected && flown && !reduced)) {
      s.visible = false;
      return;
    }
    s.visible = true;

    // cible : sortie vers vous, recul des autres, place au repos
    let target = rest;
    if (leaving) target = selected ? pulledPose : { ...rest, z: rest.z - 0.35 };
    else if (hover && !selected) target = { ...rest, z: rest.z + bw * 0.08 };
    const t = tween.current!;
    if (reduced) t.jump(target);
    else if (born.current && entering) t.aim(target, time, 0.75, Math.min(Math.abs(offset), 8) * 0.045);
    else t.aim(target, time, leaving ? 0.42 : 0.55);
    born.current = false;
    const p = t.step(time, SLIDE);
    s.position.set(p.x, p.y, p.z);
    s.rotation.y = p.ry;

    // retournement (et rotation libre au stick) du boîtier choisi, avec un léger
    // décollement à mi-parcours
    const spinTarget = selected && !leaving ? (flipped ? Math.PI : 0) + spin.current : 0;
    const tr = turn.current;
    if (reduced) tr.jump({ x: 0, y: 0, z: 0, ry: spinTarget });
    else tr.aim({ x: 0, y: 0, z: 0, ry: spinTarget }, time, Math.abs(spinTarget - tr.to.ry) > 1 ? 0.75 : 0.18);
    const q = tr.step(time, TURN);
    b.rotation.y = q.ry;
    const mid = Math.abs(tr.to.ry - tr.from.ry) > 1 ? Math.sin(Math.PI * Math.min(1, Math.max(0, (time - tr.t0) / tr.dur))) : 0;
    b.position.z = mid * 0.12;
    const kb = selected && !reduced ? (performance.now() - bump.current.at) / 240 : 1;
    b.position.x = kb >= 0 && kb < 1 ? bump.current.dir * Math.sin(Math.PI * kb) * bw * 0.045 : 0;

    // reflet qui suit l'angle, voile sur les boîtiers de côté, éclat à l'arrivée
    if (selected && !wasSelected.current) sheenAt.current = time + 0.5;
    wasSelected.current = selected;
    const u = glare.uniforms;
    u.uShift.value = -(p.ry + q.ry) / (110 * DEG) - p.x / (bw * 7);
    u.uGlare.value = damp(u.uGlare.value as number, selected ? 1 : 0.55, 8, dt);
    u.uDim.value = reduced ? (selected ? 0 : 0.34) : damp(u.uDim.value as number, selected ? 0 : 0.34, 7, dt);
    const sh = sheenAt.current >= 0 && !reduced ? (time - sheenAt.current) / 0.85 : -1;
    u.uSheen.value = sh >= 0 && sh <= 1 ? -1.1 + SLIDE(sh) * 2.4 : -9;
  });

  return (
    <group
      ref={slot}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = "";
      }}
    >
      <group
        ref={(g) => {
          box.current = g;
          register(game.id, g);
        }}
      >
        {textures && <CaseModel spec={spec} textures={textures} lite reduced={reduced} />}
        {textures && (
          <>
            <mesh position={[0, 0, spec.depth / 2 + 0.004]} material={glare} renderOrder={2}>
              <planeGeometry args={[spec.width + 0.004, spec.height + 0.004]} />
            </mesh>
            <mesh position={[0, 0, -spec.depth / 2 - 0.004]} rotation-y={Math.PI} material={glare} renderOrder={2}>
              <planeGeometry args={[spec.width + 0.004, spec.height + 0.004]} />
            </mesh>
          </>
        )}
      </group>
    </group>
  );
}

// ——— Scène ———

/**
 * Caméra du carrousel : à la hauteur de la rangée, distance fixe en largeurs
 * de boîtier ; le champ s'ajuste pour qu'un boîtier rangé occupe toujours la
 * même part de la hauteur, et le centre de la rangée est placé à 42 % du haut.
 */
function FlowCamera({ spec, reduced }: { spec: CaseSpec; reduced: boolean }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const pointer = useThree((s) => s.pointer);
  const dist = PERSPECTIVE * spec.width;
  useLayoutEffect(() => {
    camera.fov = (2 * Math.atan(spec.height / (CASE_SHARE * 2 * dist))) / DEG;
    camera.setViewOffset(size.width, size.height, 0, (0.5 - TRACK_Y) * size.height, size.width, size.height);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, spec.height, dist]);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    // parallaxe très légère avec le pointeur
    camera.position.x = damp(camera.position.x, reduced ? 0 : pointer.x * 0.12 * spec.width, 2.2, dt);
    camera.position.y = damp(camera.position.y, reduced ? 0 : pointer.y * 0.05 * spec.height, 2.2, dt);
    camera.position.z = reduced ? dist : damp(camera.position.z, dist, 6, dt);
    camera.lookAt(0, 0, 0);
  });
  return null;
}

/** Éclairage de salon sombre : un projecteur sur le jeu choisi, des reflets nets sur le plastique. */
function FlowLights({ tint, on, spec }: { tint: string; on: boolean; spec: CaseSpec }) {
  const spot = useRef<SpotLight>(null);
  const target = useMemo(() => new Object3D(), []);
  useLayoutEffect(() => {
    target.position.set(0, 0, spec.width * 1.05);
  }, [target, spec.width]);
  useFrame((_, dt) => {
    if (spot.current) spot.current.intensity = damp(spot.current.intensity, on ? 2.2 : 0.6, 5, Math.min(dt, 1 / 30));
  });
  return (
    <>
      <ambientLight intensity={0.42} />
      <directionalLight position={[2.5, 3.5, 6]} intensity={0.95} color="#fff6ec" />
      <directionalLight position={[-5, 1, 2]} intensity={0.35} color="#dfe8ff" />
      <directionalLight position={[0, 2, -5]} intensity={0.8} color={tint} />
      <primitive object={target} />
      <spotLight ref={spot} position={[0.6, 4.5, 6.5]} angle={0.3} penumbra={0.9} decay={0} distance={0} intensity={0} color="#fff3e2" target={target} />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2.4} position={[0, 4, 4]} scale={[8, 1.2, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={0.9} position={[-6, 0.5, 2]} rotation-y={Math.PI / 2} scale={[6, 3, 1]} color="#cfdcff" />
        <Lightformer form="rect" intensity={0.8} position={[6, 0.5, 2]} rotation-y={-Math.PI / 2} scale={[6, 3, 1]} color="#ffe2d2" />
        <Lightformer form="ring" intensity={1.4} position={[0, 1, -5]} scale={3} color={tint} />
        <mesh scale={30}>
          <sphereGeometry />
          <meshBasicMaterial color="#0d0f17" side={1} />
        </mesh>
      </Environment>
    </>
  );
}

/** Garde la caméra et le rendu (pour projeter un boîtier à l'écran). */
function CaptureThree({ target }: { target: { current: { camera: Camera; gl: WebGLRenderer } | null } }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    target.current = { camera, gl };
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__iboxShelf = { camera, gl, scene };
  }, [camera, gl, scene, target]);
  return null;
}

// ——— Fond : la jaquette du jeu choisi, très floue, qui se fond d'un jeu à l'autre ———

const backdropCache = new Map<string, Promise<{ url: string; wide: boolean }>>();
function backdropOf(game: Game): Promise<{ url: string; wide: boolean }> {
  // l'image « Fond » choisie (SteamGridDB, import…) passe avant la jaquette floutée
  const hero = (game.media ?? []).find((m) => m.kind === "hero" && m.slot === 0);
  const key = `${game.id}|${hero?.addedAt ?? ""}`;
  let p = backdropCache.get(key);
  if (!p) {
    const blurred = () => getArtCanvas(game, "front").then((src) => {
      // réduite à quelques pixels : le flou est gratuit et l'image ne pèse rien
      const c = document.createElement("canvas");
      c.width = 36;
      c.height = 48;
      const ctx = c.getContext("2d")!;
      ctx.filter = "saturate(1.25)";
      ctx.drawImage(src, 0, 0, c.width, c.height);
      return { url: c.toDataURL("image/png"), wide: false };
    });
    p =
      hero && game.dbId !== undefined && isTauri()
        ? metadataApi
            .read(game.dbId, "hero")
            .then((bytes) => ({ url: URL.createObjectURL(new Blob([bytes])), wide: true }))
            .catch(blurred)
        : blurred();
    backdropCache.set(key, p);
    if (backdropCache.size > 80) backdropCache.delete(backdropCache.keys().next().value!);
  }
  return p;
}

function Backdrop({ game, tint }: { game: Game; tint: string }) {
  const [layer, setLayer] = useState<{ key: string; url: string; wide: boolean }>();
  useEffect(() => {
    let live = true;
    // on attend que la rangée se pose avant de changer de fond (défilement rapide)
    const t = window.setTimeout(() => {
      void backdropOf(game).then(({ url, wide }) => {
        if (live) setLayer({ key: game.id, url, wide });
      });
    }, DECOR_SETTLE_MS);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [game]);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ background: `color-mix(in oklab, ${tint} 18%, #07070c)`, transition: "background .6s" }}>
      <AnimatePresence initial={false} mode="wait">
        {layer && (
          <motion.div
            key={layer.key}
            className="absolute -inset-[15%]"
            initial={{ opacity: 0 }}
            animate={{ opacity: layer.wide ? 0.9 : 0.7 }}
            exit={{ opacity: 0, transition: { duration: 0.16 } }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            style={{ backgroundImage: `url(${layer.url})`, backgroundSize: "cover", backgroundPosition: "center", filter: layer.wide ? "blur(3px) saturate(1.1)" : "blur(28px)" }}
          />
        )}
      </AnimatePresence>
      {/* voile teinté et vignette : les boîtiers et le texte restent lisibles */}
      <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, rgba(5,6,12,.7), rgba(5,6,12,.52) 30%, rgba(5,6,12,.62) 62%, rgba(5,6,12,.88))` }} />
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(ellipse 80% 70% at 50% ${TRACK_Y * 100}%, transparent 35%, rgba(0,0,0,.55) 100%)` }}
      />
    </div>
  );
}

// ——— Étagère ———

/**
 * Étagère 3D : une rangée par console (onglets en haut, ↑ ↓ ou molette avec
 * Maj), ← → pour parcourir, Entrée pour ouvrir, F pour retourner le boîtier,
 * X pour jouer, stick droit pour le faire tourner.
 */
export function ShelfView({
  games,
  returnGameId,
  reduced,
  onOpen,
  mixed = false,
}: {
  games: Game[];
  /** Résultats d'une recherche : toutes les consoles sur une même rangée. */
  mixed?: boolean;
  returnGameId?: string;
  reduced: boolean;
  dark?: boolean;
  onOpen: (game: Game) => void;
}) {
  const shelves = useMemo(() => buildShelves(games, mixed), [games, mixed]);
  const [returnAt] = useState(() => {
    for (let r = 0; r < shelves.length; r++) {
      const i = shelves[r].games.findIndex((g) => g.id === returnGameId);
      if (i >= 0) return { row: r, index: i };
    }
    return null;
  });
  const [shelfIndex, setShelfIndex] = useState(returnAt?.row ?? 0);
  const [picks, setPicks] = useState<Record<string, number>>(() => (returnAt ? { [shelves[returnAt.row].id]: returnAt.index } : {}));
  const [leaving, setLeaving] = useState(false);
  const [flown, setFlown] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [swap, setSwap] = useState<"out" | "in" | null>(null);
  const [banner, setBanner] = useState<{ key: number; platform: Platform } | null>(null);
  const [glow, setGlow] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // une rangée qui arrive (premier affichage, changement de console) se pose en vague
  const [entering, setEntering] = useState(!returnAt);
  const spin = useRef(0);
  const bump = useRef({ dir: 0, at: -1 });
  const groups = useRef(new Map<string, Group>());
  const three = useRef<{ camera: Camera; gl: WebGLRenderer } | null>(null);
  const register = (id: string, g: Group | null) => {
    if (g) groups.current.set(id, g);
    else groups.current.delete(id);
  };
  const lastWheel = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

  const shelf = shelves[Math.min(shelfIndex, shelves.length - 1)];
  const pickOf = (s: Shelf) => Math.min(picks[s.id] ?? 0, s.games.length - 1);
  const index = shelf ? pickOf(shelf) : 0;
  const sel = shelf?.games[index];
  const playState = usePlayState(sel ?? games[0]);
  const first = shelf?.specs[0] ?? caseFor("gamecube");
  // Mixed shelves must fit every case independently of insertion order.
  const ref = mixed && shelf ? shelf.specs.reduce((frame, spec) => ({
    ...frame,
    width: Math.max(frame.width, spec.width),
    height: Math.max(frame.height, spec.height),
    depth: Math.max(frame.depth, spec.depth),
  }), first) : first;

  useEffect(() => {
    if (shelfIndex > shelves.length - 1) setShelfIndex(Math.max(0, shelves.length - 1));
  }, [shelves.length, shelfIndex]);

  useEffect(() => {
    if (!entering) return;
    const t = window.setTimeout(() => setEntering(false), 1200);
    return () => window.clearTimeout(t);
  }, [entering, shelfIndex]);

  // Retour de la fiche : le boîtier quitte la visionneuse et revient se ranger
  useLayoutEffect(() => {
    if (reduced || !returnAt) return;
    const s = shelves[returnAt.row];
    const g = s?.games[returnAt.index];
    if (!g || g.platformId === "pc") return;
    const from = takeViewerPose(g.id);
    if (from) startFlight(g, s.specs[returnAt.index], from, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sel) return;
    setFlipped(false);
    spin.current = 0;
    // halo aux couleurs de la vraie jaquette
    let live = true;
    const timer = window.setTimeout(() => {
      focusAmbientGame(sel);
      void loadAssets(sel).then((a) => live && setGlow(a.hasCover ? a.palette[1] : null));
    }, DECOR_SETTLE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [sel]);

  // stick droit : fait tourner le boîtier choisi ; relâché, il revient de face
  useEffect(() => {
    const onAnalog = (e: Event) => {
      const { x } = (e as CustomEvent<{ x: number; y: number }>).detail;
      spin.current = Math.abs(x) < 0.12 ? 0 : x * 1.25;
    };
    window.addEventListener("ibox:analog", onAnalog);
    return () => window.removeEventListener("ibox:analog", onAnalog);
  }, []);

  const open = (g: Game) => {
    if (leaving || swap) return;
    if (reduced) {
      sound.play("select");
      onOpen(g);
      return;
    }
    sound.play("pull");
    markShelfHandoff(g.id);
    const grp = groups.current.get(g.id);
    const view = three.current;
    const spec = shelf.specs[shelf.games.indexOf(g)];
    if (grp && view && spec && g.platformId !== "pc" && !flipped) {
      const yaw = (grp.parent?.rotation.y ?? 0) + grp.rotation.y;
      startFlight(g, spec, screenPose(grp, spec, view.camera, view.gl.domElement, yaw, 0.04));
      setFlown(true);
      setLeaving(true);
      later(() => onOpen(g), 60);
      return;
    }
    setLeaving(true);
    later(() => onOpen(g), PULL_MS);
  };

  const select = (i: number) => {
    if (leaving || swap || !shelf) return;
    const next = Math.max(0, Math.min(shelf.games.length - 1, i));
    if (next === index) {
      // bout de la rangée : le boîtier choisi butte sur place
      bump.current = { dir: i < index ? -1 : 1, at: performance.now() };
      return;
    }
    sound.play("move");
    setPicks((p) => ({ ...p, [shelf.id]: next }));
  };

  const changeShelf = (r: number) => {
    if (leaving || swap) return false;
    const next = Math.max(0, Math.min(shelves.length - 1, r));
    if (next === shelfIndex) return false;
    sound.play("tab");
    if (reduced) {
      setShelfIndex(next);
      return true;
    }
    // la rangée s'efface, la nouvelle console s'annonce, puis ses boîtiers arrivent
    setSwap("out");
    setBanner({ key: Date.now(), platform: shelves[next].platform });
    later(() => {
      setShelfIndex(next);
      setEntering(true);
      setSwap("in");
    }, 260);
    later(() => setSwap(null), 560);
    later(() => setBanner(null), 1500);
    return true;
  };

  const flip = () => {
    if (leaving || !sel) return;
    sound.play(flipped ? "close" : "open");
    setFlipped((f) => !f);
  };

  const quickPlay = () => {
    if (!sel || playState.reason || sel.dbId === undefined) return;
    sound.play("select");
    void useLauncher.getState().play(sel.dbId, sel.title);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") select(index - 1);
    else if (e.key === "ArrowRight") select(index + 1);
    else if (e.key === "ArrowUp") {
      if (!changeShelf(shelfIndex - 1)) input.move("up");
    } else if (e.key === "ArrowDown") {
      if (!changeShelf(shelfIndex + 1)) input.move("down");
    } else if (e.key === "Home") select(0);
    else if (e.key === "End") select(shelf.games.length - 1);
    else if (e.key === "PageUp") select(index - 8);
    else if (e.key === "PageDown") select(index + 8);
    else if (e.key === "Enter" || e.key === " ") open(sel);
    else if (e.key === "f" || e.key === "F") flip();
    else if (e.key === "x" || e.key === "X") quickPlay();
    else return;
    e.preventDefault();
  };

  if (!shelf || !sel) return null;
  // rangée de résultats : les couleurs suivent la console du jeu choisi
  const platform = mixed ? requirePlatform(sel.platformId) : shelf.platform;
  const theme = platform.theme;
  const halo = glow ?? theme.primary;
  const meta = [sel.year, sel.genre, sel.publisher].filter(Boolean).join(" · ");

  return (
    <div className="relative h-full overflow-hidden bg-[#07070c] text-[#f3f5fb] select-none">
      <Backdrop game={sel} tint={theme.deep} />

      {/* halo qui respire derrière le jeu choisi, et lueur au sol */}
      <div
        className="pointer-events-none absolute left-1/2 aspect-[4/3] w-[44%] -translate-x-1/2 -translate-y-1/2"
        style={{
          top: `${TRACK_Y * 100}%`,
          background: `radial-gradient(closest-side, color-mix(in srgb, ${halo} 55%, transparent), transparent)`,
          filter: "blur(26px)",
          opacity: leaving ? 0 : 1,
          transition: "opacity .4s, background .5s",
          animation: reduced ? undefined : "ibox-halo-breathe 3.4s ease-in-out infinite",
        }}
      />
      <div
        className="pointer-events-none absolute left-1/2 h-[18%] w-[min(1400px,140%)] -translate-x-1/2"
        style={{
          top: `calc(${TRACK_Y * 100}% + 26%)`,
          background: `radial-gradient(ellipse 14% 22% at 50% 18%, color-mix(in srgb, ${halo} 45%, transparent), transparent 75%), radial-gradient(ellipse 50% 30% at 50% 30%, rgba(0,0,0,.45), transparent 70%)`,
          transition: "background .6s",
        }}
      />

      <div
        data-focusable
        data-nav-capture="xy"
        data-autofocus
        data-focus-id="shelf"
        tabIndex={0}
        role="listbox"
        aria-label="Étagère de jeux. Gauche et droite pour parcourir, haut et bas pour changer de console, Entrée pour ouvrir, F pour retourner le boîtier."
        aria-activedescendant={`shelf-${sel.id}`}
        onKeyDown={onKeyDown}
        onWheel={(e) => {
          const now = performance.now();
          if (now - lastWheel.current < 140 || Math.abs(e.deltaY) + Math.abs(e.deltaX) < 4) return;
          lastWheel.current = now;
          if (e.shiftKey && shelves.length > 1) changeShelf(shelfIndex + (e.deltaY > 0 ? 1 : -1));
          else select(index + (e.deltaY > 0 || e.deltaX > 0 ? 1 : -1));
        }}
        className="ibox-focusable absolute inset-0 rounded-xl outline-none [--ring-radius:var(--radius-xl)]"
        style={{
          opacity: swap === "out" ? 0 : 1,
          transform: swap === "out" ? "translateY(18px)" : "none",
          transition: swap === "out" ? "opacity .25s, transform .25s" : "opacity .3s, transform .6s cubic-bezier(.22,.9,.25,1)",
        }}
      >
        <Canvas
          flat
          dpr={[1, 1.5]}
          camera={{ fov: 32, position: [0, 0, PERSPECTIVE * ref.width], near: 0.1, far: 60 }}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          style={{ borderRadius: "inherit" }}
          onCreated={({ gl }) => tuneRenderer(gl)}
        >
          <fog attach="fog" args={["#090a12", PERSPECTIVE * ref.width + 1.5, PERSPECTIVE * ref.width + 9]} />
          <FlowCamera spec={ref} reduced={reduced} />
          <FlowLights tint={theme.primary} on={!leaving} spec={ref} />
          <CaptureThree target={three} />
          <group key={shelf.id}>
            {shelf.games.map((g, i) =>
              Math.abs(i - index) > WINDOW ? null : (
                <FlowCase
                  key={g.id}
                  game={g}
                  offset={i - index}
                  spec={shelf.specs[i]}
                  bw={ref.width}
                  bd={ref.depth}
                  reduced={reduced}
                  flipped={i === index && flipped}
                  spin={spin}
                  bump={bump}
                  leaving={leaving}
                  flown={flown}
                  returning={!!returnAt && shelfIndex === returnAt.row && i === returnAt.index && !reduced}
                  entering={entering}
                  register={register}
                  onClick={() => (i === index ? open(g) : select(i))}
                />
              ),
            )}
          </group>
          <ContactShadows position={[0, -ref.height / 2 - 0.002, 0]} opacity={0.75} scale={[ref.width * 14, ref.width * 4]} blur={2.2} far={ref.height * 0.6} resolution={256} smooth={false} color="#000000" />
        </Canvas>
      </div>

      {/* en-tête : la console et ses jeux, onglets des consoles, position */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-end gap-4 px-7 pt-4">
        <div className="flex flex-col items-end gap-2.5">
          {shelves.length > 1 && (
            <div className="pointer-events-auto flex gap-1 rounded-full border border-[rgba(255,255,255,.16)] bg-[rgba(8,10,20,.46)] p-1 backdrop-blur-md">
              {shelves.map((s, si) => {
                const on = si === shelfIndex;
                return (
                  <button
                    key={s.id}
                    tabIndex={-1}
                    onClick={() => changeShelf(si)}
                    className={`relative rounded-full px-3.5 py-1.5 text-[0.76rem] font-semibold transition-colors duration-300 ${on ? "text-[#10121a]" : "text-[rgba(243,245,251,.62)] hover:text-[#f3f5fb]"}`}
                  >
                    {on && (
                      <motion.span
                        layoutId={reduced ? undefined : "flow-tab"}
                        className="absolute inset-0 rounded-full bg-[#ebebf0]"
                        transition={{ type: "spring", stiffness: 420, damping: 36 }}
                      />
                    )}
                    <span className="relative">{s.platform.shortName}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="text-[0.85rem] font-medium tracking-[0.06em] text-[rgba(243,245,251,.62)] tabular-nums">
            <b className="font-bold text-[#f3f5fb]">{index + 1}</b> / {shelf.games.length}
          </div>
        </div>
      </div>

      {/* logo de la console qui arrive en flottant au changement de rangée, puis repart vers le bas */}
      <AnimatePresence>
        {banner && <ConsoleLogoBanner key={banner.key} platform={banner.platform} />}
      </AnimatePresence>

      {/* images du jeu (jaquette, dos, tranche, fond) : sur le dos si le boîtier est retourné */}
      {editing && <MediaModal game={sel} initialKind={flipped ? "back" : "front"} onClose={() => setEditing(false)} />}

      {/* titre du jeu choisi, sous la rangée */}
      <div
        className="pointer-events-none absolute inset-x-0 flex flex-col items-center px-6 text-center"
        style={{ top: "66%", opacity: leaving ? 0 : 1, transition: "opacity .3s" }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={sel.id}
            id={`shelf-${sel.id}`}
            role="option"
            aria-selected
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={{ duration: 0.45, ease: [0.22, 0.9, 0.25, 1] }}
            className="max-w-[min(64rem,90%)]"
          >
            <div className="text-[clamp(1.2rem,2vw,1.9rem)] leading-tight font-medium text-balance [text-shadow:0_2px_20px_rgba(0,0,0,.45)]">{sel.title}</div>
            <div className="mt-1.5 truncate text-[0.9rem] font-medium text-[rgba(243,245,251,.62)]">
              {meta || platform.name}
              {sel.lastPlayedAt && <span> · joué {relativeDay(sel.lastPlayedAt)}</span>}
            </div>
          </motion.div>
        </AnimatePresence>
        <div className="pointer-events-auto mt-4 flex items-center gap-2">
          <FlowAction icon="play" label="Jouer" primary disabled={!!playState.reason || sel.dbId === undefined} title={playState.reason ?? undefined} onClick={quickPlay} />
          <FlowAction icon="open" label="Fiche" onClick={() => open(sel)} />
          <FlowAction icon="reset" label={flipped ? "Face" : "Dos"} onClick={flip} />
          {sel.dbId !== undefined && isTauri() && (
            <FlowAction icon="sparkle" label="Images" title="Personnaliser la jaquette, le dos, la tranche ou le fond" onClick={() => setEditing(true)} />
          )}
        </div>
      </div>
    </div>
  );
}

function FlowAction({ icon, label, onClick, primary, disabled, title }: { icon: IconName; label: string; onClick: () => void; primary?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button
      tabIndex={-1}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-[0.86rem] font-semibold backdrop-blur-md transition-[transform,background-color] active:scale-95 disabled:opacity-40 ${
        primary ? "bg-[#ebebf0] text-[#10121a] hover:bg-[#ffffff]" : "border border-[rgba(255,255,255,.16)] bg-[rgba(8,10,20,.46)] text-[#f3f5fb] hover:bg-[rgba(255,255,255,.16)]"
      }`}
    >
      <Icon name={icon} size="1.05em" filled={icon === "play"} />
      {label}
    </button>
  );
}

/**
 * Annonce d'une console sur l'étagère : son logo descend en flottant au-dessus de la rangée,
 * avec un halo à ses couleurs, puis repart doucement vers le bas. Sans logo : pastille et nom.
 */
function ConsoleLogoBanner({ platform }: { platform: Platform }) {
  const logo = usePlatformArt(platform.id, "platform_logo");
  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 flex justify-center"
      style={{ top: `${TRACK_Y * 100}%` }}
      initial={{ opacity: 0, y: -90, scale: 0.85 }}
      animate={{ opacity: 1, y: -30, scale: 1 }}
      exit={{ opacity: 0, y: 70, scale: 0.92, filter: "blur(6px)" }}
      transition={{ type: "spring", stiffness: 170, damping: 18, mass: 0.9 }}
    >
      <motion.div
        className="relative -translate-y-1/2"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity }}
      >
        <span aria-hidden className="absolute inset-[-40%] rounded-full opacity-70 blur-3xl" style={{ background: `radial-gradient(circle, ${platform.theme.primary}, transparent 65%)` }} />
        {logo ? (
          <img src={logo} alt={platform.name} draggable={false} className="relative max-h-[7.5rem] max-w-[min(34rem,60vw)] object-contain drop-shadow-[0_10px_24px_rgba(0,0,0,0.45)]" />
        ) : (
          <span className="relative flex items-center gap-4 rounded-[1.8rem] bg-white/95 px-7 py-4 text-ink shadow-[0_18px_40px_-14px_rgba(0,0,0,0.55)]">
            <span className="grid size-14 place-items-center rounded-2xl text-white" style={{ background: platform.theme.primary }}>
              <PlatformGlyph glyph={platform.glyph} size={34} />
            </span>
            <span className="font-display text-[clamp(1.6rem,3vw,2.6rem)] font-semibold">{platform.shortName}</span>
          </span>
        )}
      </motion.div>
    </motion.div>
  );
}
