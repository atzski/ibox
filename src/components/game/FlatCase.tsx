import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Game } from "@/domain/types";
import type { CaseSpec } from "@/three/cases/caseSpecs";
import type { InspectController, ShownSide } from "@/three/inspectController";
import { CoverImage } from "./CoverImage";
import { useInterfaceSleep } from "@/services/performance";

/**
 * Boîtier à plat (docs/ANDROID.md §9, « Mode sans 3D ») : la fiche d'un jeu sans la visionneuse
 * 3D. Mêmes propriétés que `InspectViewer` (`three/lazy.tsx` monte l'un ou l'autre) et même
 * contrôleur : les boutons Face, Dos, Tranche de la fiche choisissent l'image montrée ; « Ouvrir »
 * montre le disque à côté de la jaquette. Glisser au doigt passe de la face au dos.
 */
export function FlatCase({
  game,
  controller,
  open,
  discOut,
  onToggleOpen,
}: {
  game: Game;
  spec: CaseSpec;
  controller: InspectController;
  open: boolean;
  discOut: boolean;
  reduced: boolean;
  tint: string;
  dark?: boolean;
  onToggleOpen: () => void;
  manualOut?: boolean;
  onOpenManual?: () => void;
}) {
  // la fiche pilote le contrôleur (boutons, manette) : on suit la face visée
  const [side, setSide] = useState<ShownSide>(() => controller.currentView());
  // rien ne tourne pendant la veille de l'interface (jeu lancé, iBox en arrière-plan)
  const asleep = useInterfaceSleep((s) => s.asleep);
  useEffect(() => {
    if (asleep) return;
    const id = window.setInterval(() => setSide(controller.currentView()), 200);
    return () => window.clearInterval(id);
  }, [controller, asleep]);
  const face = side === "back" ? "back" : side === "spine" ? "spine" : "front";

  const swipe = useRef<{ x: number; id: number } | null>(null);
  const onDown = (e: ReactPointerEvent) => {
    if (e.pointerType === "touch") swipe.current = { x: e.clientX, id: e.pointerId };
  };
  const onUp = (e: ReactPointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId || Math.abs(e.clientX - s.x) < 40) return;
    controller.setView(face === "front" ? "back" : "front");
    setSide(controller.currentView());
  };

  return (
    <div
      className="absolute inset-0 grid touch-pan-y place-items-center p-[6%]"
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={() => (swipe.current = null)}
    >
      <div className="flex h-full max-h-full items-center justify-center gap-[4%]">
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? "Fermer" : "Ouvrir"}
          onClick={onToggleOpen}
          className={`h-full max-h-full ${face === "spine" ? "w-[14%] max-w-[5rem]" : "aspect-auto"} flex items-center`}
        >
          <CoverImage
            key={face}
            game={game}
            face={face}
            sheen={face === "front"}
            rounded="rounded-lg"
            className={face === "spine" ? "h-full !aspect-auto w-full" : "max-h-full h-full w-auto shadow-[0_18px_40px_-18px_rgba(0,0,0,.55)]"}
          />
        </button>
        {(open || discOut) && face !== "spine" && (
          <div className="aspect-square h-[62%] max-h-full overflow-hidden rounded-full shadow-[0_12px_30px_-14px_rgba(0,0,0,.6)]">
            <CoverImage game={game} face="disc" sheen={false} rounded="rounded-full" className="h-full w-full !aspect-square" />
          </div>
        )}
      </div>
    </div>
  );
}
