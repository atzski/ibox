/**
 * Mode performance et mise en veille de l'interface (docs/STEAMDECK.md, « Mode performance »).
 *
 * - **Mode performance** : allège ce que WebKitGTK (Steam Deck, Linux) et les petits GPU rendent
 *   lentement : flous d'arrière-plan, grands flous de décor, grandes ombres, 3D à la définition de
 *   l'écran et dessinée seulement quand elle bouge. Activé d'office sur les consoles portables
 *   modestes (palier `lite` de `services/device.ts` : Steam Deck, Ryzen Z1, Z2 A, Z2 Go) ; les
 *   consoles plus puissantes gardent tous les effets avec une 3D bridée (palier `handheld`).
 *   Réglable dans Paramètres › Apparence. Posé sur `<html data-perf="lite">` ; les allègements de
 *   style vivent dans `styles/performance.css`. L'apparence par défaut (mode éteint) ne change pas.
 * - **Veille de l'interface** : quand personne ne regarde iBox (fenêtre masquée, document caché,
 *   ou jeu en cours sans qu'iBox ait le focus : en Mode Jeu sa fenêtre reste « visible » derrière
 *   le jeu), animations CSS, scènes 3D et petites minuteries s'arrêtent et rendent le processeur
 *   et le GPU au jeu. Posé sur `<html data-asleep>`. Vaut pour tout le monde, Windows compris.
 */
import type { PlatformInfo } from "./platform";

export type PerformanceChoice = "auto" | "on" | "off";

/** Console portable de jeu : Steam Deck reconnu, console PC reconnue, ou machine que Steam annonce comme telle. */
export const isHandheld = (p: Pick<PlatformInfo, "steamDeck" | "handheld">): boolean => p.steamDeck !== null || p.handheld === true;

// Palier et mode allégé : `services/budget.ts` (un seul réglage, un seul calcul), réexportés ici
// pour les modules qui ne lisent que la veille et le mode allégé.
export { autoTier, deviceTierOf, perfTier, performanceMode, usePerfTier, usePerformanceMode } from "./budget";

// Veille de l'interface et autres signaux d'attention : `services/attention.ts`, réexportés ici.
export { attachAttention as attachInterfaceSleep, interfaceAsleep, setWindowHidden, shouldSleep, useInterfaceSleep, type SleepSignals } from "./attention";
