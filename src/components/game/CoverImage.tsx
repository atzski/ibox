import { useEffect, useRef, useState } from "react";
import type { Game } from "@/domain/types";
import { getArtUrl, peekArtUrl, artKey, type ArtFace } from "@/art/covers";
import { requirePlatform } from "@/domain/platforms";

/**
 * Jaquette préparée et décodée avant son entrée dans la zone visible.
 * Le rapport d'aspect suit la console du jeu.
 */
export function CoverImage({
  game,
  face = "front",
  className = "",
  rounded = "rounded-md",
  sheen = true,
}: {
  game: Game;
  face?: ArtFace;
  className?: string;
  rounded?: string;
  sheen?: boolean;
}) {
  const key = `${artKey(game)}:${face}`;
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null);
  const url = peekArtUrl(game, face) ?? (loaded?.key === key ? loaded.url : null);
  const [failed, setFailed] = useState(false);
  const aspect = requirePlatform(game.platformId).layout.coverAspect;
  // chargement paresseux : l'image n'est lue qu'à l'approche de l'écran
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") return setNear(true);
    // Expand the actual scroll container, not the viewport: clipping by the
    // library otherwise prevents rootMargin from preparing the following rows.
    const scrollRoot = el.closest<HTMLElement>("[data-cover-scroll-root]");
    const ahead = Math.max(1400, (scrollRoot?.clientHeight ?? window.innerHeight) * 3);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { root: scrollRoot, rootMargin: `${ahead}px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near || url) return;
    setFailed(false);
    let alive = true;
    getArtUrl(game, face)
      .then((u) => alive && setLoaded({ key, url: u }))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [game, face, near, key, url]);

  return (
    <div
      ref={box}
      className={`relative overflow-hidden ${rounded} ${className}`}
      style={{ aspectRatio: String(aspect) }}
    >
      {!url && !failed && <div className="ibox-shimmer absolute inset-0" />}
      {failed && (
        <div className="absolute inset-0 grid place-items-center bg-[var(--accent-soft)] p-3 text-center text-sm font-bold text-ink-soft">
          {game.title}
        </div>
      )}
      {url && (
        <img
          src={url}
          alt={`Jaquette de ${game.title}`}
          draggable={false}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
      {sheen && (
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(125deg,rgba(255,255,255,0.32)_0%,rgba(255,255,255,0)_38%)] ring-1 ring-black/5 ring-inset" />
      )}
    </div>
  );
}
