import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Box3, type Group, type PerspectiveCamera } from "three";
import type { Game } from "@/domain/types";
import { createCaseAnim, type KeepCaseAnim } from "../cases/KeepCase";
import { CaseModel, openShift } from "../cases/CaseModel";
import { caseExtent, type CaseSpec } from "../cases/caseSpecs";
import { useCaseTextures } from "../useCaseTextures";
import { InspectController } from "../inspectController";
import { InspectStudio } from "./InspectStudio";
import { cachedRect, tuneRenderer } from "../rendererTuning";
import { damp } from "../springs";
import { cameFromShelf, flightPending, rememberViewerPose, setFlightTarget, setViewerReady } from "../handoff";

interface ViewerProps {
  game: Game;
  spec: CaseSpec;
  controller: InspectController;
  open: boolean;
  discOut: boolean;
  reduced: boolean;
  tint: string;
  dark?: boolean;
  onToggleOpen: () => void;
  onActivity?: () => void;
}

const BASE_DISTANCE = 6.4;

function Rig({ game, spec, controller, open, discOut, reduced, tint, dark = false, onCompiled }: Omit<ViewerProps, "onToggleOpen"> & { onCompiled?: () => void }) {
  const textures = useCaseTextures(game, spec, "inspect");
  const anim = useRef<KeepCaseAnim>(createCaseAnim());
  const outer = useRef<Group>(null);
  const inner = useRef<Group>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const bounds = useMemo(() => new Box3(), []);
  const lift = useRef(0);
  const rectOf = useMemo(() => cachedRect(8), []);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  // Le rendu ne démarre qu'une fois les shaders compilés en arrière-plan
  // (compilation parallèle du navigateur) : plus de gel à l'ouverture de la
  // fiche pendant que le boîtier vole depuis l'étagère.
  useEffect(() => {
    if (!textures) return;
    let alive = true;
    const start = () => {
      if (alive) onCompiled?.();
    };
    const t = window.setTimeout(start, 700); // filet de sécurité
    requestAnimationFrame(() => {
      gl.compileAsync(scene, camera).then(start, start);
    });
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [textures, gl, scene, camera, onCompiled]);
  // Arrivée en vol depuis l'étagère : pas d'entrée propre, le boîtier se pose
  const flying = useRef(!reduced && flightPending(game.id));
  const intro = useRef(reduced || flying.current ? 1 : 0);
  // Tiré de l'étagère : le boîtier arrive tout près puis se pose (continuité)
  const fromShelf = useRef(!reduced && cameFromShelf(game.id));

  useFrame((state, dt) => {
    controller.update(dt, reduced);
    const p = Math.max(0, anim.current.open.x);

    // Vol en cours : on publie la place exacte du boîtier à l'écran, et on
    // n'affiche le nôtre qu'une fois l'autre posé dessus.
    if (flying.current) {
      const fit0 = caseExtent(spec) / 1.91;
      const dist = BASE_DISTANCE * fit0 * controller.zoom;
      camera.position.z = dist;
      const rect = rectOf(gl.domElement);
      const visibleH = 2 * dist * Math.tan((camera.fov * Math.PI) / 360);
      setFlightTarget({
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
        h: (spec.height / visibleH) * rect.height,
        yaw: controller.yaw,
        pitch: controller.pitch + 0.04 + Math.atan2(camera.position.y, dist),
      });
      if (textures) setViewerReady();
      if (flightPending(game.id)) {
        if (outer.current) outer.current.visible = false;
        return;
      }
      flying.current = false;
      if (outer.current) outer.current.visible = true;
    }

    // Entrée : le boîtier avance doucement en tournant légèrement
    intro.current = reduced ? 1 : damp(intro.current, 1, fromShelf.current ? 4 : 3.2, dt);
    const enter = intro.current;
    const rest = 1 - enter;

    // Balancement d'attente discret
    const idle = !reduced && controller.idleSeconds() > 2.5 && !controller.dragging;
    const sway = idle ? Math.sin(state.clock.elapsedTime * 0.6) * 0.07 : 0;
    const bob = reduced ? 0 : Math.sin(state.clock.elapsedTime * 0.9) * 0.02;

    if (outer.current) {
      if (fromShelf.current) {
        outer.current.rotation.set(controller.pitch + 0.04 - rest * 0.12, controller.yaw + sway - rest * 0.3, 0);
        outer.current.position.set(0, bob + rest * 0.18, rest * 1.5);
      } else {
        outer.current.rotation.set(controller.pitch + 0.04, controller.yaw + sway - rest * 0.6, 0);
        outer.current.position.set(0, bob + rest * -0.25, rest * -1.6);
      }
    }
    // Ouvert, l'ensemble se recentre : la face avant pivote vers la gauche
    if (inner.current) inner.current.position.x = openShift(spec) * p;

    // Le boîtier ne traverse jamais le sol : penché vers le bas ou sur le côté,
    // son coin le plus bas reste posé au-dessus du sol (il se soulève d'autant).
    if (outer.current) {
      outer.current.updateMatrixWorld(true);
      bounds.setFromObject(outer.current);
      const floorY = -spec.height / 2 - 0.14;
      const need = bounds.isEmpty() ? 0 : Math.max(0, floorY + 0.025 - bounds.min.y);
      lift.current = reduced ? need : need > lift.current ? need : damp(lift.current, need, 6, dt);
      outer.current.position.y += lift.current;
    }

    // cadrage selon la taille du boîtier (référence : GameCube, 1,91 de haut)
    const fit = caseExtent(spec) / 1.91;
    const targetDist = BASE_DISTANCE * fit * controller.zoom * (1 + (spec.model === "box" ? 0.85 : 0.24) * p);
    camera.position.z = reduced ? targetDist : damp(camera.position.z, targetDist, 5, dt);
    camera.lookAt(0, 0, 0);

    // place actuelle du boîtier à l'écran : point de départ d'un éventuel vol retour
    if (!reduced && outer.current) {
      const rect = rectOf(gl.domElement);
      const depth = Math.max(0.5, camera.position.z - outer.current.position.z);
      const visibleH = 2 * depth * Math.tan((camera.fov * Math.PI) / 360);
      const ppu = rect.height / visibleH;
      rememberViewerPose(game.id, {
        cx: rect.left + rect.width / 2 + (outer.current.position.x + (inner.current?.position.x ?? 0)) * ppu,
        cy: rect.top + rect.height / 2 - outer.current.position.y * ppu,
        h: spec.height * ppu,
        yaw: outer.current.rotation.y,
        pitch: outer.current.rotation.x + Math.atan2(camera.position.y, depth),
      });
    }
  });

  return (
    <>
      <InspectStudio tint={tint} dark={dark} reduced={reduced} floorY={-spec.height / 2 - 0.14} subject={outer} />
      <group ref={outer}>
        <group ref={inner}>
          <CaseModel spec={spec} textures={textures} open={open} mediaOut={discOut} reduced={reduced} anim={anim} />
        </group>
      </group>
    </>
  );
}

/**
 * Visionneuse d'inspection : glisser pour tourner (avec inertie), molette
 * pour zoomer, ← → pour pivoter au clavier, Entrée pour ouvrir/fermer.
 */
export function InspectViewer(props: ViewerProps) {
  const { controller, onToggleOpen, tint } = props;
  const last = useRef<{ x: number; y: number; t: number } | null>(null);
  const [live, setLive] = useState(false);
  const markLive = useCallback(() => setLive(true), []);

  // Outil de vérification en développement uniquement
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__iboxViewer = controller;
  }, [controller]);

  // Manette : stick droit pour tourner, gâchettes pour zoomer
  useEffect(() => {
    const onAnalog = (e: Event) => {
      const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail;
      controller.nudge(x * 0.05, y * 0.03);
    };
    const onZoom = (e: Event) => controller.zoomBy(1 - (e as CustomEvent<{ value: number }>).detail.value * 0.015);
    window.addEventListener("ibox:analog", onAnalog);
    window.addEventListener("ibox:zoom", onZoom);
    return () => {
      window.removeEventListener("ibox:analog", onAnalog);
      window.removeEventListener("ibox:zoom", onZoom);
    };
  }, [controller]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    controller.dragStart();
    props.onActivity?.();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!last.current) return;
    const now = performance.now();
    controller.dragMove(e.clientX - last.current.x, e.clientY - last.current.y, (now - last.current.t) / 1000);
    last.current = { x: e.clientX, y: e.clientY, t: now };
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!last.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    // un mouvement arrêté avant le relâchement ne relance pas d'inertie
    if (performance.now() - last.current.t > 90) controller.dragMove(0, 0, 1);
    last.current = null;
    controller.dragEnd();
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    controller.zoomBy(e.deltaY > 0 ? 1.08 : 1 / 1.08);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") controller.nudge(-Math.PI / 4);
    else if (e.key === "ArrowRight") controller.nudge(Math.PI / 4);
    else if (e.key === "Enter" || e.key === " ") onToggleOpen();
    else if (e.key === "+" || e.key === "=") controller.zoomBy(1 / 1.12);
    else if (e.key === "-") controller.zoomBy(1.12);
    else return;
    e.preventDefault();
    props.onActivity?.();
  };

  return (
    <div
      data-focusable
      data-nav-capture="x"
      data-autofocus
      data-viewer
      tabIndex={0}
      role="application"
      aria-label={`Boîtier 3D de ${props.game.title}. Glisser ou flèches gauche et droite pour tourner, Entrée pour ouvrir.`}
      className="ibox-focusable absolute inset-0 cursor-grab rounded-xl outline-none active:cursor-grabbing [--ring-radius:var(--radius-xl)]"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      onDoubleClick={onToggleOpen}
    >
      <Canvas
        flat
        shadows
        frameloop={live ? "always" : "never"}
        onCreated={({ gl }) => tuneRenderer(gl)}
        dpr={[1, 2]}
        camera={{ fov: 26, position: [0, 0.15, BASE_DISTANCE], near: 0.1, far: 50 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        style={{ borderRadius: "inherit", touchAction: "none" }}
      >
        <Rig {...props} tint={tint} onCompiled={markLive} />
      </Canvas>
    </div>
  );
}
