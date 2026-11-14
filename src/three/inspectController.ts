import { nearestAngle } from "@/input/spatial";
import { clamp, damp } from "./springs";

export type CaseView = "front" | "back" | "spine";
/** Face présentée : une vue nommée, ou le bord d'ouverture (aucun bouton actif). */
export type ShownSide = CaseView | "edge";

/**
 * État de manipulation d'un objet inspecté : rotation (lacet / tangage),
 * inertie, zoom et vues prédéfinies. Sans dépendance à React ni Three :
 * la souris, le clavier, les boutons et la manette pilotent la même instance.
 */
export class InspectController {
  /** Pose de repos : trois-quarts, pour révéler la tranche et l'épaisseur. */
  static readonly REST_YAW = 0.34;
  static readonly REST_PITCH = 0.06;

  yaw = InspectController.REST_YAW;
  pitch = InspectController.REST_PITCH;
  zoom = 1;
  targetYaw = InspectController.REST_YAW;
  targetPitch = InspectController.REST_PITCH;
  targetZoom = 1;
  dragging = false;
  /** Horodatage (s) de la dernière interaction, pour l'animation d'attente. */
  lastInteraction = 0;

  private velYaw = 0;
  private velPitch = 0;
  private clock = 0;

  static readonly PITCH_LIMIT = 0.6;
  static readonly ZOOM_MIN = 0.72;
  static readonly ZOOM_MAX = 1.5;

  dragStart(): void {
    this.dragging = true;
    this.velYaw = 0;
    this.velPitch = 0;
    this.touch();
  }

  /** dx, dy en pixels ; `dt` en secondes depuis le dernier mouvement. */
  dragMove(dx: number, dy: number, dt: number): void {
    const dyaw = dx * 0.0085;
    const dpitch = dy * 0.0065;
    this.targetYaw += dyaw;
    this.targetPitch = clamp(this.targetPitch + dpitch, -InspectController.PITCH_LIMIT, InspectController.PITCH_LIMIT);
    if (dt > 0) {
      // vitesse lissée pour une inertie naturelle
      this.velYaw = this.velYaw * 0.6 + (dyaw / dt) * 0.4;
      this.velPitch = this.velPitch * 0.6 + (dpitch / dt) * 0.4;
    }
    this.touch();
  }

  dragEnd(): void {
    this.dragging = false;
    this.velYaw = clamp(this.velYaw, -9, 9);
    this.velPitch = clamp(this.velPitch, -4, 4);
    this.touch();
  }

  nudge(dyaw: number, dpitch = 0): void {
    this.velYaw = 0;
    this.velPitch = 0;
    this.targetYaw += dyaw;
    this.targetPitch = clamp(this.targetPitch + dpitch, -InspectController.PITCH_LIMIT, InspectController.PITCH_LIMIT);
    this.touch();
  }

  zoomBy(factor: number): void {
    this.targetZoom = clamp(this.targetZoom * factor, InspectController.ZOOM_MIN, InspectController.ZOOM_MAX);
    this.touch();
  }

  /** Oriente l'objet vers une face, par le chemin le plus court. */
  setView(view: CaseView): void {
    // la tranche (charnière, côté gauche du boîtier) se présente à +90°
    const angle = view === "front" ? 0 : view === "back" ? Math.PI : Math.PI / 2;
    this.velYaw = 0;
    this.velPitch = 0;
    this.targetYaw = nearestAngle(this.yaw, angle);
    this.targetPitch = view === "spine" ? 0.05 : 0;
    this.touch();
  }

  /** Retour à la pose de repos (trois-quarts) et au zoom initial. */
  reset(): void {
    this.velYaw = 0;
    this.velPitch = 0;
    this.targetYaw = nearestAngle(this.yaw, InspectController.REST_YAW);
    this.targetPitch = InspectController.REST_PITCH;
    this.targetZoom = 1;
    this.touch();
  }

  /** Face actuellement présentée (pour l'état des boutons). */
  currentView(): ShownSide {
    const a = ((this.targetYaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (a < Math.PI / 4 || a > (Math.PI * 7) / 4) return "front";
    if (a > (Math.PI * 3) / 4 && a < (Math.PI * 5) / 4) return "back";
    // tranche à +90°, bord d'ouverture à -90° (270°)
    return a < Math.PI ? "spine" : "edge";
  }

  idleSeconds(): number {
    return this.clock - this.lastInteraction;
  }

  update(dt: number, immediate = false): void {
    this.clock += dt;
    if (!this.dragging) {
      this.targetYaw += this.velYaw * dt;
      this.targetPitch = clamp(
        this.targetPitch + this.velPitch * dt,
        -InspectController.PITCH_LIMIT,
        InspectController.PITCH_LIMIT,
      );
      const decay = Math.exp(-3.2 * dt);
      this.velYaw *= decay;
      this.velPitch *= decay;
      // le tangage revient doucement vers une légère inclinaison neutre
      if (Math.abs(this.velPitch) < 0.05) this.targetPitch = damp(this.targetPitch, InspectController.REST_PITCH, 0.6, dt);
    }
    if (immediate) {
      this.yaw = this.targetYaw;
      this.pitch = this.targetPitch;
      this.zoom = this.targetZoom;
      return;
    }
    this.yaw = damp(this.yaw, this.targetYaw, this.dragging ? 22 : 9, dt);
    this.pitch = damp(this.pitch, this.targetPitch, this.dragging ? 22 : 9, dt);
    this.zoom = damp(this.zoom, this.targetZoom, 8, dt);
  }

  private touch(): void {
    this.lastInteraction = this.clock;
  }
}
