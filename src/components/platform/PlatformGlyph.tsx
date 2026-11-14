import type { ReactElement } from "react";
import type { GlyphId } from "@/domain/types";

/**
 * Pictogrammes de consoles : formes abstraites et originales évoquant le
 * format de chaque machine (aucun logo officiel).
 */
const GLYPHS: Record<GlyphId, ReactElement> = {
  // écran d'ordinateur sur son pied
  computer: (
    <>
      <rect x="6" y="8" width="36" height="24" rx="3.5" />
      <rect x="10.5" y="12.5" width="27" height="15" rx="1.5" />
      <path d="M24 32v5M16 40.5h16" />
    </>
  ),
  cube: (
    <>
      <path d="M24 6 39 14.5v19L24 42 9 33.5v-19z" />
      <path d="M9 14.5 24 23l15-8.5M24 23v19" />
      <circle cx="24" cy="31" r="3.4" />
    </>
  ),
  "slim-tower": (
    <>
      <rect x="17" y="5" width="14" height="38" rx="4" />
      <path d="M21 10.5h6" />
      <circle cx="24" cy="36" r="1.6" />
    </>
  ),
  "dual-screen": (
    <>
      <rect x="9" y="5" width="30" height="17" rx="3.5" />
      <rect x="9" y="26" width="30" height="17" rx="3.5" />
      <rect x="15" y="9" width="18" height="9" rx="1.5" />
      <rect x="18" y="30" width="12" height="9" rx="1.5" />
    </>
  ),
  "dual-screen-3d": (
    <>
      <rect x="7" y="5" width="34" height="17" rx="3.5" />
      <rect x="10" y="26" width="28" height="17" rx="3.5" />
      <rect x="13" y="9" width="22" height="9" rx="1.5" />
      <path d="M15 11.5l4 2.5-4 2.5" />
      <circle cx="16" cy="34.5" r="2" />
    </>
  ),
  "cartridge-wide": (
    <>
      <path d="M8 12h32v24a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" />
      <path d="M8 12l3-4h26l3 4" />
      <rect x="14" y="18" width="20" height="13" rx="2" />
    </>
  ),
  "handheld-portrait": (
    <>
      <rect x="12" y="4" width="24" height="40" rx="4" />
      <rect x="16" y="9" width="16" height="13" rx="2" />
      <path d="M18 30v6M15 33h6" />
      <circle cx="30" cy="31" r="1.8" />
      <circle cx="27" cy="35" r="1.8" />
    </>
  ),
  "handheld-wide": (
    <>
      <rect x="4" y="13" width="40" height="22" rx="9" />
      <rect x="15" y="17" width="18" height="14" rx="2" />
      <path d="M9 21v6M6 24h6" />
      <circle cx="39" cy="22" r="1.6" />
      <circle cx="37" cy="27" r="1.6" />
    </>
  ),
  hybrid: (
    <>
      <rect x="12" y="11" width="24" height="26" rx="2" />
      <path d="M12 11H9a4 4 0 0 0-4 4v18a4 4 0 0 0 4 4h3M36 11h3a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4h-3" />
      <circle cx="8.5" cy="18" r="1.4" />
      <circle cx="39.5" cy="28" r="1.4" />
    </>
  ),
  "disc-square": (
    <>
      <rect x="6" y="8" width="36" height="32" rx="4" />
      <circle cx="24" cy="24" r="10" />
      <circle cx="24" cy="24" r="2.5" />
    </>
  ),
  "tower-stripes": (
    <>
      <rect x="14" y="4" width="20" height="40" rx="3" />
      <path d="M14 13h20M14 22h20" />
      <circle cx="24" cy="34" r="2" />
    </>
  ),
  "handheld-oval": (
    <>
      <path d="M12 13h24a8 11 0 0 1 0 22H12a8 11 0 0 1 0-22z" />
      <rect x="15" y="17" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="24" r="1.6" />
      <circle cx="39.5" cy="24" r="1.6" />
    </>
  ),
};

export function PlatformGlyph({ glyph, size = 48, strokeWidth = 2.4 }: { glyph: GlyphId; size?: number | string; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[glyph]}
    </svg>
  );
}
