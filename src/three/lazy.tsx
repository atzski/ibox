import { Component, lazy, Suspense, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { input } from "@/input/InputController";
import { useFlight } from "./handoff";
import { usePerfTier } from "@/services/performance";
import { useSettings } from "@/services/settings";
import { reportContextLost, useRender3D, useThreeD } from "@/services/render3d";
import { FlatShelf } from "@/components/library/FlatShelf";
import { FlatCase } from "@/components/game/FlatCase";

/**
 * Chargement différé des scènes 3D : Three.js (le plus gros module) n'est plus
 * dans le démarrage de l'application. Les modules sont préchargés pendant un
 * temps mort, donc en pratique déjà prêts quand on ouvre une fiche.
 *
 * Mode sans 3D (`services/render3d.ts`) : chaque scène laisse sa place à sa version 2D (étagère →
 * `FlatShelf`, visionneuse → `FlatCase`, vol → rien), et Three.js n'est même pas chargé. Une
 * scène qui perd son contexte WebGL est remontée (clé `generation`), ou passe en 2D.
 */
const loadInspect = () => import("./scenes/InspectViewer");
const loadShelf = () => import("./scenes/ShelfView");

const InspectViewerImpl = lazy(() => loadInspect().then((m) => ({ default: m.InspectViewer })));
const ShelfViewImpl = lazy(() => loadShelf().then((m) => ({ default: m.ShelfView })));
const loadFlight = () => import("./scenes/FlightLayer");
const FlightLayerImpl = lazy(() => loadFlight().then((m) => ({ default: m.FlightLayer })));

/** La 3D est-elle montrée ? (réglage, WebGL, palier, pertes de contexte) */
export function use3D(): boolean {
  return useThreeD(usePerfTier()).enabled;
}

/**
 * Une scène qui ne peut pas créer son contexte (WebGL refusé, GPU saturé) lève une erreur au
 * montage : comptée comme une perte, elle laisse place à la vue 2D au lieu d'un écran vide.
 */
class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    reportContextLost();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Couche du vol étagère → fiche : montée au premier vol, puis gardée (cachée, sans
 * rendu) : créer son contexte 3D à chaque vol coûtait une image d'environ 100 ms.
 */
export function FlightLayer() {
  const active = useFlight((s) => !!s.game);
  const [warm, setWarm] = useState(false);
  // un vol ne part que d'une étagère 3D : seuls le réglage et les pertes de contexte la démontent
  // (sans essayer WebGL au démarrage, cette couche étant montée par `App`)
  const chosenOff = useSettings((s) => s.threeD === "off");
  const lost = useRender3D((s) => s.lost);
  const off = chosenOff || lost;
  const generation = useRender3D((s) => s.generation);
  if (active && !warm) setWarm(true);
  if ((!active && !warm) || off) return null;
  return (
    <SceneBoundary key={generation} fallback={null}>
      <Suspense fallback={null}>
        <FlightLayerImpl />
      </Suspense>
    </SceneBoundary>
  );
}

/**
 * Précharge les scènes 3D quand le navigateur est inactif, sauf en mode sans 3D (`enabled`, lu à ce
 * moment-là : WebGL n'est pas essayé au démarrage).
 */
export function preload3D(enabled: () => boolean = () => true): void {
  const run = () =>
    void (enabled() ? Promise.all([loadInspect(), loadShelf(), loadFlight()]) : Promise.reject(new Error("sans 3D")))
      // modèles physiques des boîtiers (Blender → GLB), chargés une fois pour tous les jeux
      .then(() => Promise.all([import("./cases/GltfCase"), import("./cases/caseSpecs")]))
      .then(([m, specs]) => m.preloadCaseModels(specs.CASE_MODELS))
      .catch(() => undefined);
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 2500 });
  else setTimeout(run, 1200);
}

/** Emplacement affiché pendant le chargement (focalisable pour garder la navigation). */
function SceneLoading({ label }: { label: string }) {
  return (
    <div
      data-focusable
      data-autofocus
      tabIndex={0}
      role="status"
      aria-label={label}
      className="ibox-focusable absolute inset-0 grid place-items-center outline-none [--ring-radius:1.25rem]"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="ibox-shimmer h-40 w-28 rounded-2xl" />
        <span className="text-[0.85rem] font-bold text-ink-soft">{label}</span>
      </div>
    </div>
  );
}

/** Replace le focus sur la scène si l'emplacement de chargement l'avait. */
function RestoreFocus() {
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) {
      const id = requestAnimationFrame(() => input.focusInitial());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, []);
  return null;
}

export function InspectViewer(props: ComponentProps<typeof InspectViewerImpl>) {
  const enabled = use3D();
  const generation = useRender3D((s) => s.generation);
  const flat = <FlatCase {...props} />;
  if (!enabled) return flat;
  return (
    <SceneBoundary key={generation} fallback={flat}>
      <Suspense fallback={<SceneLoading label="Préparation du boîtier…" />}>
        <InspectViewerImpl {...props} />
        <RestoreFocus />
      </Suspense>
    </SceneBoundary>
  );
}

export function ShelfView(props: ComponentProps<typeof ShelfViewImpl>) {
  const enabled = use3D();
  const generation = useRender3D((s) => s.generation);
  const flat = (
    <>
      <FlatShelf {...props} />
      <RestoreFocus />
    </>
  );
  if (!enabled) return flat;
  return (
    <SceneBoundary key={generation} fallback={flat}>
      <Suspense fallback={<SceneLoading label="Préparation de l'étagère…" />}>
        <ShelfViewImpl {...props} />
        <RestoreFocus />
      </Suspense>
    </SceneBoundary>
  );
}
