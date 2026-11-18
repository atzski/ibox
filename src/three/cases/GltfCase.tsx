import { Component, Suspense, useMemo, useRef, type MutableRefObject, type ReactNode } from "react";
import { createPortal, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Color, MeshPhysicalMaterial, MeshStandardMaterial, type Group, type Material, type Mesh, type Object3D, type Texture } from "three";
import type { KeepCaseSpec } from "./caseSpecs";
import type { CaseTextures } from "../useCaseTextures";
import { createCaseAnim, type KeepCaseAnim } from "./KeepCase";
import { stepSpring } from "../springs";
import { ManualBooklet } from "./ManualBooklet";
import type { CaseManual } from "./CaseModel";

/**
 * Boîtier physique modélisé dans Blender (3d-assets/), exporté en GLB.
 *
 * Un modèle maître par type de boîtier, partagé par tous les jeux : seules les
 * surfaces nommées ART_FRONT, ART_SPINE, ART_BACK et CARD_LABEL reçoivent les
 * jaquettes du jeu (les mêmes textures que le boîtier procédural, déjà en cache).
 * Conventions du fichier (voir 3d-assets/documentation) :
 *  - unités : mètres ; 1 unité iBox = 100 mm → échelle 10 ;
 *  - Y vers le haut, face avant vers +Z, boîtier posé sur y = 0 ;
 *  - pivots : « Front » sur l'axe de la charnière (ouverture = rotation Y
 *    négative), « Card » au centre de la carte (sortie = +Z puis +Y).
 */
const SCALE = 10;
const LITE_HIDDEN = /^(Card|Card_.*|Manual_Clip_.*|Front_Lip|Tray_Rim|Hinge|Sleeve_.*|Insert_.*)$/;

type Props = {
  spec: KeepCaseSpec & { glb: string };
  textures: CaseTextures | null;
  open?: boolean;
  discOut?: boolean;
  lite?: boolean;
  reduced?: boolean;
  anim?: MutableRefObject<KeepCaseAnim>;
  manual?: CaseManual | null;
};

/**
 * Place du carnet sur la face avant, d'après les deux clips du modèle
 * (Manual_Clip_T / _B, enfants de « Front ») : centré entre eux, bords pris
 * sous les clips, posé contre l'intérieur de la face. Sans clips (boîtier
 * cristal PS1) : pas de carnet en 3D, le lecteur reste accessible par le dock.
 */
function bookletLayout(front: Object3D | null) {
  const top = front?.getObjectByName("Manual_Clip_T");
  const bottom = front?.getObjectByName("Manual_Clip_B");
  if (!top || !bottom) {
    // boîtier cristal (PS1) : le livret est glissé contre l'intérieur de la face, sur toute sa surface
    const insert = front?.getObjectByName("Insert_Front") as Mesh | undefined;
    const geo = insert?.geometry;
    if (!insert || !geo) return null;
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    const w = (b.max.x - b.min.x) * 0.96;
    const h = (b.max.y - b.min.y) * 0.96;
    const thickness = 0.0012;
    return {
      width: w,
      height: h,
      thickness,
      position: [insert.position.x + (b.min.x + b.max.x) / 2, insert.position.y + (b.min.y + b.max.y) / 2, -0.0012 - thickness / 2 - 0.0001] as [number, number, number],
    };
  }
  const cx = (top.position.x + bottom.position.x) / 2;
  const height = top.position.y - bottom.position.y + 0.002;
  const thickness = 0.0016;
  return {
    width: Math.abs(cx) * 2 * 0.88,
    height,
    thickness,
    // contre l'intérieur de la face (z = -0,0012), sous les clips
    position: [cx, (top.position.y + bottom.position.y) / 2, -0.0012 - thickness / 2 - 0.0001] as [number, number, number],
  };
}

/** Matériaux partagés par tous les boîtiers d'un même modèle (par niveau de détail). */
const sharedCache = new Map<string, Map<string, Material>>();

function sharedMaterials(url: string, lite: boolean, source: Object3D): Map<string, Material> {
  const key = `${url}|${lite}`;
  const hit = sharedCache.get(key);
  if (hit) return hit;
  const out = new Map<string, Material>();
  source.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as MeshPhysicalMaterial;
    if (!m || out.has(m.name) || /^(ART_|CARD_LABEL|DISC_ART)/.test(m.name)) return;
    if (m.name.startsWith("SHELL")) {
      // Plastique translucide. En inspection : transmission réelle ; sur
      // l'étagère (des dizaines de boîtiers) : même teinte, sans passe de
      // transmission, pour rester fluide.
      const inner = m.name === "SHELL_INNER";
      out.set(
        m.name,
        lite
          ? new MeshStandardMaterial({ name: m.name, color: new Color(m.color).multiplyScalar(inner ? 0.92 : 1), roughness: m.roughness })
          : new MeshPhysicalMaterial({
              name: m.name,
              color: m.color,
              roughness: m.roughness,
              transmission: m.transmission,
              thickness: 0.0012,
              specularIntensity: 1,
              ior: 1.49,
              clearcoat: inner ? 0.15 : 0.6,
              clearcoatRoughness: 0.18,
            }),
      );
    } else if (m.name === "SLEEVE") {
      out.set(
        m.name,
        new MeshPhysicalMaterial({ name: m.name, color: "#ffffff", transparent: true, opacity: 0.09, roughness: 0.06, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.08 }),
      );
    } else if (m.name === "DISC") {
      // face gravée du disque : reflets métalliques
      out.set(m.name, new MeshStandardMaterial({ name: m.name, color: m.color, roughness: 0.16, metalness: 0.85 }));
    } else {
      out.set(m.name, new MeshStandardMaterial({ name: m.name, color: m.color, roughness: m.roughness }));
    }
  });
  sharedCache.set(key, out);
  return out;
}

/** Matériaux d'illustration, un par texture (partagés entre les instances d'un même jeu). */
const artCache = new WeakMap<Texture, MeshPhysicalMaterial>();
function artMaterial(map: Texture | undefined, name: string): Material {
  if (!map) return new MeshStandardMaterial({ name, color: "#e6e2ef", roughness: 0.55 });
  let m = artCache.get(map);
  if (!m) {
    m = new MeshPhysicalMaterial({
      name,
      map,
      roughness: name === "CARD_LABEL" ? 0.42 : 0.5,
      clearcoat: name === "CARD_LABEL" ? 0.6 : 0.4,
      clearcoatRoughness: 0.28,
      envMapIntensity: 0.55,
      alphaTest: name === "CARD_LABEL" ? 0.5 : 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    artCache.set(map, m);
  }
  return m;
}

function GltfCaseModel({ spec, textures, open = false, discOut = false, lite = false, reduced = false, anim, manual }: Props) {
  const gltf = useGLTF(spec.glb);
  const localAnim = useRef<KeepCaseAnim>(createCaseAnim());
  const a = anim ?? localAnim;

  // Une copie légère par boîtier : la géométrie reste partagée, seuls les nœuds sont copiés.
  const { root, front, card, cardHome } = useMemo(() => {
    const shared = sharedMaterials(spec.glb, lite, gltf.scene);
    const root = gltf.scene.clone(true);
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (lite && LITE_HIDDEN.test(o.name)) o.visible = false;
      if (!mesh.isMesh) return;
      const name = (mesh.material as Material).name;
      if (name === "ART_FRONT") mesh.material = artMaterial(textures?.front, name);
      else if (name === "ART_BACK") mesh.material = artMaterial(textures?.back, name);
      else if (name === "ART_SPINE") mesh.material = artMaterial(textures?.spine, name);
      else if (name === "CARD_LABEL") mesh.material = artMaterial(textures?.label, name);
      else if (name === "DISC_ART") mesh.material = artMaterial(textures?.disc, name);
      else mesh.material = shared.get(name) ?? mesh.material;
      if (name === "SLEEVE") mesh.renderOrder = 2;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });
    const front = root.getObjectByName("Front") ?? null;
    const card = root.getObjectByName("Card") ?? null;
    return { root, front, card, cardHome: card ? card.position.clone() : null };
  }, [gltf.scene, spec.glb, lite, textures]);

  const group = useRef<Group>(null);
  const booklet = useMemo(() => (lite ? null : bookletLayout(front)), [front, lite]);

  useFrame((state, dt) => {
    const st = a.current;
    const coverTarget = open || st.disc.x > 0.06 ? 1 : 0;
    const cardTarget = discOut && open && st.open.x > 0.7 ? 1 : 0;
    if (reduced) {
      st.open.x = coverTarget;
      st.open.v = 0;
      st.disc.x = cardTarget;
      st.disc.v = 0;
    } else {
      stepSpring(st.open, coverTarget, dt, 70, 11);
      if (st.open.x < 0) {
        st.open.x = 0;
        st.open.v = -st.open.v * 0.22;
      }
      stepSpring(st.disc, cardTarget, dt, 85, 14);
    }
    // la face pivote autour de la vraie charnière (côté tranche)
    if (front) front.rotation.y = -spec.openAngle * st.open.x;
    if (card && cardHome) {
      const k = st.disc.x;
      if (spec.media.type === "disc") {
        // le disque se dégage du moyeu, vient vers vous et tourne lentement sur lui-même
        card.position.set(cardHome.x, cardHome.y + k * 0.012, cardHome.z + k * 0.03);
        card.rotation.set(-k * 0.12, 0, reduced || spec.kind === "psp" ? 0 : state.clock.elapsedTime * 0.9 * k);
        card.scale.setScalar(1);
      } else {
        // la carte quitte ses clips (vers l'avant) puis monte au-dessus du support
        card.position.set(cardHome.x, cardHome.y + k * 0.028, cardHome.z + k * 0.045);
        card.rotation.y = reduced ? 0 : Math.sin(state.clock.elapsedTime * 1.2) * 0.35 * k;
        card.rotation.x = -k * 0.18;
        card.scale.setScalar(1 + k * 0.35);
      }
    }
  });

  // les copies de nœuds n'ont rien à libérer (géométries et matériaux partagés) ;
  // ne pas les vider au démontage : en développement, React remonte le composant
  // aussitôt avec la même copie, qui serait restée vide.

  return (
    <group ref={group} scale={SCALE}>
      <primitive object={root} position={[0, -spec.height / SCALE / 2, 0]} />
      {manual && booklet && front &&
        createPortal(
          <ManualBooklet
            texture={manual.texture}
            width={booklet.width}
            height={booklet.height}
            thickness={booklet.thickness}
            position={booklet.position}
            facing={-1}
            active={open}
            out={manual.out}
            lift={0.0028}
            reduced={reduced}
            onPress={manual.onPress}
          />,
          front,
        )}
    </group>
  );
}

/** Retour au boîtier procédural si le modèle ne se charge pas (fichier absent, WebGL limité…). */
class CaseErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("iBox : modèle 3D indisponible, boîtier simplifié utilisé.", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function GltfCase(props: Props & { fallback: ReactNode }) {
  const { fallback, ...rest } = props;
  return (
    <CaseErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <GltfCaseModel {...rest} />
      </Suspense>
    </CaseErrorBoundary>
  );
}

/** Précharge les modèles de boîtiers (appelé pendant un temps mort). */
export function preloadCaseModels(urls: string[]): void {
  for (const u of urls) useGLTF.preload(u);
}
