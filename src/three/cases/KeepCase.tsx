import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import {
  CanvasTexture,
  SRGBColorSpace,
  Color,
  DoubleSide,
  LatheGeometry,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector2,
  type Group,
} from "three";
import type { DiscMedia, KeepCaseSpec } from "./caseSpecs";
import type { CaseTextures } from "../useCaseTextures";
import { CardHolder, GameCardModel } from "./GameCardModel";
import { stepSpring, type SpringState } from "../springs";
import { ManualBooklet } from "./ManualBooklet";
import type { CaseManual } from "./CaseModel";

/**
 * Écart entre la jaquette et le plastique. Les arrondis des boîtes plastiques
 * dépassent légèrement de leurs faces : avec un écart trop fin, le plastique
 * repassait devant la jaquette vue pile de face (tranche blanche à 90°).
 */
const ART_GAP = 0.004;

export interface KeepCaseAnim {
  /** 0 = fermé, 1 = ouvert. */
  open: SpringState;
  /** 0 = disque en place, 1 = disque sorti pour examen. */
  disc: SpringState;
}

export const createCaseAnim = (): KeepCaseAnim => ({ open: { x: 0, v: 0 }, disc: { x: 0, v: 0 } });

/**
 * Boîtier à disque paramétrique et réutilisable (GameCube aujourd'hui ;
 * Wii, PS2… demain avec une autre `KeepCaseSpec`). Les textures sont
 * appliquées dynamiquement : aucun modèle n'est propre à un jeu.
 *
 * Structure :
 *  - plateau arrière (dos + parois + tranche) contenant le moyeu et le disque ;
 *  - face avant articulée sur la charnière (côté tranche), avec le manuel.
 */
export function KeepCase({
  spec,
  textures,
  open = false,
  discOut = false,
  lite = false,
  reduced = false,
  anim,
  manual,
}: {
  manual?: CaseManual | null;
  spec: KeepCaseSpec;
  textures: CaseTextures | null;
  open?: boolean;
  discOut?: boolean;
  /** Version allégée (étagère) : pas d'intérieur. */
  lite?: boolean;
  reduced?: boolean;
  anim?: MutableRefObject<KeepCaseAnim>;
}) {
  const { width: W, height: H, depth: D, shell: t, media } = spec;
  // géométrie de disque toujours prête (les cartes de jeu n'en utilisent pas)
  const disc: DiscMedia = media.type === "disc" ? media : { type: "disc", radius: 0.3, holeRadius: 0.05, thickness: media.thickness, offset: media.offset };
  const Wc = W - t; // largeur de la face avant articulée
  const localAnim = useRef<KeepCaseAnim>(createCaseAnim());
  const a = anim ?? localAnim;

  const cover = useRef<Group>(null);
  const discGroup = useRef<Group>(null);
  const discSpin = useRef<Group>(null);

  const mats = useMemo(() => {
    const plastic = new MeshPhysicalMaterial({
      color: spec.plastic,
      roughness: 0.42,
      metalness: 0,
      clearcoat: 0.35,
      clearcoatRoughness: 0.35,
    });
    const inner = new MeshStandardMaterial({ color: spec.plasticInner, roughness: 0.75 });
    // Bords sans jaquette (ouverture, haut, bas) : plastique moulé mat, un ton
    // plus sombre, pour ne pas ressembler à une face blanche sans texture.
    const edge = new MeshStandardMaterial({ color: new Color(spec.plastic).multiplyScalar(0.7), roughness: 0.62 });
    const groove = new MeshPhysicalMaterial({ map: openingTexture(spec.plastic), roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.4 });
    const art = (map?: CaseTextures[keyof CaseTextures]) =>
      new MeshPhysicalMaterial({
        map: map ?? null,
        color: map ? "#ffffff" : "#d9d3ec",
        roughness: 0.5,
        clearcoat: 0.55,
        clearcoatRoughness: 0.28,
        envMapIntensity: 0.55,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
    const discData = new MeshPhysicalMaterial({
      color: "#dfe4ec",
      metalness: 1,
      roughness: 0.16,
      iridescence: 1,
      iridescenceIOR: 1.7,
      iridescenceThicknessRange: [180, 620],
    });
    const discLabel = new MeshStandardMaterial({
      map: textures?.disc ?? null,
      color: textures ? "#ffffff" : "#e8e4f3",
      roughness: 0.5,
      metalness: 0.05,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const paper = new MeshStandardMaterial({ color: "#f5f2ea", roughness: 0.9 });
    const manualCover = new MeshStandardMaterial({ map: textures?.front ?? null, roughness: 0.65 });
    // étiquette brillante aux coins arrondis (transparents dans la texture)
    const label = new MeshPhysicalMaterial({
      map: textures?.label ?? null,
      color: textures ? "#ffffff" : "#e8e4f3",
      roughness: 0.42,
      clearcoat: 0.6,
      clearcoatRoughness: 0.25,
      alphaTest: 0.5,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    return {
      plastic,
      inner,
      edge,
      groove,
      front: art(textures?.front),
      back: art(textures?.back),
      spine: art(textures?.spine),
      discData,
      discLabel,
      paper,
      manual: [paper, paper, paper, paper, paper, manualCover],
      label,
    };
  }, [spec, textures]);

  // Libère les matériaux GPU quand les textures changent ou au démontage
  useEffect(
    () => () => {
      mats.groove.map?.dispose();
      for (const m of new Set(Object.values(mats).flat())) m.dispose();
    },
    [mats],
  );

  // Disque troué : profil tourné (lathe) pour un vrai trou central.
  const discGeometry = useMemo(() => {
    const h = disc.thickness / 2;
    const pts = [
      new Vector2(disc.holeRadius, -h),
      new Vector2(disc.radius, -h),
      new Vector2(disc.radius, h),
      new Vector2(disc.holeRadius, h),
      new Vector2(disc.holeRadius, -h),
    ];
    const g = new LatheGeometry(pts, 96);
    g.rotateX(Math.PI / 2);
    return g;
  }, [disc]);
  useEffect(() => () => discGeometry.dispose(), [discGeometry]);

  const floorZ = -D / 2 + t;
  const discBaseZ = floorZ + 0.012 + media.thickness / 2;
  const [ox, oy] = media.offset;

  useFrame((state, dt) => {
    const st = a.current;
    // La face ne se referme qu'une fois le disque rangé ; le disque ne sort
    // qu'une fois la face suffisamment ouverte.
    const coverTarget = open || st.disc.x > 0.06 ? 1 : 0;
    const discTarget = discOut && open && st.open.x > 0.7 ? 1 : 0;

    if (reduced) {
      st.open.x = coverTarget;
      st.open.v = 0;
      st.disc.x = discTarget;
      st.disc.v = 0;
    } else {
      stepSpring(st.open, coverTarget, dt, 70, 11);
      // petit « clac » à la fermeture
      if (st.open.x < 0) {
        st.open.x = 0;
        st.open.v = -st.open.v * 0.22;
      }
      stepSpring(st.disc, discTarget, dt, 85, 14);
    }

    if (cover.current) cover.current.rotation.y = -spec.openAngle * st.open.x;
    if (discGroup.current) {
      // Sorti, le disque flotte au centre de la boîte ouverte (au-dessus de la charnière)
      const k = st.disc.x;
      const cx = -W / 2;
      discGroup.current.position.set(ox + (cx - ox) * k, oy * (1 - k), discBaseZ + k * 0.95);
      discGroup.current.rotation.x = -k * 0.22;
      discGroup.current.rotation.y = k * 0.12;
      discGroup.current.scale.setScalar(1 + k * 0.3);
    }
    if (discSpin.current && !reduced) {
      if (media.type === "disc") discSpin.current.rotation.z -= dt * a.current.disc.x * 0.9;
      // une carte de jeu se balance doucement au lieu de tourner
      else discSpin.current.rotation.y = Math.sin(state.clock.elapsedTime * 1.2) * 0.45 * a.current.disc.x;
    }
  });

  return (
    <group>
      {/* ——— Plateau arrière ——— */}
      <RoundedBox args={[W, H, t]} radius={spec.radius} smoothness={3} position={[0, 0, -D / 2 + t / 2]} material={mats.plastic} />
      {/* parois haut / bas / ouverture */}
      <mesh position={[t / 2, H / 2 - t / 2, 0]} material={mats.edge}>
        <boxGeometry args={[W - t, t, D - 2 * t]} />
      </mesh>
      <mesh position={[t / 2, -H / 2 + t / 2, 0]} material={mats.edge}>
        <boxGeometry args={[W - t, t, D - 2 * t]} />
      </mesh>
      <mesh position={[W / 2 - t / 2, 0, 0]} material={mats.edge}>
        <boxGeometry args={[t, H - 2 * t, D - 2 * t]} />
      </mesh>
      {/* rainure d'ouverture, comme sur un vrai boîtier */}
      <mesh position={[W / 2 + 0.0008, 0, 0]} rotation={[0, Math.PI / 2, 0]} material={mats.groove}>
        <planeGeometry args={[D - 2 * t, H - 2 * t]} />
      </mesh>
      {/* tranche (charnière) */}
      <RoundedBox args={[t, H, D]} radius={spec.radius * 0.6} smoothness={3} position={[-W / 2 + t / 2, 0, 0]} material={mats.plastic} />

      {/* jaquette : dos et tranche */}
      <mesh position={[0, 0, -D / 2 - ART_GAP]} rotation={[0, Math.PI, 0]} material={mats.back}>
        <planeGeometry args={[W - 0.018, H - 0.018]} />
      </mesh>
      <mesh position={[-W / 2 - ART_GAP, 0, 0]} rotation={[0, -Math.PI / 2, 0]} material={mats.spine}>
        <planeGeometry args={[D - 0.008, H - 0.018]} />
      </mesh>

      {!lite && (
        <>
          {/* fond intérieur */}
          <mesh position={[t / 2, 0, floorZ + 0.0006]} material={mats.inner}>
            <planeGeometry args={[W - 2 * t - 0.02, H - 2 * t - 0.02]} />
          </mesh>
          {media.type === "disc" ? (
            <>
          {/* logement du disque */}
              <mesh position={[ox, oy, floorZ + 0.0012]}>
                <ringGeometry args={[disc.radius + 0.004, disc.radius + 0.03, 96]} />
                <meshStandardMaterial color="#17191e" roughness={0.8} />
              </mesh>
              {/* moyeu */}
              <group position={[ox, oy, floorZ]}>
                <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.016]} material={mats.inner}>
                  <cylinderGeometry args={[disc.holeRadius * 0.92, disc.holeRadius * 1.25, 0.032, 40]} />
                </mesh>
                {Array.from({ length: 8 }, (_, i) => {
                  const ang = (i / 8) * Math.PI * 2;
                  return (
                    <mesh
                      key={i}
                      position={[Math.cos(ang) * disc.holeRadius * 0.62, Math.sin(ang) * disc.holeRadius * 0.62, 0.034]}
                      rotation={[0, 0, ang]}
                      material={mats.plastic}
                    >
                      <boxGeometry args={[0.03, 0.012, 0.01]} />
                    </mesh>
                  );
                })}
              </group>

              {/* disque */}
              <group ref={discGroup} position={[ox, oy, discBaseZ]}>
                <group ref={discSpin}>
                  <mesh geometry={discGeometry} material={mats.discData} />
                  <mesh position={[0, 0, disc.thickness / 2 + 0.0004]} material={mats.discLabel}>
                    <ringGeometry args={[disc.holeRadius, disc.radius - 0.004, 96]} />
                  </mesh>
                </group>
              </group>
            </>
          ) : (
            <>
              {/* logement de la carte */}
              <group position={[ox, oy, floorZ + 0.0004]}>
                <CardHolder media={media} inner={spec.plasticInner} />
              </group>
              {/* carte de jeu */}
              <group ref={discGroup} position={[ox, oy, discBaseZ]}>
                <group ref={discSpin}>
                  <GameCardModel media={media} label={mats.label} />
                </group>
              </group>
            </>
          )}
        </>
      )}

      {/* ——— Face avant articulée ——— */}
      <group ref={cover} position={[-W / 2 + t, 0, D / 2 - t / 2]}>
        <RoundedBox args={[Wc, H, t]} radius={spec.radius} smoothness={3} position={[Wc / 2, 0, 0]} material={mats.plastic} />
        <mesh position={[Wc / 2, 0, t / 2 + ART_GAP]} material={mats.front}>
          <planeGeometry args={[Wc - 0.016, H - 0.018]} />
        </mesh>
        {!lite && (
          <>
            {/* manuel tenu par deux languettes : le vrai carnet du jeu quand il existe */}
            {manual ? (
              <ManualBooklet
                texture={manual.texture}
                width={Wc * 0.82}
                height={H * 0.86}
                thickness={0.012}
                position={[Wc / 2 + 0.01, 0, -t / 2 - 0.0075]}
                facing={-1}
                active={open}
                out={manual.out}
                lift={0.03}
                reduced={reduced}
                onPress={manual.onPress}
              />
            ) : (
              <mesh position={[Wc / 2 + 0.01, 0, -t / 2 - 0.0045]} material={mats.manual}>
                <boxGeometry args={[Wc * 0.82, H * 0.86, 0.007]} />
              </mesh>
            )}
            {[1, -1].map((s) => (
              <mesh key={s} position={[Wc / 2 + 0.01, s * (H * 0.43 + 0.006), -t / 2 - 0.006]} material={mats.inner}>
                <boxGeometry args={[0.16, 0.03, 0.012]} />
              </mesh>
            ))}
          </>
        )}
      </group>
    </group>
  );
}

/**
 * Bord d'ouverture d'un boîtier : plastique moulé arrondi (reflet au centre),
 * jonction des deux coques, encoche pour le pouce et petites nervures, au lieu
 * d'une face unie.
 */
function openingTexture(plastic: string): CanvasTexture {
  const w = 128, h = 1024;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const base = new Color(plastic);
  const css = (k: number, a = 1) => `rgba(${Math.round(Math.min(1, base.r * k) * 255)},${Math.round(Math.min(1, base.g * k) * 255)},${Math.round(Math.min(1, base.b * k) * 255)},${a})`;
  // arrondi du plastique : sombre sur les bords, clair au centre
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, css(0.62));
  g.addColorStop(0.3, css(0.92));
  g.addColorStop(0.5, css(1.05));
  g.addColorStop(0.7, css(0.9));
  g.addColorStop(1, css(0.6));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // jonction des deux coques
  ctx.fillStyle = css(0.45, 0.8);
  ctx.fillRect(w * 0.5 - 1.5, 0, 3, h);
  // nervures de prise en main, en haut et en bas
  for (const y0 of [h * 0.08, h * 0.8]) {
    for (let i = 0; i < 9; i++) {
      const y = y0 + i * 12;
      ctx.fillStyle = css(0.55, 0.55);
      ctx.fillRect(w * 0.18, y, w * 0.64, 3);
      ctx.fillStyle = css(1.15, 0.5);
      ctx.fillRect(w * 0.18, y + 3, w * 0.64, 2);
    }
  }
  // encoche pour le pouce, au milieu
  const notch = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w * 0.42);
  notch.addColorStop(0, css(0.5, 0.95));
  notch.addColorStop(0.75, css(0.7, 0.6));
  notch.addColorStop(1, css(0.9, 0));
  ctx.fillStyle = notch;
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w * 0.38, h * 0.11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = css(1.2, 0.5);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2 + 2, w * 0.38, h * 0.11, 0, 0.1 * Math.PI, 0.9 * Math.PI);
  ctx.stroke();
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
