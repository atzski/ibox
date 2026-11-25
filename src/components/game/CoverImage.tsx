import { useEffect, useRef, useState } from "react";
import type { Game } from "@/domain/types";
import { getArtUrl, peekArtUrl, artKey, type ArtFace } from "@/art/covers";
import { peekAnyThumbUrl, peekThumbUrl, requestThumb } from "@/art/thumbs";
import { requirePlatform } from "@/domain/platforms";

/**
 * Jaquette préparée et décodée avant son entrée dans la zone visible.
 * Le rapport d'aspect suit la console du jeu.
 *
 * `thumb` (largeur en px) : vignette légère de la face avant au lieu de l'image complète,
 * pour la grille reculée de la bibliothèque (voir `art/thumbs.ts`). La grille n'affiche que
 * les rangées visibles : pas d'attente de l'approche de l'écran, pas d'animation d'attente.
 */
export function CoverImage({
  game,
  face = "front",
  className = "",
  rounded = "rounded-md",
  sheen = true,
  thumb = 0,
}: {
  game: Game;
  face?: ArtFace;
  className?: string;
  rounded?: string;
  sheen?: boolean;
  thumb?: number;
}) {
  const key = `${artKey(game)}:${face}:${thumb}`;
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null);
  const own = (thumb ? peekThumbUrl(game, thumb) : peekArtUrl(game, face)) ?? (loaded?.key === key ? loaded.url : null);
  // en attendant la bonne taille, l'autre version du même jeu si elle est déjà prête : changer
  // de niveau de recul ne fait pas clignoter les jaquettes déjà à l'écran
  const url = own ?? (face === "front" ? (thumb ? peekArtUrl(game, face) : peekAnyThumbUrl(game)) ?? null : null);
  const [failed, setFailed] = useState(false);
  const aspect = requirePlatform(game.platformId).layout.coverAspect;
  // chargement paresseux : l'image n'est lue qu'à l'approche de l'écran
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(thumb > 0);

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
    if (!near || own) return;
    setFailed(false);
    if (thumb) return requestThumb(game, thumb, (u) => setLoaded({ key, url: u }), () => setFailed(true));
    let alive = true;
    getArtUrl(game, face)
      .then((u) => alive && setLoaded({ key, url: u }))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [game, face, near, key, own, thumb]);

  return (
    <div
      ref={box}
      className={`relative overflow-hidden ${rounded} ${className}`}
      style={{ aspectRatio: String(aspect) }}
    >
      {/* le reflet de chargement ne s'anime qu'à l'approche de l'écran : loin de là (ou plus loin
          dans une rangée), une jaquette en attente garde le même fond, immobile */}
      {!url && !failed && <div className={near && !thumb ? "ibox-shimmer absolute inset-0" : "absolute inset-0 bg-[var(--accent-soft)]"} />}
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
