import type { MutableRefObject } from "react";
import type { Texture } from "three";
import type { CaseSpec, KeepCaseSpec } from "./caseSpecs";
import type { CaseTextures } from "../useCaseTextures";
import { GltfCase } from "./GltfCase";
import { useSettings } from "@/services/settings";
import { KeepCase, type KeepCaseAnim } from "./KeepCase";
import { RetroBox, TRAY_TRAVEL } from "./RetroBox";

/** Manuel du jeu rangé dans le boîtier (carnet cliquable). */
export interface CaseManual {
  texture: Texture;
  /** Carnet pressé (boîtier ouvert) : le lecteur s'ouvre au relâchement. */
  onPress: () => void;
  /** Lecteur ouvert : le carnet est sorti de ses clips. */
  out: boolean;
}

/** Choisit le modèle 3D adapté à la console (boîtier plastique ou boîte carton). */
export function CaseModel(props: {
  manual?: CaseManual | null;
  spec: CaseSpec;
  textures: CaseTextures | null;
  open?: boolean;
  mediaOut?: boolean;
  lite?: boolean;
  reduced?: boolean;
  anim?: MutableRefObject<KeepCaseAnim>;
}) {
  const { spec, mediaOut, ...rest } = props;
  const classic = useSettings((st) => st.classicCases === true);
  if (spec.model === "box") return <RetroBox spec={spec} mediaOut={mediaOut} {...rest} />;
  const procedural = <KeepCase spec={spec} discOut={mediaOut} {...rest} />;
  // modèle physique Blender quand il existe ; le boîtier procédural sert de repli
  if (spec.glb && !classic) return <GltfCase spec={spec as KeepCaseSpec & { glb: string }} discOut={mediaOut} {...rest} fallback={procedural} />;
  return procedural;
}

/**
 * Décalage horizontal de l'ensemble une fois ouvert, pour le garder centré :
 * la face avant d'un boîtier pivote vers la gauche, le plateau d'une boîte
 * coulisse vers la droite.
 */
export function openShift(spec: CaseSpec): number {
  return spec.model === "box" ? (-spec.width * TRAY_TRAVEL) / 2 : (spec.width / 2) * 0.98;
}
