/**
 * La 3D est-elle utilisable ? (docs/ANDROID.md §9, « Mode sans 3D »)
 *
 * iBox montre ses scènes 3D (étagère, vol des boîtiers, visionneuse des fiches) quand WebGL marche
 * et que l'appareil peut les tenir. Sinon, chaque scène laisse sa place à une vue 2D qui fait la
 * même chose (`three/lazy.tsx` : vue en jaquettes `FlatShelf`, boîtier à plat `FlatCase`) :
 *
 * - **WebGL absent** (pilote manquant, WebView sans accélération) : 2D, quel que soit le réglage ;
 * - **rendu logiciel** (SwiftShader, llvmpipe : vieux PC sans pilote) : 2D d'office ;
 * - **contexte perdu** (`webglcontextlost` : pilote réinitialisé, mémoire graphique reprise par le
 *   système) : la scène est remontée ; une deuxième perte à l'écran dans la session passe en 2D. Une
 *   perte pendant que personne ne regarde (jeu lancé, iBox en arrière-plan, fréquent sur Android)
 *   est réparée au retour, sans compter ;
 * - **palier `minimal`** (puces d'entrée de gamme) : 2D d'office ;
 * - **réglage** Paramètres › Apparence › Performances › Étagère 3D : Automatique, Activée, Désactivée.
 *
 * Aucun code propre à Android : un vieux PC suit les mêmes règles.
 */
import { create } from "zustand";
import { useSettings } from "./settings";
import { softwareRenderer, type PerfTier } from "./device";
import { interfaceAsleep, useInterfaceSleep } from "./performance";
import { webglInfo, type WebGLInfo } from "./webgl";

export type ThreeDChoice = "auto" | "on" | "off";

interface Render3DState {
  /** Pertes de contexte survenues à l'écran dans cette session. */
  losses: number;
  /** Deux pertes à l'écran : 2D jusqu'au prochain démarrage (ou « Réessayer »). */
  lost: boolean;
  /** Incrémenté pour remonter les scènes après une perte (clé React des scènes). */
  generation: number;
}

export const useRender3D = create<Render3DState>(() => ({ losses: 0, lost: false, generation: 0 }));

/** Perte au-delà de laquelle la session reste en 2D. */
export const MAX_LOSSES = 2;

let repair: (() => void) | null = null;

/**
 * Un contexte WebGL a été perdu (`three/rendererTuning.ts`) ou une scène n'a pas pu en créer
 * (`three/lazy.tsx`). Remonte les scènes, tout de suite ou au réveil de l'interface.
 */
export function reportContextLost(visible = typeof document === "undefined" || (!document.hidden && !interfaceAsleep())): void {
  if (!visible) {
    // personne ne regarde : on répare au retour, sans compter la perte
    if (repair) return;
    const off = useInterfaceSleep.subscribe((s) => {
      if (s.asleep || document.hidden) return;
      off();
      repair = null;
      useRender3D.setState((st) => ({ generation: st.generation + 1 }));
    });
    repair = off;
    return;
  }
  const losses = useRender3D.getState().losses + 1;
  if (losses >= MAX_LOSSES) {
    useRender3D.setState({ losses, lost: true });
    return;
  }
  useRender3D.setState({ losses });
  // laisser au pilote le temps de se remettre avant de recréer le contexte
  window.setTimeout(() => useRender3D.setState((st) => ({ generation: st.generation + 1 })), 1200);
}

/** Paramètres › « Réessayer la 3D » : oublie les pertes de la session. */
export function retry3D(): void {
  useRender3D.setState((st) => ({ losses: 0, lost: false, generation: st.generation + 1 }));
}

export type ThreeDReason = "missing" | "software" | "lost" | "tier" | "choice" | null;

export interface ThreeDState {
  enabled: boolean;
  /** Pourquoi la 3D est coupée (`null` : elle ne l'est pas). */
  reason: ThreeDReason;
}

/** Décision pure (testée). `tier` : palier d'office de l'appareil, chaleur comprise. */
export function resolveThreeD(choice: ThreeDChoice | undefined, webgl: Pick<WebGLInfo, "available" | "renderer">, lost: boolean, tier: PerfTier): ThreeDState {
  if (!webgl.available) return { enabled: false, reason: "missing" };
  if (lost) return { enabled: false, reason: "lost" };
  if (choice === "off") return { enabled: false, reason: "choice" };
  if (choice === "on") return { enabled: true, reason: null };
  if (softwareRenderer(webgl.renderer)) return { enabled: false, reason: "software" };
  if (tier === "minimal") return { enabled: false, reason: "tier" };
  return { enabled: true, reason: null };
}

/**
 * Lecture hors React (préchargement de Three.js) ; n'essaie WebGL que si la 3D peut être montrée :
 * ni réglage « Jaquettes » ni palier `minimal` en automatique.
 */
export function threeDNow(tier: PerfTier): boolean {
  const choice = useSettings.getState().threeD;
  if (choice === "off" || (choice !== "on" && tier === "minimal")) return false;
  return resolveThreeD(choice, webglInfo(), useRender3D.getState().lost, tier).enabled;
}

/** État de la 3D pour l'interface. `tier` : palier courant (`usePerfTier`). */
export function useThreeD(tier: PerfTier): ThreeDState {
  const choice = useSettings((s) => s.threeD);
  const lost = useRender3D((s) => s.lost);
  return resolveThreeD(choice, webglInfo(), lost, tier);
}
