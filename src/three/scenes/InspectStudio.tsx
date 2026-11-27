import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, SoftShadows } from "@react-three/drei";
import { useGraphics } from "@/services/budget";
import { BufferGeometry, Color, Float32BufferAttribute, Object3D, ShadowMaterial, type DirectionalLight, type Mesh, type Object3D as O3D, type SpotLight } from "three";

/**
 * Studio photo de la fiche de jeu : une lumière principale douce qui projette
 * une vraie ombre (bords adoucis) sur un sol et un mur invisibles, une lumière
 * de remplissage froide, une lumière de découpe à la couleur de la console, et
 * deux ombres de contact. La lumière principale suit doucement le pointeur :
 * la source vient du coin supérieur droit et dérive très lentement d'elle-même.
 */
export function InspectStudio({ tint, dark, reduced, floorY, subject }: {
  tint: string;
  dark: boolean;
  reduced: boolean;
  /** Hauteur du sol (sous le boîtier). */
  floorY: number;
  /** Groupe du boîtier : ses maillages projettent et reçoivent les ombres. */
  subject: React.RefObject<O3D | null>;
}) {
  const key = useRef<DirectionalLight>(null);
  const rim = useRef<SpotLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const frame = useRef(0);
  // palier allégé (Steam Deck) : carte d'ombre de 1024 px et pénombre à 6 échantillons au lieu de 12
  const { shadowMap } = useGraphics();
  const light = shadowMap < 2048;

  // le boîtier se charge par morceaux (textures, modèle) : on (re)déclare
  // régulièrement ses maillages comme porteurs et receveurs d'ombres
  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    if (frame.current++ % 20 === 0 && subject.current) {
      subject.current.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        const transparent = (m.material as { transparent?: boolean }).transparent;
        m.castShadow = !transparent;
        m.receiveShadow = !transparent;
      });
    }
    const k = key.current;
    if (k) {
      // source fixe dans le coin supérieur droit, qui dérive très lentement
      // d'elle-même (comme une lumière de fenêtre) : l'ombre vit sans action
      const t = state.clock.elapsedTime;
      const px = reduced ? 0 : Math.sin(t * 0.11) * 0.45;
      const py = reduced ? 0 : Math.sin(t * 0.07 + 1.3) * 0.25;
      const k1 = 1 - Math.exp(-2.2 * dt);
      k.position.x += (2.6 + px - k.position.x) * k1;
      k.position.y += (4.4 + py - k.position.y) * k1;
    }
  });

  useEffect(() => {
    target.position.set(0, 0, 0);
  }, [target]);

  const cyc = useMemo(() => cycloramaGeometry(floorY), [floorY]);
  // fond transparent : le sol et le mur ne gardent que l'ombre du boîtier,
  // le fond d'écran du jeu reste entièrement visible derrière
  const cycMat = useMemo(() => {
    const shade = new Color("#05070d").lerp(new Color(tint), 0.03);
    return new ShadowMaterial({ color: shade, opacity: dark ? 0.24 : 0.18, transparent: true, depthWrite: false });
  }, [dark, tint]);
  useEffect(() => () => cyc.dispose(), [cyc]);
  useEffect(() => () => cycMat.dispose(), [cycMat]);
  return (
    <>
      {/* ombres douces à pénombre (PCSS) : plus floues loin du boîtier */}
      <SoftShadows size={22} samples={light ? 6 : 12} focus={0.6} />
      <ambientLight intensity={dark ? 0.32 : 0.4} />
      <primitive object={target} />
      <directionalLight
        ref={key}
        position={[2.6, 4.4, 3.8]}
        intensity={dark ? 1.45 : 1.6}
        color="#fff4e6"
        target={target}
        castShadow
        shadow-mapSize={[shadowMap, shadowMap]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.025}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-camera-near={1}
        shadow-camera-far={16}
      />
      {/* remplissage froid à gauche, sans ombre */}
      <directionalLight position={[-4, 1.2, 2.5]} intensity={dark ? 0.45 : 0.55} color="#dcecff" />
      {/* découpe : liseré coloré qui dessine les arêtes */}
      <spotLight ref={rim} position={[-1.6, 3.2, -3.4]} angle={0.26} penumbra={0.6} decay={0} distance={0} intensity={dark ? 2.6 : 2.1} color={tint} target={target} />
      <spotLight position={[2.8, -0.6, -3]} angle={0.6} penumbra={1} decay={0} distance={0} intensity={0.9} color="#ffffff" target={target} />

      {/* reflets : boîtes à lumière locales (aucun fichier HDR, hors ligne) */}
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2.2} position={[1.5, 4, 3]} scale={[5, 1.4, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={1.1} position={[-5, 1, 1]} rotation-y={Math.PI / 2} scale={[6, 2, 1]} color="#dff1fc" />
        <Lightformer form="rect" intensity={1.0} position={[5, 0, 1]} rotation-y={-Math.PI / 2} scale={[6, 2, 1]} color="#fde6da" />
        <Lightformer form="ring" intensity={1.6} position={[-2, 2.5, -4]} scale={2.2} color={tint} />
        <mesh scale={30}>
          <sphereGeometry />
          <meshBasicMaterial color={dark ? "#30354a" : "#ece8f3"} side={1} />
        </mesh>
      </Environment>

      {/* fond de studio : sol qui se courbe en mur (cyclo), éclairé, qui reçoit l'ombre */}
      <mesh geometry={cyc} material={cycMat} receiveShadow />

      {/* contact : un trait serré sous le boîtier, puis un halo diffus */}
      <ContactShadows position={[0, floorY + 0.002, 0]} opacity={dark ? 0.7 : 0.55} scale={5} blur={1.1} far={0.7} resolution={512} color={dark ? "#000000" : "#26304a"} />
      <ContactShadows position={[0, floorY + 0.001, 0]} opacity={dark ? 0.4 : 0.28} scale={8} blur={3} far={2.6} resolution={256} color={dark ? "#000000" : "#344459"} />
    </>
  );
}

/**
 * Cyclo de studio : un sol qui remonte en mur par une courbe douce, sans
 * angle ni bord visible. Profil en (z, y), extrudé sur la largeur.
 */
function cycloramaGeometry(floorY: number): BufferGeometry {
  const r = 1.5; // rayon de la courbe sol → mur
  const bend = -0.7; // z où le sol commence à remonter
  const prof: [number, number][] = [];
  for (let z = 5; z > bend; z -= 0.5) prof.push([z, floorY]);
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * (Math.PI / 2);
    prof.push([bend - Math.sin(a) * r, floorY + r - Math.cos(a) * r]);
  }
  for (let y = floorY + r + 0.5; y <= floorY + 10; y += 0.5) prof.push([bend - r, y]);
  const xs = [-9, -3, 3, 9];
  const pos: number[] = [];
  for (const [z, y] of prof) for (const x of xs) pos.push(x, y, z);
  const idx: number[] = [];
  const cols = xs.length;
  for (let j = 0; j < prof.length - 1; j++)
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // la face visible doit regarder la caméra (normale vers +y au sol, +z au mur)
  const n = g.getAttribute("normal");
  if (n.getY(0) < 0) {
    idx.reverse();
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}
