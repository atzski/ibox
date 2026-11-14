import { Environment, Lightformer } from "@react-three/drei";

/**
 * Éclairage « studio pastel » commun aux scènes 3D.
 * L'environnement est construit à partir de Lightformers locaux :
 * aucun fichier HDR téléchargé, l'application reste utilisable hors ligne.
 */
export function StudioLights({ tint = "#B9A6E8", dark = false }: { tint?: string; dark?: boolean }) {
  return (
    <>
      <ambientLight intensity={dark ? 0.36 : 0.42} />
      <directionalLight position={[3, 4, 5]} intensity={1.25} color="#fffaf2" />
      <directionalLight position={[-4, 1.5, -3]} intensity={0.7} color={tint} />
      <directionalLight position={[0, -3, 2]} intensity={0.25} color="#dff1fc" />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={1.1} position={[0, 5, 2]} scale={[6, 1.6, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={1.4} position={[-5, 1, 1]} rotation-y={Math.PI / 2} scale={[6, 2, 1]} color="#dff1fc" />
        <Lightformer form="rect" intensity={1.2} position={[5, 0, 1]} rotation-y={-Math.PI / 2} scale={[6, 2, 1]} color="#fde6da" />
        <Lightformer form="ring" intensity={1.5} position={[2, 2, -4]} scale={2.5} color={tint} />
        <mesh scale={30}>
          <sphereGeometry />
          <meshBasicMaterial color={dark ? "#3a3f55" : "#e9e6f2"} side={1} />
        </mesh>
      </Environment>
    </>
  );
}
