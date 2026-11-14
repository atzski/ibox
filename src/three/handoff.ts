import { create } from "zustand";
import type { Game } from "@/domain/types";
import type { CaseSpec } from "./cases/caseSpecs";

/**
 * Passage de relais entre l'étagère et la fiche du jeu.
 *
 * Quand on choisit un jeu sur l'étagère, le boîtier « s'envole » : une couche
 * 3D posée au-dessus de l'écran (`FlightLayer`) le fait glisser depuis sa place
 * sur l'étagère jusqu'à sa place dans la visionneuse de la fiche, pendant que
 * les écrans changent dessous. La visionneuse reprend ensuite le boîtier
 * exactement là où il s'est posé : aucune coupure.
 */

/** Pose d'un boîtier à l'écran : centre et hauteur en pixels, orientation. */
export interface ScreenPose {
  cx: number;
  cy: number;
  h: number;
  yaw: number;
  pitch: number;
}

interface FlightState {
  game: Game | null;
  spec: CaseSpec | null;
  from: ScreenPose | null;
  /** Place d'arrivée, publiée par la visionneuse dès qu'elle est affichée. */
  to: ScreenPose | null;
  /** La visionneuse a ses textures : elle peut reprendre le boîtier. */
  viewerReady: boolean;
  /** Le boîtier est posé : la visionneuse l'affiche, la couche s'efface. */
  landed: boolean;
  /** Vol retour : de la fiche vers sa place sur l'étagère. */
  back: boolean;
}

export const useFlight = create<FlightState>(() => ({
  game: null,
  spec: null,
  from: null,
  to: null,
  viewerReady: false,
  landed: false,
  back: false,
}));

export function startFlight(game: Game, spec: CaseSpec, from: ScreenPose, back = false): void {
  useFlight.setState({ game, spec, from, to: null, viewerReady: false, landed: false, back });
}

/** Vol retour en cours vers l'étagère pour ce jeu. */
export function returnFlightPending(gameId: string): boolean {
  const f = useFlight.getState();
  return f.back && !!f.game && f.game.id === gameId && !f.landed;
}

// ——— Dernière pose du boîtier dans la visionneuse (point de départ du vol retour) ———

let viewerPose: { gameId: string; pose: ScreenPose; at: number } | null = null;

export function rememberViewerPose(gameId: string, pose: ScreenPose): void {
  viewerPose = { gameId, pose, at: performance.now() };
}

/** Pose laissée par la visionneuse à l'instant (lue une seule fois). */
export function takeViewerPose(gameId: string): ScreenPose | null {
  const v = viewerPose;
  viewerPose = null;
  return v && v.gameId === gameId && performance.now() - v.at < 1500 ? v.pose : null;
}

/** Vol en cours pour ce jeu (boîtier pas encore posé dans la visionneuse). */
export function flightPending(gameId: string): boolean {
  const f = useFlight.getState();
  return !!f.game && f.game.id === gameId && !f.landed;
}

export function setFlightTarget(to: ScreenPose): void {
  const cur = useFlight.getState().to;
  const close = (a: number, b: number, eps: number) => Math.abs(a - b) < eps;
  if (cur && close(cur.cx, to.cx, 0.5) && close(cur.cy, to.cy, 0.5) && close(cur.h, to.h, 0.5) && close(cur.yaw, to.yaw, 0.002)) return;
  useFlight.setState({ to });
}

export function setViewerReady(): void {
  if (!useFlight.getState().viewerReady) useFlight.setState({ viewerReady: true });
}

/** Atterrissage : la visionneuse affiche son boîtier, puis la couche disparaît. */
export function landFlight(): void {
  useFlight.setState({ landed: true });
  requestAnimationFrame(() => requestAnimationFrame(() => useFlight.setState({ game: null, spec: null, from: null, to: null })));
}

// ——— Compatibilité : simple marque « vient de l'étagère » (sans vol) ———

let last: { gameId: string; at: number } | null = null;
const VALID_MS = 2000;

export function markShelfHandoff(gameId: string): void {
  last = { gameId, at: performance.now() };
}

/** Vrai si ce jeu vient d'être tiré de l'étagère (lecture sans effet de bord). */
export function cameFromShelf(gameId: string): boolean {
  return !!last && last.gameId === gameId && performance.now() - last.at < VALID_MS;
}
