/**
 * Profils graphiques des scènes 3D (étagère, vol des boîtiers, visionneuse des fiches). Les scènes
 * restent les mêmes dans tous les profils : seuls la définition de rendu et le rythme d'images changent.
 *
 * - `quality` : rendu suréchantillonné jusqu'à ×1,5, images au rythme de l'écran (PC).
 * - `deck` : Steam Deck, rendu à la définition native de l'écran (1280×800), plafonné à 60 im/s
 *   (l'écran OLED monte à 90 Hz : 60 suffisent à l'étagère et économisent le GPU).
 * - `battery` (économie d'énergie) : définition native et 30 im/s.
 * - `auto` (par défaut) : `battery` sur batterie, `deck` sur un Steam Deck branché ou quand le mode
 *   performance est actif (`services/performance.ts`), sinon `quality`.
 *
 * Mode performance : en plus, l'étagère n'est dessinée que lorsqu'elle bouge (`idle`).
 */
import { useSettings } from "./settings";
import { usePlatform } from "./platform";
import { usePower } from "./power";
import { usePerformanceMode } from "./performance";

export type GraphicsProfile = "auto" | "quality" | "deck" | "battery";
export type ResolvedProfile = Exclude<GraphicsProfile, "auto">;

export interface GraphicsSettings {
  profile: ResolvedProfile;
  /** Définition de rendu (`dpr` de React Three Fiber). */
  dpr: number | [number, number];
  /** Plafond d'images par seconde (`null` : rythme de l'écran). */
  fps: number | null;
  /** Rendu à la demande : une scène posée n'est plus redessinée (`three/FrameCap.tsx`). */
  idle: boolean;
}

export function resolveProfile(choice: GraphicsProfile, deck: boolean, onBattery: boolean, lite = false): ResolvedProfile {
  if (choice !== "auto") return choice;
  if (onBattery) return "battery";
  return deck || lite ? "deck" : "quality";
}

export function graphicsFor(profile: ResolvedProfile, lite = false): GraphicsSettings {
  switch (profile) {
    case "deck":
      return { profile, dpr: 1, fps: 60, idle: lite };
    case "battery":
      return { profile, dpr: 1, fps: 30, idle: lite };
    default:
      return { profile, dpr: [1, 1.5], fps: null, idle: lite };
  }
}

/** Réglages graphiques actuels (profil choisi, appareil, alimentation, mode performance). */
export function useGraphics(): GraphicsSettings {
  const choice = useSettings((s) => s.graphicsProfile ?? "auto");
  const deck = usePlatform((p) => p.steamDeck !== null);
  const onBattery = usePower((p) => p.onBattery);
  const lite = usePerformanceMode();
  return graphicsFor(resolveProfile(choice, deck, onBattery, lite), lite);
}
