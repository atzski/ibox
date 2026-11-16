import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import { MeshStandardMaterial, type Group } from "three";
import type { BoxSpec, CartridgeSpec } from "./caseSpecs";
import type { CaseTextures } from "../useCaseTextures";
import { stepSpring } from "../springs";
import { createCaseAnim, type KeepCaseAnim } from "./KeepCase";

/** Course du plateau qui sort de la boîte (fraction de la largeur). */
export const TRAY_TRAVEL = 1.02;
/** Ouverture maximale du rabat latéral (radians). */
const FLAP_ANGLE = 1.95;

/**
 * Boîte en carton rétro (N64, Super Nintendo, Game Boy…) : un plateau
 * coulisse vers la droite et présente la cartouche, qui peut ensuite être
 * sortie pour être examinée. Réutilisable : seules les dimensions changent.
 */
export function RetroBox({
  spec,
  textures,
  open = false,
  mediaOut = false,
  lite = false,
  reduced = false,
  anim,
}: {
  spec: BoxSpec;
  textures: CaseTextures | null;
  open?: boolean;
  mediaOut?: boolean;
  lite?: boolean;
  reduced?: boolean;
  anim?: MutableRefObject<KeepCaseAnim>;
}) {
  const { width: W, height: H, depth: D, cartridge: cart } = spec;
  const localAnim = useRef<KeepCaseAnim>(createCaseAnim());
  const a = anim ?? localAnim;
  const tray = useRef<Group>(null);
  const flap = useRef<Group>(null);
  const cartGroup = useRef<Group>(null);

  const mats = useMemo(() => {
    const art = (map?: CaseTextures[keyof CaseTextures]) =>
      new MeshStandardMaterial({ map: map ?? null, color: map ? "#ffffff" : spec.cardboard, roughness: 0.78 });
    const board = new MeshStandardMaterial({ color: spec.cardboard, roughness: 0.85 });
    const front = art(textures?.front);
    const back = art(textures?.back);
    const side = art(textures?.spine);
    const hole = new MeshStandardMaterial({ visible: false });
    return {
      // ordre des faces d'une BoxGeometry : +x, -x, +y, -y, +z, -z
      box: [side, side, board, board, front, back],
      // côté droit remplacé par un rabat articulé (vue détaillée)
      shell: [hole, side, board, board, front, back],
      flap: [side, board, board, board, board, board],
      tray: new MeshStandardMaterial({ color: spec.tray, roughness: 0.9 }),
      plastic: new MeshStandardMaterial({ color: cart.color, roughness: 0.55 }),
      label: new MeshStandardMaterial({ map: textures?.label ?? null, color: textures ? "#ffffff" : "#e8e4f3", roughness: 0.6 }),
      all: [front, back, side, board],
    };
  }, [spec, cart.color, textures]);

  useEffect(
    () => () => {
      for (const m of [...mats.all, mats.tray, mats.plastic, mats.label, mats.shell[0]]) m.dispose();
    },
    [mats],
  );

  const trayW = W * 0.95;
  const trayH = H * 0.93;
  const trayD = D * 0.82;
  const wall = 0.02;

  useFrame((state, dt) => {
    const st = a.current;
    const openTarget = open || st.disc.x > 0.06 ? 1 : 0;
    const outTarget = mediaOut && open && st.open.x > 0.75 ? 1 : 0;
    if (reduced) {
      st.open.x = openTarget;
      st.disc.x = outTarget;
    } else {
      stepSpring(st.open, openTarget, dt, 60, 12);
      if (st.open.x < 0) {
        st.open.x = 0;
        st.open.v = -st.open.v * 0.2;
      }
      stepSpring(st.disc, outTarget, dt, 85, 14);
    }
    // le rabat s'ouvre d'abord, puis le plateau coulisse par l'ouverture
    const o = st.open.x;
    if (flap.current) flap.current.rotation.y = FLAP_ANGLE * Math.min(1, Math.max(0, o / 0.45));
    if (tray.current) tray.current.position.x = W * TRAY_TRAVEL * Math.max(0, (o - 0.3) / 0.7);
    if (cartGroup.current) {
      const k = st.disc.x;
      cartGroup.current.position.set(0, 0, -trayD / 2 + wall + cart.depth / 2 + k * (D + 0.5));
      cartGroup.current.rotation.x = -k * 0.15;
      cartGroup.current.rotation.y = reduced ? 0 : Math.sin(state.clock.elapsedTime * 1.1) * 0.35 * k;
      cartGroup.current.scale.setScalar(1 + k * 0.25);
    }
  });

  return (
    <group>
      {/* boîte (fourreau) */}
      <mesh material={lite ? mats.box : mats.shell}>
        <boxGeometry args={[W, H, D]} />
      </mesh>
      {!lite && (
        // rabat latéral, charnière sur l'arête arrière : la boîte s'ouvre vraiment
        <group ref={flap} position={[W / 2, 0, -D / 2]}>
          <mesh position={[0.004, 0, D / 2]} material={mats.flap}>
            <boxGeometry args={[0.008, H, D]} />
          </mesh>
          {/* languette à glisser */}
          <mesh position={[-0.02, 0, D - 0.002]} material={mats.flap[1]}>
            <boxGeometry args={[0.04, H * 0.92, 0.004]} />
          </mesh>
        </group>
      )}

      {!lite && (
        <group ref={tray}>
          {/* plateau intérieur, ouvert vers l'avant */}
          <mesh position={[0, 0, -trayD / 2 + wall / 2]} material={mats.tray}>
            <boxGeometry args={[trayW, trayH, wall]} />
          </mesh>
          {[1, -1].map((sgn) => (
            <mesh key={`h${sgn}`} position={[0, sgn * (trayH / 2 - wall / 2), 0]} material={mats.tray}>
              <boxGeometry args={[trayW, wall, trayD]} />
            </mesh>
          ))}
          {[1, -1].map((sgn) => (
            <mesh key={`v${sgn}`} position={[sgn * (trayW / 2 - wall / 2), 0, 0]} material={mats.tray}>
              <boxGeometry args={[wall, trayH, trayD]} />
            </mesh>
          ))}
          <group ref={cartGroup}>
            <Cartridge spec={cart} mats={mats} />
          </group>
        </group>
      )}
    </group>
  );
}

function Cartridge({ spec, mats }: { spec: CartridgeSpec; mats: { plastic: MeshStandardMaterial; label: MeshStandardMaterial } }) {
  const { width: w, height: h, depth: d } = spec;
  const [lx, ly, lw, lh] = spec.label;
  const radius = spec.shape === "gb" || spec.shape === "gba" ? 0.02 : 0.03;
  return (
    <group>
      <RoundedBox args={[w, h, d]} radius={Math.min(radius, d / 2 - 0.001)} smoothness={3} material={mats.plastic} />
      {/* étiquette (coin supérieur gauche de la zone en fraction de la face) */}
      <mesh position={[-w / 2 + (lx + lw / 2) * w, h / 2 - (ly + lh / 2) * h, d / 2 + 0.0015]} material={mats.label}>
        <planeGeometry args={[lw * w, lh * h]} />
      </mesh>
      {/* stries de préhension */}
      {spec.shape !== "gba" &&
        Array.from({ length: 5 }, (_, i) => (
          <mesh key={i} position={[0, -h / 2 + 0.035 + i * 0.022, d / 2 + 0.002]} material={mats.plastic}>
            <boxGeometry args={[w * 0.5, 0.006, 0.004]} />
          </mesh>
        ))}
    </group>
  );
}
