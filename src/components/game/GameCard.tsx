import { SPRING, TWEEN } from "@/motion/tokens";
import { motion } from "motion/react";
import type { Game } from "@/domain/types";
import { CoverImage } from "./CoverImage";
import { Icon } from "@/components/ui/Icon";
import { useIsFavorite, useLibrary } from "@/services/library";
import { useLauncher } from "@/services/launcher";
import { useNav } from "@/app/navigation";
import { sound } from "@/services/sound";
import { focusAmbientGame } from "@/app/shellState";
import { PcCardMeta } from "@/components/pc/PcParts";
import { usePlatformArt } from "@/services/platformArt";
import { useSettings } from "@/services/settings";
import { isInstalled } from "@/services/pc";
import { memo, type PointerEvent as ReactPointerEvent } from "react";

/** Inclinaison légère vers le pointeur (variables CSS lues par `.ibox-tilt`). */
function tilt(e: ReactPointerEvent<HTMLElement>) {
  const el = e.currentTarget.querySelector<HTMLElement>(".ibox-tilt");
  if (!el) return;
  const r = e.currentTarget.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  el.style.setProperty("--tilt-y", `${x * 10}deg`);
  el.style.setProperty("--tilt-x", `${-y * 8}deg`);
}

function untilt(e: ReactPointerEvent<HTMLElement>) {
  const el = e.currentTarget.querySelector<HTMLElement>(".ibox-tilt");
  el?.style.removeProperty("--tilt-x");
  el?.style.removeProperty("--tilt-y");
}

export const cardEnter = {
  hidden: { opacity: 0, y: 14, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { ...SPRING.smooth, opacity: TWEEN.fast } },
} as const;

/**
 * Carte de jeu : la jaquette est l'élément principal, le titre reste discret.
 * Mémorisée : dans une grande grille affichée par lots, ajouter un lot ne redessine
 * pas les cartes déjà là (sinon le coût croît avec le carré du nombre de jeux).
 */
export const GameCard = memo(function GameCard({
  game,
  width,
  showMeta = true,
  autoFocus,
}: {
  game: Game;
  width?: string;
  showMeta?: boolean;
  autoFocus?: boolean;
}) {
  const favorite = useIsFavorite(game);
  // jeu PC possédé mais non installé : jaquette un peu adoucie
  const notInstalled = game.platformId === "pc" && !game.isDemo && !isInstalled(game);
  const flags = [game.missing && "fichier introuvable", game.needsReview && "à vérifier", game.duplicate && "doublon"]
    .filter(Boolean)
    .join(", ");
  const go = useNav((s) => s.go);

  return (
    <motion.div variants={cardEnter} style={width ? { width } : undefined} className="shrink-0">
      <button
        data-focusable
        data-focus-id={`game:${game.id}`}
        data-autofocus={autoFocus || undefined}
        aria-label={`${game.title}${favorite ? ", favori" : ""}${flags ? `, ${flags}` : ""}`}
        onClick={() => {
          sound.play("select");
          go({ name: "game", gameId: game.id });
        }}
        // X (X / □) : jouer tout de suite ; F (Y / △) : favori — sans ouvrir la fiche
        onKeyDown={(e) => {
          const key = e.key.toLowerCase();
          if (key !== "x" && key !== "f") return;
          e.preventDefault();
          if (key === "f") {
            sound.play(favorite ? "unfavorite" : "favorite");
            void useLibrary.getState().toggleFavorite(game);
            return;
          }
          const { phase, play } = useLauncher.getState();
          if (game.dbId === undefined || game.missing || phase === "animating" || phase === "starting" || phase === "running") return sound.play("error");
          sound.play("select");
          void play(game.dbId, game.title);
        }}
        // l'arrière-plan suit le jeu sélectionné (manette, clavier ou souris)
        onFocus={() => focusAmbientGame(game)}
        onPointerEnter={() => focusAmbientGame(game)}
        onPointerMove={tilt}
        onPointerLeave={untilt}
        className="ibox-focusable ibox-lift group block w-full rounded-md text-left shadow-md [--ring-radius:var(--radius-md)]"
      >
        <div className="ibox-tilt ibox-shine ibox-bubble relative rounded-md">
          <CoverImage game={game} className={game.missing ? "opacity-50 grayscale" : notInstalled ? "opacity-80 saturate-[0.55]" : ""} />
          <ConsoleFrame platformId={game.platformId} />
        </div>
        {favorite && (
          <span className="absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-[#E8A23A] shadow-sm">
            <Icon name="star" filled size="1.05em" />
          </span>
        )}
        <span className="absolute bottom-2 left-2 flex flex-wrap gap-1">
          {game.isDemo && <Badge>Démo</Badge>}
          {game.missing && <Badge tone="warn">Introuvable</Badge>}
          {game.needsReview && !game.missing && <Badge tone="accent">À vérifier</Badge>}
          {game.duplicate && <Badge>Doublon</Badge>}
          {game.mediaStatus === "ambiguous" && !game.needsReview && !game.missing && <Badge tone="accent">Jaquette ?</Badge>}
        </span>
      </button>
      {showMeta && (
        <div className="mt-3 px-1">
          <div data-no-i18n className="truncate font-display text-[1rem] font-semibold text-ink">{game.title}</div>
          {game.platformId === "pc" ? (
            <PcCardMeta game={game} />
          ) : (
            <div className="truncate text-[0.82rem] font-semibold text-ink-soft">
              {[game.year, game.genre].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
});

function Badge({ children, tone }: { children: string; tone?: "warn" | "accent" }) {
  const cls =
    tone === "warn"
      ? "bg-[#B8573A] text-on-accent"
      : tone === "accent"
        ? "bg-[var(--accent-deep)] text-on-accent"
        : "bg-white/85 text-ink-soft";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[0.62rem] font-extrabold tracking-wider uppercase shadow-xs ${cls}`}>
      {children}
    </span>
  );
}

/**
 * Cadre de console iiDB posé sur la jaquette (option, désactivée par défaut).
 * Découpe en 9 parties (`border-image`) : le coin portant l'emblème garde ses
 * proportions, seuls les bords s'étirent ; l'intérieur reste vide.
 */
function ConsoleFrame({ platformId }: { platformId: string }) {
  const on = useSettings((s) => s.consoleFrames === true);
  const frame = usePlatformArt(on ? platformId : "", "platform_border");
  if (!on || !frame) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ borderStyle: "solid", borderWidth: 0, borderImage: `url(${frame}) 18% / 1.9rem / 0 stretch` }}
    />
  );
}
