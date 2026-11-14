import { useEffect, useMemo } from "react";
import { Color, ExtrudeGeometry, MeshPhysicalMaterial, MeshStandardMaterial, Shape, type Material } from "three";
import type { CardMedia } from "./caseSpecs";

/**
 * Carte de jeu (Switch, Switch 2, DS, 3DS) : plastique moulé au coin biseauté,
 * stries de préhension en haut, étiquette autocollante brillante qui couvre
 * presque toute la face, contacts dorés au dos. Proportions des vraies cartes,
 * dessin original (aucune marque reproduite).
 */
export function GameCardModel({ media, label }: { media: CardMedia; label: Material }) {
  const { width: w, height: h, thickness: d } = media;

  const geometry = useMemo(() => {
    const chamfer = Math.min(w, h) * 0.16; // coin supérieur droit coupé
    const r = Math.min(w, h) * 0.06;
    const x0 = -w / 2;
    const y0 = -h / 2;
    const s = new Shape();
    s.moveTo(x0 + r, y0);
    s.lineTo(x0 + w - r, y0);
    s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
    s.lineTo(x0 + w, y0 + h - chamfer);
    s.lineTo(x0 + w - chamfer, y0 + h);
    s.lineTo(x0 + r, y0 + h);
    s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
    s.lineTo(x0, y0 + r);
    s.quadraticCurveTo(x0, y0, x0 + r, y0);
    const bevel = d * 0.18;
    const g = new ExtrudeGeometry(s, { depth: d - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 6 });
    g.translate(0, 0, -(d - bevel * 2) / 2);
    return g;
  }, [w, h, d]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const mats = useMemo(() => {
    const base = new Color(media.color);
    return {
      body: new MeshPhysicalMaterial({ color: base, roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.35 }),
      ridge: new MeshStandardMaterial({ color: base.clone().multiplyScalar(0.8), roughness: 0.6 }),
      gold: new MeshStandardMaterial({ color: "#c9a24a", metalness: 0.9, roughness: 0.3 }),
    };
  }, [media.color]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  // étiquette : presque toute la face, sous la zone de préhension
  const labelW = w * 0.86;
  const labelH = h * 0.7;
  const labelY = -h * 0.08;
  const front = d / 2 + 0.0008;

  return (
    <group>
      <mesh geometry={geometry} material={mats.body} />
      {/* stries de préhension */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[-w * 0.08, h / 2 - h * 0.075 - i * h * 0.035, d / 2 + 0.0004]} material={mats.ridge}>
          <boxGeometry args={[w * 0.5, h * 0.012, 0.0012]} />
        </mesh>
      ))}
      {/* étiquette autocollante */}
      <mesh position={[0, labelY, front]} material={label}>
        <planeGeometry args={[labelW, labelH]} />
      </mesh>
      {/* contacts au dos */}
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={i} position={[-w * 0.36 + i * w * 0.1, -h * 0.38, -d / 2 - 0.0004]} rotation={[0, Math.PI, 0]} material={mats.gold}>
          <planeGeometry args={[w * 0.06, h * 0.12]} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Logement de la carte dans le boîtier : cadre moulé en relief, fond plus
 * sombre, encoche pour le pouce et petites pattes de maintien.
 */
export function CardHolder({ media, inner }: { media: CardMedia; inner: string }) {
  const { width: w, height: h } = media;
  const mats = useMemo(() => {
    const base = new Color(inner);
    return {
      floor: new MeshStandardMaterial({ color: base.clone().multiplyScalar(0.55), roughness: 0.85 }),
      frame: new MeshStandardMaterial({ color: base.clone().multiplyScalar(0.92), roughness: 0.55 }),
      tab: new MeshStandardMaterial({ color: base.clone().multiplyScalar(1.05), roughness: 0.5 }),
    };
  }, [inner]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const pad = 0.014;
  const fw = w + pad * 2;
  const fh = h + pad * 2;
  const bar = 0.01;
  const rise = 0.01;
  return (
    <group>
      {/* fond du logement */}
      <mesh position={[0, 0, 0.0008]} material={mats.floor}>
        <planeGeometry args={[fw, fh]} />
      </mesh>
      {/* cadre en relief */}
      <mesh position={[0, fh / 2 + bar / 2, rise / 2]} material={mats.frame}>
        <boxGeometry args={[fw + bar * 2, bar, rise]} />
      </mesh>
      <mesh position={[0, -fh / 2 - bar / 2, rise / 2]} material={mats.frame}>
        <boxGeometry args={[fw + bar * 2, bar, rise]} />
      </mesh>
      <mesh position={[-fw / 2 - bar / 2, 0, rise / 2]} material={mats.frame}>
        <boxGeometry args={[bar, fh, rise]} />
      </mesh>
      <mesh position={[fw / 2 + bar / 2, 0, rise / 2]} material={mats.frame}>
        <boxGeometry args={[bar, fh, rise]} />
      </mesh>
      {/* encoche pour le pouce, en bas */}
      <mesh position={[0, -fh / 2 - bar / 2, rise + 0.0004]} material={mats.floor}>
        <circleGeometry args={[w * 0.16, 32, 0, Math.PI]} />
      </mesh>
      {/* pattes de maintien */}
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * (fw / 2 - 0.004), fh * 0.18, rise * 0.9]} material={mats.tab}>
          <boxGeometry args={[0.01, h * 0.16, 0.006]} />
        </mesh>
      ))}
    </group>
  );
}
