import { compat } from "@/theme/cssCompat";
import { memo } from "react";

/**
 * Signature visuelle d'iBox : de petites formes pastel (capsules, bulles,
 * étoiles) qui flottent lentement derrière les écrans, aux couleurs de la
 * palette. Uniquement des transformations CSS (calculées par la carte
 * graphique) ; immobiles si les animations sont réduites.
 */
const SHAPES: { kind: "capsule" | "bubble" | "star" | "ring"; x: number; y: number; s: number; c: string; d: number; delay: number; r: number }[] = [
  { kind: "capsule", x: 6, y: 18, s: 54, c: "var(--ibox-sky)", d: 26, delay: 0, r: -24 },
  { kind: "bubble", x: 18, y: 72, s: 34, c: "var(--ibox-peach)", d: 31, delay: -6, r: 0 },
  { kind: "star", x: 31, y: 10, s: 20, c: "var(--ibox-lavender)", d: 22, delay: -3, r: 12 },
  { kind: "ring", x: 44, y: 84, s: 40, c: "var(--ibox-mint)", d: 34, delay: -12, r: 0 },
  { kind: "capsule", x: 57, y: 6, s: 42, c: "var(--ibox-peach)", d: 29, delay: -9, r: 32 },
  { kind: "star", x: 66, y: 58, s: 16, c: "var(--ibox-sky)", d: 24, delay: -15, r: -8 },
  { kind: "bubble", x: 78, y: 22, s: 26, c: "var(--ibox-mint)", d: 27, delay: -4, r: 0 },
  { kind: "capsule", x: 88, y: 76, s: 48, c: "var(--ibox-lavender)", d: 33, delay: -18, r: -40 },
  { kind: "ring", x: 94, y: 40, s: 28, c: "var(--ibox-peach)", d: 30, delay: -21, r: 0 },
  { kind: "star", x: 12, y: 45, s: 14, c: "var(--ibox-mint)", d: 20, delay: -10, r: 20 },
  { kind: "bubble", x: 50, y: 40, s: 18, c: "var(--ibox-lavender)", d: 36, delay: -25, r: 0 },
];

export const AmbientShapes = memo(function AmbientShapes() {
  return (
    <div aria-hidden className="ibox-shapes pointer-events-none absolute inset-0">
      {SHAPES.map((sh, i) => (
        <span
          key={i}
          className="ibox-shape absolute"
          style={{
            left: `${sh.x}%`,
            top: `${sh.y}%`,
            width: sh.kind === "capsule" ? sh.s * 1.9 : sh.s,
            height: sh.s,
            animationDuration: `${sh.d}s`,
            animationDelay: `${sh.delay}s`,
            ["--rot" as string]: `${sh.r}deg`,
          }}
        >
          <Shape kind={sh.kind} color={sh.c} />
        </span>
      ))}
    </div>
  );
});

function Shape({ kind, color }: { kind: string; color: string }) {
  if (kind === "star") {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path d="M12 2.5c.8 5.6 3.9 8.7 9.5 9.5-5.6.8-8.7 3.9-9.5 9.5-.8-5.6-3.9-8.7-9.5-9.5 5.6-.8 8.7-3.9 9.5-9.5z" fill={color} />
      </svg>
    );
  }
  if (kind === "ring") {
    return <span className="block h-full w-full rounded-full" style={{ border: `4px solid ${color}` }} />;
  }
  // capsule et bulle : dégradé doux avec un petit reflet
  return (
    <span
      className="block h-full w-full rounded-full"
      style={{ background: compat(`radial-gradient(circle at 30% 28%, rgba(255,255,255,0.85) 0 12%, transparent 13%), linear-gradient(140deg, color-mix(in oklab, ${color} 55%, white), ${color})`) }}
    />
  );
}
