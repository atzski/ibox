import { useLayoutEffect, useRef } from "react";
import { useGraphics } from "@/services/graphics";
import { tuneRenderer } from "../rendererTuning";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { Group } from "three";
import type { Game } from "@/domain/types";
import { CaseModel } from "../cases/CaseModel";
import type { CaseSpec } from "../cases/caseSpecs";
import { useCaseTextures } from "../useCaseTextures";
import { landFlight, useFlight, type ScreenPose } from "../handoff";
import { InspectController } from "../inspectController";
import { StudioLights } from "./StudioLights";
import { useIsDark } from "@/app/shellState";

const FOV = 26;
const CAMERA_Z = 10;
/** Durée du vol (s). */
const DURATION = 0.78;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Couche du vol étagère → fiche : un canevas transparent par-dessus tout
 * l'écran, le temps que le boîtier glisse jusqu'à la visionneuse.
 */
export function FlightLayer() {
  const game = useFlight((s) => s.game);
  const spec = useFlight((s) => s.spec);
  const dark = useIsDark();
  const graphics = useGraphics();
  // entre deux vols : canevas gardé (contexte, shaders), caché et sans rendu
  const lastSpec = useRef(spec);
  if (spec) lastSpec.current = spec;
  const lights = spec ?? lastSpec.current;
  const flying = !!game && !!spec;
  if (!lights) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60]" style={flying ? undefined : { visibility: "hidden" }}>
      <Canvas
        frameloop={flying ? "always" : "never"}
        flat
        dpr={graphics.profile === "quality" ? [1, 2] : graphics.dpr}
        camera={{ fov: FOV, position: [0, 0, CAMERA_Z], near: 0.1, far: 50 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => tuneRenderer(gl)}
      >
        <StudioLights tint={lights.model === "box" ? lights.cardboard : lights.plastic} dark={dark} />
        {flying && <Flyer key={game.id} game={game} spec={spec} />}
        <ClearWhenIdle idle={!flying} />
      </Canvas>
    </div>
  );
}

/** Vol terminé : le canevas gardé est vidé (sinon le boîtier posé réapparaîtrait une image au vol suivant). */
function ClearWhenIdle({ idle }: { idle: boolean }) {
  const gl = useThree((s) => s.gl);
  useLayoutEffect(() => {
    if (idle) gl.clear();
  }, [idle, gl]);
  return null;
}

/** Place d'arrivée estimée tant que la visionneuse n'a pas publié la sienne. */
function estimate(): ScreenPose {
  const f = useFlight.getState();
  if (f.back && f.from) return f.from;
  // fiche PC : la visionneuse est à gauche ; fiches consoles : à droite
  const pc = f.game?.platformId === "pc";
  return {
    cx: pc ? 48 + Math.min(432, Math.max(304, window.innerWidth * 0.27)) / 2 : window.innerWidth * 0.66,
    cy: window.innerHeight * 0.5,
    h: window.innerHeight * (pc ? 0.4 : 0.55),
    yaw: InspectController.REST_YAW,
    pitch: InspectController.REST_PITCH + 0.06,
  };
}

function Flyer({ game, spec }: { game: Game; spec: CaseSpec }) {
  const textures = useCaseTextures(game, spec);
  const group = useRef<Group>(null);
  const t = useRef(0);
  const waited = useRef(0);
  const waitedTarget = useRef(0);

  useFrame((_, rawDt) => {
    // première image après la pause du canevas gardé : son `dt` couvre toute l'attente
    const dt = Math.min(rawDt, 1 / 30);
    const g = group.current;
    if (!g) return;
    // pas de vol sans textures (sinon un boîtier nu apparaîtrait une image)
    if (!textures) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const { from, to, viewerReady, back } = useFlight.getState();
    if (!from) return;
    // vol retour : la place sur l'étagère arrive une ou deux images plus tard
    if (back && !to && waitedTarget.current < 0.6) waitedTarget.current += dt;
    else t.current = Math.min(1, t.current + dt / (back ? DURATION * 1.05 : DURATION));
    const e = easeInOut(t.current);
    const target = to ?? estimate();
    const mix = (a: number, b: number) => a + (b - a) * e;

    // léger arc vers le haut et vers l'avant pendant le trajet
    const lift = Math.sin(Math.PI * t.current);
    const cx = mix(from.cx, target.cx);
    const cy = mix(from.cy, target.cy) - lift * window.innerHeight * 0.035;
    const h = mix(from.h, target.h) * (1 + lift * 0.06);

    // pixels → monde (caméra fixe, plan z = 0)
    const visibleH = 2 * CAMERA_Z * Math.tan((FOV * Math.PI) / 360);
    const k = visibleH / window.innerHeight;
    g.position.set((cx - window.innerWidth / 2) * k, -(cy - window.innerHeight / 2) * k, 0);
    g.scale.setScalar((h * k) / spec.height);
    g.rotation.set(mix(from.pitch, target.pitch), mix(from.yaw, target.yaw) + lift * 0.12, 0);

    // arrivé : la visionneuse reprend la main dès qu'elle est prête (2 s au plus)
    if (t.current >= 1) {
      waited.current += dt;
      if (viewerReady || waited.current > 2) landFlight();
    }
  });

  return (
    <group ref={group} visible={false}>
      <CaseModel spec={spec} textures={textures} lite />
    </group>
  );
}
