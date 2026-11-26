import { lazy, Suspense, useEffect, useState, type ComponentProps } from "react";
import { input } from "@/input/InputController";
import { useFlight } from "./handoff";

/**
 * Chargement différé des scènes 3D : Three.js (le plus gros module) n'est plus
 * dans le démarrage de l'application. Les modules sont préchargés pendant un
 * temps mort, donc en pratique déjà prêts quand on ouvre une fiche.
 */
const loadInspect = () => import("./scenes/InspectViewer");
const loadShelf = () => import("./scenes/ShelfView");

const InspectViewerImpl = lazy(() => loadInspect().then((m) => ({ default: m.InspectViewer })));
const ShelfViewImpl = lazy(() => loadShelf().then((m) => ({ default: m.ShelfView })));
const loadFlight = () => import("./scenes/FlightLayer");
const FlightLayerImpl = lazy(() => loadFlight().then((m) => ({ default: m.FlightLayer })));

/**
 * Couche du vol étagère → fiche : montée au premier vol, puis gardée (cachée, sans
 * rendu) : créer son contexte 3D à chaque vol coûtait une image d'environ 100 ms.
 */
export function FlightLayer() {
  const active = useFlight((s) => !!s.game);
  const [warm, setWarm] = useState(false);
  if (active && !warm) setWarm(true);
  if (!active && !warm) return null;
  return (
    <Suspense fallback={null}>
      <FlightLayerImpl />
    </Suspense>
  );
}

/** Précharge les scènes 3D quand le navigateur est inactif. */
export function preload3D(): void {
  const run = () =>
    void Promise.all([loadInspect(), loadShelf(), loadFlight()])
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
  return (
    <Suspense fallback={<SceneLoading label="Préparation du boîtier…" />}>
      <InspectViewerImpl {...props} />
      <RestoreFocus />
    </Suspense>
  );
}

export function ShelfView(props: ComponentProps<typeof ShelfViewImpl>) {
  return (
    <Suspense fallback={<SceneLoading label="Préparation de l'étagère…" />}>
      <ShelfViewImpl {...props} />
      <RestoreFocus />
    </Suspense>
  );
}
