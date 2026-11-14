import { useEffect, useState } from "react";
import { riotImage, riotChampionImage } from "@/services/avatarProviders";
import type { CSSProperties } from "react";
import { useSettings, type AvatarChoice } from "@/services/settings";
import { useLibrary } from "@/services/library";
import { usePlatformArt } from "@/services/platformArt";
import { CoverImage } from "@/components/game/CoverImage";
import { Icon, type IconName } from "@/components/ui/Icon";

/** Styles de photo de profil propres à iBox : dégradé pastel et pictogramme. */
export const AVATAR_PRESETS: { id: string; icon: IconName; from: string; to: string }[] = [
  { id: "manette-peche", icon: "gamepad", from: "#FFD3C2", to: "#F3AFA4" },
  { id: "etoile-lavande", icon: "star", from: "#E4D9FB", to: "#B5A0E9" },
  { id: "eclat-ciel", icon: "sparkle", from: "#DDF0FF", to: "#88CBF5" },
  { id: "disque-menthe", icon: "disc", from: "#DDF6EA", to: "#98DEBE" },
  { id: "note-soleil", icon: "sound", from: "#FFF1CC", to: "#F6D58C" },
  { id: "monde-bleu", icon: "globe", from: "#CFE6FF", to: "#3289F5" },
  { id: "vague-corail", icon: "motion", from: "#FFE1DA", to: "#EE8F80" },
  { id: "maison-creme", icon: "home", from: "#FBF6EC", to: "#E8D9BC" },
  { id: "manette-nuit", icon: "gamepad", from: "#6E7FA8", to: "#344459" },
  { id: "etoile-aube", icon: "star", from: "#FFE3EC", to: "#C9B6F2" },
  { id: "eclat-lagon", icon: "sparkle", from: "#C8F2EE", to: "#4FB8B0" },
  { id: "disque-prune", icon: "disc", from: "#F1DDF7", to: "#A770C7" },
  { id: "jaquette-miel", icon: "front", from: "#FFF4D6", to: "#E9B44C" },
  { id: "cle-sauge", icon: "key", from: "#E7F2E1", to: "#8DB87A" },
  { id: "horloge-ardoise", icon: "clock", from: "#E6EAF0", to: "#8794A3" },
  { id: "dossier-pastel", icon: "folder", from: "#E4F3FF", to: "#B5A0E9" },
];

/**
 * Photo de profil. Sans choix : l'initiale du nom sur un dégradé pastel.
 */
export function Avatar({ size = 40, choice, name, className = "" }: { size?: number; choice?: AvatarChoice | null; name?: string; className?: string }) {
  const stored = useSettings((s) => s.profileAvatar);
  const profileName = useSettings((s) => s.profileName);
  const c = choice === undefined ? stored : choice;
  const label = (name ?? profileName).trim() || "Joueur";
  const box: CSSProperties = { width: size, height: size };
  const ring = `relative shrink-0 overflow-hidden rounded-full shadow-xs ring-2 ring-white/80 ${className}`;

  if (c?.type === "riot-champion") return <RemoteAvatar key={riotChampionImage(c)} src={riotChampionImage(c)} label={label} box={box} ring={ring} size={size} />;
  if (c?.type === "riot") return <RemoteAvatar key={riotImage(c)} src={riotImage(c)} label={label} box={box} ring={ring} size={size} />;
  if (c?.type === "image") {
    return <img src={c.dataUrl} alt="" draggable={false} className={`${ring} object-cover`} style={box} />;
  }
  if (c?.type === "game") return <GameAvatar gameId={c.gameId} box={box} ring={ring} fallback={label} />;
  if (c?.type === "platform") return <PlatformAvatar platformId={c.platformId} box={box} ring={ring} fallback={label} />;
  const preset = c?.type === "preset" ? AVATAR_PRESETS.find((p) => p.id === c.id) : undefined;
  if (preset) {
    return (
      <span className={`${ring} grid place-items-center text-white`} style={{ ...box, background: `linear-gradient(140deg, ${preset.from}, ${preset.to})` }}>
        <Icon name={preset.icon} size={`${size * 0.5}px`} />
      </span>
    );
  }
  return <Initial label={label} box={box} ring={ring} size={size} />;
}

function RemoteAvatar({ src, label, box, ring, size }: { src?: string; label: string; box: CSSProperties; ring: string; size: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const retry = () => setFailed(false);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);
  if (!src || failed) return <Initial label={label} box={box} ring={ring} size={size} />;
  return <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className={`${ring} object-cover`} style={box} onError={() => setFailed(true)} />;
}

function Initial({ label, box, ring, size }: { label: string; box: CSSProperties; ring: string; size: number }) {
  return (
    <span
      className={`${ring} grid place-items-center bg-[linear-gradient(135deg,var(--ibox-peach),var(--ibox-lavender))] font-display font-semibold text-on-accent`}
      style={{ ...box, fontSize: size * 0.44 }}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

function GameAvatar({ gameId, box, ring, fallback }: { gameId: string; box: CSSProperties; ring: string; fallback: string }) {
  const game = useLibrary((s) => s.games.find((g) => g.id === gameId));
  if (!game) return <Initial label={fallback} box={box} ring={ring} size={Number(box.width)} />;
  return (
    <span className={ring} style={box}>
      {/* jaquette centrée dans le cercle (le haut, souvent le plus parlant) */}
      <span className="absolute inset-x-0 top-[-12%] block">
        <CoverImage game={game} rounded="" sheen={false} />
      </span>
    </span>
  );
}

function PlatformAvatar({ platformId, box, ring, fallback }: { platformId: string; box: CSSProperties; ring: string; fallback: string }) {
  const icon = usePlatformArt(platformId, "platform_icon");
  if (!icon) return <Initial label={fallback} box={box} ring={ring} size={Number(box.width)} />;
  return <span className={`${ring} grid place-items-center bg-white`} style={box}><img src={icon} alt="" draggable={false} className="h-[78%] w-[78%] object-contain" /></span>;
}
