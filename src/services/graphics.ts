/**
 * Profils graphiques des scènes 3D (étagère, vol des boîtiers). L'étagère reste la même dans tous
 * les profils : seuls la définition de rendu et le rythme d'images changent.
 *
 * - `quality` : rendu suréchantillonné jusqu'à ×1,5, images au rythme de l'écran (PC).
 * - `deck` : Steam Deck, rendu à la définition native de l'écran (1280×800), plafonné à 60 im/s
 *   (l'écran OLED monte à 90 Hz : 60 suffisent à l'étagère et économisent le GPU).
 * - `battery` (économie d'énergie) : définition native et 30 im/s.
 * - `auto` (par défaut) : `deck` sur un Steam Deck branché, `battery` sur batterie, sinon `quality`.
 */
import { useSettings } from "./settings";
import { usePlatform } from "./platform";
import { usePower } from "./power";

export type GraphicsProfile = "auto" | "quality" | "deck" | "battery";
export type ResolvedProfile = Exclude<GraphicsProfile, "auto">;

export interface GraphicsSettings {
  profile: ResolvedProfile;
  /** Définition de rendu (`dpr` de React Three Fiber). */
  dpr: number | [number, number];
  /** Plafond d'images par seconde (`null` : rythme de l'écran). */
  fps: number | null;
}

export function resolveProfile(choice: GraphicsProfile, deck: boolean, onBattery: boolean): ResolvedProfile {
  if (choice !== "auto") return choice;
  if (onBattery) return "battery";
  return deck ? "deck" : "quality";
}

export function graphicsFor(profile: ResolvedProfile): GraphicsSettings {
  switch (profile) {
    case "deck":
      return { profile, dpr: 1, fps: 60 };
    case "battery":
      return { profile, dpr: 1, fps: 30 };
    default:
      return { profile, dpr: [1, 1.5], fps: null };
  }
}

/** Réglages graphiques actuels (profil choisi, appareil, alimentation). */
export function useGraphics(): GraphicsSettings {
  const choice = useSettings((s) => s.graphicsProfile ?? "auto");
  const deck = usePlatform((p) => p.steamDeck !== null);
  const onBattery = usePower((p) => p.onBattery);
  return graphicsFor(resolveProfile(choice, deck, onBattery));
}
