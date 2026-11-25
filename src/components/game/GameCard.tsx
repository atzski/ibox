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
import { memo, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

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

// ——— Ce que toute jaquette cliquable fait, grande carte ou petite tuile ———

/** Nom lu par les lecteurs d'écran : titre, favori, états à signaler. */
function cardLabel(game: Game, favorite: boolean): string {
  const flags = [game.missing && "fichier introuvable", game.needsReview && "à vérifier", game.duplicate && "doublon"]
    .filter(Boolean)
    .join(", ");
  return `${game.title}${favorite ? ", favori" : ""}${flags ? `, ${flags}` : ""}`;
}

function openGame(game: Game): void {
  sound.play("select");
  useNav.getState().go({ name: "game", gameId: game.id });
}

/** X (X / □) : jouer tout de suite ; F (Y / △) : favori — sans ouvrir la fiche. */
function cardKeyDown(e: ReactKeyboardEvent<HTMLElement>, game: Game, favorite: boolean): void {
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
}

/** Jaquette adoucie : fichier introuvable, ou jeu PC possédé mais non installé. */
function fadedClass(game: Game): string {
  if (game.missing) return "opacity-50 grayscale";
  return game.platformId === "pc" && !game.isDemo && !isInstalled(game) ? "opacity-80 saturate-[0.55]" : "";
}

/**
 * Carte de jeu : la jaquette est l'élément principal, le titre reste discret.
 * Mémorisée : dans une grande grille, faire défiler ne redessine pas les cartes déjà là.
 *
 * `compact` : premier niveau de recul de la bibliothèque, où la carte rétrécit et ne garde
 * que son titre. Plus loin, la grille passe à `CoverTile`.
 */
export const GameCard = memo(function GameCard({
  game,
  width,
  showMeta = true,
  autoFocus,
  compact = false,
  thumb = 0,
  enter = true,
}: {
  game: Game;
  width?: string;
  showMeta?: boolean;
  autoFocus?: boolean;
  compact?: boolean;
  /** Largeur (px) de la vignette à charger ; 0 : jaquette complète. */
  thumb?: number;
  /** Joue l'animation d'entrée (une carte qui apparaît en faisant défiler ne la joue pas). */
  enter?: boolean;
}) {
  const favorite = useIsFavorite(game);
  const faded = fadedClass(game);
  // l'arrondi rétrécit avec la jaquette
  const round = compact ? "rounded-[0.9rem]" : "rounded-md";

  return (
    <motion.div variants={cardEnter} initial={enter ? undefined : false} style={width ? { width } : undefined} className="shrink-0">
      <button
        data-focusable
        data-focus-id={`game:${game.id}`}
        data-autofocus={autoFocus || undefined}
        aria-label={cardLabel(game, favorite)}
        onClick={() => openGame(game)}
        onKeyDown={(e) => cardKeyDown(e, game, favorite)}
        // l'arrière-plan suit le jeu sélectionné (manette, clavier ou souris)
        onFocus={() => focusAmbientGame(game)}
        onPointerEnter={() => focusAmbientGame(game)}
        onPointerMove={tilt}
        onPointerLeave={untilt}
        className={`ibox-focusable ibox-lift group block w-full text-left shadow-md ${round} ${compact ? "[--ring-radius:0.9rem]" : "[--ring-radius:var(--radius-md)]"}`}
      >
        <div className={`ibox-tilt ibox-shine ibox-bubble relative ${round}`}>
          <CoverImage game={game} thumb={thumb} rounded={round} className={faded} />
          <ConsoleFrame platformId={game.platformId} />
        </div>
        {favorite && (
          <span
            className={`absolute grid place-items-center rounded-full bg-white/90 text-[#E8A23A] shadow-sm ${
              compact ? "top-1.5 right-1.5 h-6 w-6 text-[0.8rem]" : "top-2 right-2 h-8 w-8"
            }`}
          >
            <Icon name="star" filled size="1.05em" />
          </span>
        )}
        <span className={`absolute flex flex-wrap gap-1 ${compact ? "bottom-1.5 left-1.5" : "bottom-2 left-2"}`}>
          {game.isDemo && <Badge>Démo</Badge>}
          {game.missing && <Badge tone="warn">Introuvable</Badge>}
          {game.needsReview && !game.missing && <Badge tone="accent">À vérifier</Badge>}
          {game.duplicate && <Badge>Doublon</Badge>}
          {game.mediaStatus === "ambiguous" && !game.needsReview && !game.missing && <Badge tone="accent">Jaquette ?</Badge>}
        </span>
      </button>
      {showMeta && !compact && (
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
      {showMeta && compact && (
        <div data-no-i18n className="mt-[0.45rem] truncate px-0.5 font-display text-[0.84rem] font-semibold text-ink">{game.title}</div>
      )}
    </motion.div>
  );
});

/**
 * Tuile des niveaux reculés de la bibliothèque : un bouton et sa jaquette, rien d'autre.
 * Des centaines sont à l'écran et des dizaines sont montées à chaque rangée qui défile :
 * pas d'enveloppe, pas d'animation, pas d'abonnement par tuile (la grille lui passe sa
 * place et son état de favori). Les commandes sont celles de `GameCard`.
 *
 * `bare` : la jaquette nue, sans ombre ni repère de favori.
 */
export const CoverTile = memo(function CoverTile({
  game,
  left,
  top,
  width,
  thumb,
  favorite,
  bare,
  autoFocus,
}: {
  game: Game;
  left: number;
  top: number;
  width: number;
  thumb: number;
  favorite: boolean;
  bare: boolean;
  autoFocus?: boolean;
}) {
  const round = bare ? "rounded-[3px]" : "rounded-[0.5rem]";
  return (
    <button
      data-focusable
      data-focus-id={`game:${game.id}`}
      data-autofocus={autoFocus || undefined}
      aria-label={cardLabel(game, favorite)}
      // sans titre sous la jaquette, le survol le donne
      title={game.title}
      onClick={() => openGame(game)}
      onKeyDown={(e) => cardKeyDown(e, game, favorite)}
      onFocus={() => focusAmbientGame(game)}
      onPointerEnter={() => focusAmbientGame(game)}
      style={{ position: "absolute", left, top, width }}
      className={`ibox-focusable ibox-cover-dense block text-left ${round} ${bare ? "[--ring-radius:3px]" : "shadow-xs [--ring-radius:0.5rem]"}`}
    >
      <CoverImage game={game} thumb={thumb} sheen={false} rounded={round} className={fadedClass(game)} />
      {favorite && !bare && (
        <span className="absolute top-1 right-1 grid h-4 w-4 place-items-center rounded-full bg-white/90 text-[0.55rem] text-[#E8A23A] shadow-sm">
          <Icon name="star" filled size="1.05em" />
        </span>
      )}
    </button>
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
