import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { MeshPhysicalMaterial, MeshStandardMaterial, type Group, type Texture } from "three";
import { damp } from "../springs";

/**
 * Carnet (manuel du jeu) rangé dans un boîtier : couverture = première page
 * du PDF, tranche de papier. Survolé, il se soulève de ses clips ; pressé,
 * il demande l'ouverture du lecteur.
 *
 * Unités et repère : ceux du parent (face avant d'un boîtier, plateau d'une
 * boîte). `facing` : la couverture regarde vers +Z (1) ou vers -Z (-1).
 */
export interface BookletProps {
  texture: Texture;
  width: number;
  height: number;
  thickness: number;
  position: [number, number, number];
  rotationZ?: number;
  facing: 1 | -1;
  /** Le carnet n'est cliquable que boîtier ouvert. */
  active: boolean;
  /** Le lecteur est ouvert : le carnet est sorti de ses clips. */
  out?: boolean;
  /** Hauteur de soulèvement au survol (unités du parent). */
  lift: number;
  reduced?: boolean;
  onPress?: () => void;
}

export function ManualBooklet({ texture, width, height, thickness, position, rotationZ = 0, facing, active, out = false, lift, reduced = false, onPress }: BookletProps) {
  const group = useRef<Group>(null);
  const [hover, setHover] = useState(false);
  const k = useRef({ hover: 0, out: 0 });

  // couverture ajustée sans déformation (recadrée au centre, comme une vraie impression)
  const mats = useMemo(() => {
    const img = texture.image as { width?: number; height?: number } | undefined;
    const texAspect = img?.width && img?.height ? img.width / img.height : width / height;
    const boxAspect = width / height;
    const map = texture.clone();
    map.needsUpdate = true;
    if (texAspect > boxAspect) {
      map.repeat.set(boxAspect / texAspect, 1);
      map.offset.set((1 - map.repeat.x) / 2, 0);
    } else {
      map.repeat.set(1, texAspect / boxAspect);
      map.offset.set(0, (1 - map.repeat.y) / 2);
    }
    const cover = new MeshPhysicalMaterial({ map, roughness: 0.48, clearcoat: 0.35, clearcoatRoughness: 0.35, envMapIntensity: 0.6 });
    const paper = new MeshStandardMaterial({ color: "#eee8da", roughness: 0.92 });
    const back = new MeshStandardMaterial({ color: "#e6e0d2", roughness: 0.85 });
    // ordre des faces d'une BoxGeometry : +x, -x, +y, -y, +z, -z
    const list = facing === 1 ? [paper, paper, paper, paper, cover, back] : [paper, paper, paper, paper, back, cover];
    return { list, cover, map, paper, back };
  }, [texture, width, height, facing]);

  useEffect(
    () => () => {
      mats.map.dispose();
      mats.cover.dispose();
      mats.paper.dispose();
      mats.back.dispose();
    },
    [mats],
  );

  useEffect(() => {
    if (!hover || !active) return;
    document.body.style.cursor = "pointer";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hover, active]);

  useFrame((state, dt) => {
    const s = k.current;
    const h = hover && active ? 1 : 0;
    s.hover = reduced ? h : damp(s.hover, h, 12, dt);
    s.out = reduced ? (out ? 1 : 0) : damp(s.out, out ? 1 : 0, 7, dt);
    const g = group.current;
    if (!g) return;
    // soulevé vers l'intérieur de la boîte (vers le spectateur une fois ouverte)
    const z = position[2] + facing * (s.hover * lift + s.out * lift * 2.6);
    g.position.set(position[0], position[1] + s.hover * lift * 0.4, z);
    g.rotation.set(-facing * s.hover * 0.035, 0, rotationZ + (reduced ? 0 : Math.sin(state.clock.elapsedTime * 2.2) * 0.006 * s.hover));
    mats.cover.emissive.setRGB(0.05 * s.hover, 0.05 * s.hover, 0.06 * s.hover);
  });

  const press = (e: ThreeEvent<PointerEvent>) => {
    if (!active || e.button !== 0) return;
    onPress?.();
  };

  return (
    <group ref={group} position={position}>
      <mesh
        material={mats.list}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
        }}
        onPointerOut={() => setHover(false)}
        onPointerDown={press}
      >
        <boxGeometry args={[width, height, thickness]} />
      </mesh>
    </group>
  );
}
