import { HomeBackgroundPicker } from "@/components/home/HomeBackgroundPicker";
import { HomeQuickBar } from "@/components/home/HomeQuickBar";
import { AnimatePresence, motion } from "motion/react";
import { CollectionsRow } from "@/components/extras/CollectionsRow";
import { WhatsNew } from "@/components/extras/WhatsNew";
import { useMemo, useState, useEffect, type ReactNode } from "react";
import { useAttractMode } from "@/app/attract";
import { useLibrary, countByPlatform, isFavorite, lastPlayed, recentlyAdded } from "@/services/library";
import { useSettings } from "@/services/settings";
import { useNav } from "@/app/navigation";
import { useScreenChrome, focusAmbientGame, useReducedMotion } from "@/app/shellState";
import { PLATFORMS, requirePlatform } from "@/domain/platforms";
import type { Game } from "@/domain/types";
import { QuickSearch } from "@/components/extras/QuickSearch";
import { relativeDay } from "@/domain/text";
import { onSurface, themeVars } from "@/theme/platformTheme";
import { useArtPalette } from "@/art/usePalette";
import { formatPlayTime, useLauncher } from "@/services/launcher";
import { usePlayState } from "@/components/library/PlayControls";
import { CoverImage } from "@/components/game/CoverImage";
import { useMediaUrl } from "@/art/useMediaUrl";
import { trimStyle, useImageInfo } from "@/art/imageTone";
import { GameCard } from "@/components/game/GameCard";
import { PlatformCard } from "@/components/platform/PlatformCard";
import { PlatformGlyph } from "@/components/platform/PlatformGlyph";
import { ShelfRow } from "@/components/ui/Section";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { BLOCK_INFO, normalizeBlocks, type HomeBlockId } from "@/services/homeLayout";
import { input } from "@/input/InputController";
import { sound } from "@/services/sound";

export function HomeScreen() {
  const savedBlocks = useSettings((s) => s.homeBlocks);
  const blocks = useMemo(() => normalizeBlocks(savedBlocks), [savedBlocks]);
  const setSetting = useSettings((s) => s.set);
  const games = useLibrary((s) => s.games);
  const native = useLibrary((s) => s.native);
  const folders = useLibrary((s) => s.folders);
  const status = useLibrary((s) => s.status);
  const scanRunning = useLibrary((s) => s.scan.running);
  const startScan = useLibrary((s) => s.startScan);
  const favorites = useSettings((s) => s.favorites);
  const go = useNav((s) => s.go);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState(false);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (editing || search) return;
    const open = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key.toLowerCase() !== "x" ||
          (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) ||
          document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      setSearch(true);
    };
    window.addEventListener("keydown", open);
    return () => window.removeEventListener("keydown", open);
  }, [editing, search]);

  useScreenChrome({
    hints: editing
      ? [
          { keys: ["↑", "↓", "←", "→"], label: "Naviguer" },
          { keys: ["Échap"], label: "Terminer" },
        ]
      : [
          { keys: ["↑", "↓", "←", "→"], label: "Naviguer" },
          { keys: ["Entrée"], label: "Ouvrir" },
          { keys: ["X"], label: "Recherche rapide" },
        ],
  });

  // Retour (Échap, bouton B) : quitte d'abord le mode personnalisation
  useEffect(() => {
    if (!editing) return;
    return input.onBack(() => {
      setEditing(false);
      return true;
    });
  }, [editing]);

  const last = lastPlayed(games);
  const counts = useMemo(() => countByPlatform(games), [games]);
  const platforms = useMemo(
    () => [...PLATFORMS].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0)),
    [counts],
  );
  const recent = recentlyAdded(games);
  // Sans historique de jeu, on met en avant le dernier ajout
  const hero = last ?? recent[0];

  // L'accueil prend les couleurs et le fond du jeu mis en avant ; au repos, vitrine
  const reduced = useReducedMotion();
  const realGames = useMemo(() => games.filter((g) => !g.isDemo), [games]);
  useAttractMode(realGames.length >= 2 ? realGames : games, !reduced && !editing);
  useEffect(() => {
    if (hero) focusAmbientGame(hero);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hero?.id]);
  const welcome = native && status === "ready" && folders.length === 0;
  const favs = games.filter((g) => isFavorite(g, favorites));

  const moveBlock = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    sound.play("move");
    setSetting("homeBlocks", next);
  };
  const toggleBlock = (i: number) => {
    sound.play("toggle");
    setSetting("homeBlocks", blocks.map((b, k) => (k === i ? { ...b, visible: !b.visible } : b)));
  };

  const render = (id: HomeBlockId) => {
    switch (id) {
      case "hero":
        return (
          <div className="grid grid-cols-[minmax(0,1fr)_19rem] gap-6 px-[3rem]">
            {/* premier lancement : la grande carte montre déjà « Votre dernière aventure » ;
                le choix du dossier des jeux se fait dans les Paramètres */}
            {hero ? (
              <HeroCard game={hero} label={last || welcome || hero.isDemo ? "Votre dernière aventure" : "Dernier ajout à la collection"} />
            ) : (
              <div />
            )}
            <CollectionTile games={games} onOpen={() => go({ name: "library", platformId: "all" })} />
          </div>
        );
      case "consoles":
        return (
          <ShelfRow
            title="Consoles"
            group="home-platforms"
            action={<span className="text-[0.85rem] font-bold text-ink-soft">{PLATFORMS.length} plateformes prises en charge</span>}
          >
            <motion.div variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }} className="shrink-0">
              <button
                data-focusable
                data-focus-id="all-platforms"
                onClick={() => {
                  sound.play("select");
                  go({ name: "platforms" });
                }}
                className="ibox-focusable ibox-lift flex h-[11rem] w-[11rem] flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-ink/10 bg-white/60 text-ink-soft [--ring-radius:var(--radius-lg)]"
              >
                <span className="grid h-12 w-12 place-items-center rounded-full bg-white shadow-sm">
                  <Icon name="grid" size="1.4em" />
                </span>
                <span className="flex flex-col items-center leading-tight">
                  <span className="font-display text-[1.05rem] font-semibold">iBox Platforms</span>
                  <span className="mt-0.5 text-[0.78rem] font-bold text-ink-faint">Découvrir les consoles</span>
                </span>
              </button>
            </motion.div>
            {platforms.map((p) => {
              const count = counts.get(p.id) ?? 0;
              const card = <PlatformCard key={p.id} platform={p} count={count} onOpen={() => go({ name: "library", platformId: p.id })} />;
              // consoles sans jeu : en retrait, elles reprennent leurs couleurs au survol
              return count > 0 ? card : (
                <div key={p.id} className="ibox-quiet shrink-0">
                  {card}
                </div>
              );
            })}
          </ShelfRow>
        );
      case "collections":
        return <CollectionsRow />;
      case "recent":
        return (
          <ShelfRow
            title="Ajoutés récemment"
            group="home-recent"
            action={
              native && folders.length > 0 ? (
                <Button icon="reset" disabled={scanRunning} onClick={() => void startScan()}>
                  {scanRunning ? "Actualisation…" : "Actualiser la collection"}
                </Button>
              ) : undefined
            }
          >
            {recent.map((g) => (
              <GameCard key={g.id} game={g} width="10.5rem" />
            ))}
          </ShelfRow>
        );
      case "favorites":
        return (
          <ShelfRow title="Favoris" group="home-favorites">
            {favs.length > 0 ? (
              favs.map((g) => <GameCard key={g.id} game={g} width="10.5rem" />)
            ) : (
              <div className="flex h-40 items-center gap-3 rounded-lg bg-white/60 px-6 text-[0.95rem] font-semibold text-ink-soft">
                <Icon name="star" /> Ajoutez des favoris depuis la fiche d'un jeu : ils apparaîtront ici.
              </div>
            )}
          </ShelfRow>
        );
    }
  };

  return (
    <div className="h-full overflow-y-auto pb-8 [mask-image:linear-gradient(to_bottom,transparent_0,black_1.1rem,black_calc(100%-1.5rem),transparent)]">
      <WhatsNew />
      {search && <QuickSearch games={games} onClose={() => setSearch(false)} onCollection={(id) => {
        setSearch(false);
        setSetting("homeBlocks", blocks.map((block) => block.id === "collections" ? { ...block, visible: true } : block));
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("ibox:open-collection", { detail: id })));
      }} />}
      {!editing && (
        <HomeQuickBar
          onAchievements={() => go({ name: "achievements" })}
          onCommunity={() => go({ name: "community" })}
          onBackground={() => setPicking(true)}
          onSearch={() => setSearch(true)}
        />
      )}
      {picking && <HomeBackgroundPicker onClose={() => setPicking(false)} />}
      <AnimatePresence initial={false}>
        {editing && (
          <motion.div
            key="edit-bar"
            initial={{ opacity: 0, y: -12, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -12, height: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="sticky top-0 z-30 px-[3rem] pt-3"
          >
            <div className="flex items-center gap-4 rounded-2xl bg-[var(--accent-deep)] px-5 py-3 text-on-accent shadow-lg">
              <Icon name="sparkle" size="1.3em" />
              <div className="min-w-0 flex-1">
                <div className="text-[1rem] font-bold">Personnalisation de l'accueil</div>
                <div className="text-[0.82rem] font-semibold opacity-85">Déplacez ou masquez les sections, ajoutez des cases, changez leur taille.</div>
              </div>
              <Button variant="soft" icon="check" onClick={() => setEditing(false)} autoFocusScreen>
                Terminé
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-2 pt-3">
        {blocks.map((b, i) =>
          editing ? (
            <motion.div key={b.id} layout={!reduced} transition={{ type: "spring", stiffness: 300, damping: 30 }}>
              <BlockEditor
                id={b.id}
                visible={b.visible}
                first={i === 0}
                last={i === blocks.length - 1}
                onUp={() => moveBlock(i, -1)}
                onDown={() => moveBlock(i, 1)}
                onToggle={() => toggleBlock(i)}
              >
                {b.visible && render(b.id)}
              </BlockEditor>
            </motion.div>
          ) : (
            b.visible && (
              <motion.div
                key={b.id}
                layout={!reduced}
                initial={{ opacity: 0, y: reduced ? 0 : 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 240, damping: 26, delay: reduced ? 0 : Math.min(i, 5) * 0.05 }}
                className={b.id === "hero" ? "py-3" : ""}
              >
                {render(b.id)}
              </motion.div>
            )
          ),
        )}
      </div>

      {!editing && (
        <div className="mt-6 flex justify-center">
          <Button
            icon="sparkle"
            onClick={() => {
              sound.play("open");
              setEditing(true);
            }}
          >
            Personnaliser l'accueil
          </Button>
        </div>
      )}
    </div>
  );
}


/** Section en mode personnalisation : cadre pointillé, déplacer, masquer. */
function BlockEditor({ id, visible, first, last, onUp, onDown, onToggle, children }: {
  id: HomeBlockId;
  visible: boolean;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onToggle: () => void;
  children: ReactNode;
}) {
  const info = BLOCK_INFO[id];
  return (
    <div className={`mx-[1.5rem] my-1.5 rounded-[1.8rem] border-2 border-dashed px-0 pt-3 pb-3 transition-colors ${visible ? "border-[var(--accent)]/40 bg-white/25" : "border-ink/12 bg-white/15"}`}>
      <div data-nav-group={`edit-${id}`} className="mb-2 flex items-center gap-3 px-[1.5rem]">
        <span className={`text-[0.95rem] font-bold ${visible ? "text-ink" : "text-ink-soft"}`}>{info.label}</span>
        <span className="text-[0.8rem] font-semibold text-ink-soft">{visible ? info.note : "Masquée"}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <EditButton icon="chevronRight" rotate={-90} label={`Monter « ${info.label} »`} disabled={first} onClick={onUp} />
          <EditButton icon="chevronRight" rotate={90} label={`Descendre « ${info.label} »`} disabled={last} onClick={onDown} />
          <button
            data-focusable
            onClick={onToggle}
            className={`ibox-focusable h-9 rounded-full px-4 text-[0.85rem] font-bold [--ring-radius:999px] ${visible ? "bg-white text-ink shadow-xs" : "bg-[var(--accent-deep)] text-on-accent"}`}
          >
            {visible ? "Masquer" : "Afficher"}
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

function EditButton({ icon, label, onClick, disabled, rotate = 0 }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean; rotate?: number }) {
  return (
    <button
      data-focusable
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="ibox-focusable grid size-9 place-items-center rounded-full bg-white text-ink shadow-xs [--ring-radius:999px] disabled:opacity-35"
    >
      <Icon name={icon} size="1.05em" style={{ transform: `rotate(${rotate}deg)` }} />
    </button>
  );
}

function HeroCard({ game, label }: { game: Game; label: string }) {
  const play = useLauncher((s) => s.play);
  const { reason: playReason } = usePlayState(game);
  const go = useNav((s) => s.go);
  const platform = requirePlatform(game.platformId);
  const [, soft, accent] = useArtPalette(game);
  const reduced = useReducedMotion();
  // grande illustration du jeu (bannière) et son logo, quand ils existent
  const hero = useMediaUrl(game, "hero");
  const logo = useMediaUrl(game, "logo");
  const logoInfo = useImageInfo(logo);
  // logo clair sur une illustration : voile « nuit » aux couleurs de la console
  const night = !!hero && logoInfo.tone === "light";
  const deep = `color-mix(in oklab, ${platform.theme.deep} 80%, #0f1420)`;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      className={`ibox-sweep relative isolate flex h-[21rem] items-center gap-10 overflow-hidden rounded-xl px-10 shadow-md ${night ? "text-white" : "bg-white"}`}
      style={{ ...themeVars(platform), background: night ? deep : undefined }}
    >
      {hero ? (
        <>
          {/* illustration recadrée sans déformation, très lent mouvement d'entrée */}
          <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            <motion.img
              key={hero}
              src={hero}
              alt=""
              draggable={false}
              initial={{ opacity: 0, scale: reduced ? 1 : 1.06 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
              className="ibox-kenburns h-full w-full object-cover object-[center_30%]"
            />
          </div>
          <div
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background: night
                ? `linear-gradient(90deg, color-mix(in oklab, ${deep} 94%, transparent) 0%, color-mix(in oklab, ${deep} 76%, transparent) 40%, color-mix(in oklab, ${deep} 10%, transparent) 78%)`
                : `linear-gradient(90deg, color-mix(in oklab, var(--ibox-white) 97%, transparent) 0%, color-mix(in oklab, var(--ibox-white) 84%, transparent) 40%, color-mix(in oklab, var(--ibox-white) 8%, transparent) 78%)`,
            }}
          />
        </>
      ) : (
        <>
          {/* ambiance : jaquette floutée en fond, fondue vers la gauche */}
          <div className="pointer-events-none absolute inset-y-0 right-0 w-[65%] [mask-image:linear-gradient(to_left,black_20%,transparent)]">
            <div className="absolute inset-0 scale-125 opacity-45 blur-3xl">
              <CoverImage game={game} className="h-full w-full" rounded="" sheen={false} />
            </div>
          </div>
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: `linear-gradient(100deg, var(--ibox-white) 30%, ${onSurface(soft, 0.55, 0.22)} 100%)`, opacity: 0.55 }}
          />
        </>
      )}

      <div className="relative shrink-0 [perspective:900px]">
        <motion.div
          animate={{ y: [0, -7, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          className="w-[11.5rem] [transform:rotateY(16deg)_rotateZ(-1.5deg)] [transform-style:preserve-3d]"
        >
          <CoverImage game={game} className="shadow-lg" rounded="rounded-[0.9rem]" />
        </motion.div>
        <div className="mx-auto mt-3 h-3 w-[70%] rounded-full bg-ink/15 blur-md" />
      </div>

      <div className="relative min-w-0 flex-1">
        <div className={`text-[0.8rem] font-extrabold tracking-[0.16em] uppercase ${night ? "text-white/80" : "text-accent-text"}`}>
          {label}
        </div>
        {logo && (hero ? true : logoInfo.tone !== "light") ? (
          <h1 className="mt-3 mb-1">
            <motion.img
              key={logo}
              src={logo}
              alt={game.title}
              draggable={false}
              style={trimStyle(logoInfo)}
              initial={{ opacity: 0, y: reduced ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 200, damping: 24, delay: 0.1 }}
              className={`block max-h-[6.2rem] max-w-[min(32rem,100%)] object-contain object-left ${night ? "drop-shadow-[0_4px_14px_rgba(0,0,0,0.35)]" : "drop-shadow-[0_4px_14px_rgba(255,255,255,0.6)]"}`}
            />
          </h1>
        ) : (
          <h1 className={`mt-2 truncate text-[3rem] leading-[1.05] font-semibold ${night ? "text-white" : "text-ink"}`}>{game.title}</h1>
        )}
        <div className={`mt-3 flex flex-wrap items-center gap-2 text-[0.88rem] font-bold ${night ? "text-white/90" : "text-ink-soft"}`}>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${night ? "bg-white/15 backdrop-blur-sm" : "bg-[var(--accent-soft)] text-accent-text"}`}>
            <PlatformGlyph glyph={platform.glyph} size={18} strokeWidth={3} />
            {platform.shortName}
          </span>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${night ? "bg-white/15 backdrop-blur-sm" : "bg-white/80"}`}>
            <Icon name="clock" size="1.05em" />
            {game.lastPlayedAt ? `Joué ${relativeDay(game.lastPlayedAt)}` : `Ajouté ${relativeDay(game.addedAt)}`}
          </span>
          {(game.playSeconds ?? 0) >= 60 && (
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${night ? "bg-white/15 backdrop-blur-sm" : "bg-white/80"}`}>
              <Icon name="play" size="1em" />
              {formatPlayTime(game.playSeconds!)} de jeu
            </span>
          )}
          {game.genre && <span className={`rounded-full px-3 py-1 ${night ? "bg-white/15 backdrop-blur-sm" : "bg-white/80"}`}>{game.genre}</span>}
          {game.isDemo && (
            <span className="rounded-full px-3 py-1" style={{ background: onSurface(accent, 0.7, 0.3) }}>
              Démo
            </span>
          )}
        </div>
        <div className="mt-7 flex items-center gap-3">
          <Button
            variant="primary"
            size="lg"
            icon="open"
            autoFocusScreen
            data-focus-id="hero-open"
            onClick={() => go({ name: "game", gameId: game.id })}
          >
            Voir le jeu
          </Button>
          <Button
            size="lg"
            icon="play"
            disabled={!!playReason}
            badge={game.isDemo ? "Démo" : undefined}
            title={playReason ?? `Lancer ${game.title}`}
            className={playReason ? "" : "ibox-beckon"}
            onClick={() => void play(game.dbId!, game.title)}
          >
            Reprendre
          </Button>
        </div>
      </div>
    </motion.section>
  );
}

/** Compteur qui monte jusqu'au total à l'arrivée sur l'accueil. */
function useCountUp(target: number, reduced: boolean): number {
  const [value, setValue] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);
  return value;
}

/** Trois jaquettes de la collection, renouvelées doucement toutes les quelques secondes. */
function useRotatingFan(games: Game[], reduced: boolean): Game[] {
  const pool = useMemo(() => {
    const real = games.filter((g) => !g.isDemo);
    return real.length >= 3 ? real : games;
  }, [games]);
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    if (reduced || pool.length <= 3) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setTurn((t) => t + 1);
    }, 5200);
    return () => window.clearInterval(id);
  }, [pool.length, reduced]);
  if (pool.length <= 3) return pool.slice(0, 3);
  // chaque tour avance de 7 jeux : toute la collection finit par défiler
  const third = Math.ceil(pool.length / 3);
  return [0, 1, 2].map((i) => pool[(turn * 7 + i * third) % pool.length]);
}

function CollectionTile({ games, onOpen }: { games: Game[]; onOpen: () => void }) {
  const reduced = useReducedMotion();
  const fan = useRotatingFan(games, reduced);
  const shown = useCountUp(games.length, reduced);
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 26, delay: 0.06 }}
    >
      <button
        data-focusable
        data-focus-id="collection-tile"
        onClick={() => {
          sound.play("select");
          onOpen();
        }}
        className="ibox-focusable ibox-lift ibox-bubble ibox-collection-tile group relative flex h-[21rem] w-full flex-col justify-between overflow-hidden rounded-xl p-7 text-left shadow-md [--ring-radius:var(--radius-xl)]"
        style={{ background: "linear-gradient(150deg, var(--ibox-sky-soft) 0%, var(--ibox-lavender-soft) 60%, var(--ibox-peach-soft) 100%)" }}
      >
        <span aria-hidden className="ibox-collection-orbits" />
        <div className="relative">
          <div className="text-[0.8rem] font-extrabold tracking-[0.16em] text-lavender-deep uppercase">Ma collection</div>
          <div className="mt-2 font-display text-[3.4rem] leading-none font-semibold text-ink tabular-nums">{shown}</div>
          <div className="mt-1 text-[0.95rem] font-bold text-ink-soft">jeux, toutes consoles</div>
        </div>

        <div className="relative mx-auto h-[8.5rem] w-[11rem]">
          {fan.map((g, i) => (
            <div
              key={i}
              className="absolute bottom-0 left-1/2 w-[5.4rem] transition-transform duration-500 ease-[var(--ease-bounce)]"
              style={{
                transform: `translateX(calc(-50% + ${(i - 1) * 3.2}rem)) rotate(${(i - 1) * 9}deg)`,
                zIndex: i === 1 ? 2 : 1,
              }}
            >
              <div className="relative transition-transform duration-500 ease-[var(--ease-bounce)] group-hover:-translate-y-2 group-focus:-translate-y-2">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div
                    key={g.id}
                    initial={{ opacity: 0, y: 26, rotate: -6, scale: 0.92 }}
                    animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -18, rotate: 5, scale: 0.94 }}
                    transition={{ type: "spring", stiffness: 210, damping: 22, delay: i * 0.12 }}
                  >
                    <CoverImage game={g} className="shadow-md" rounded="rounded-[0.6rem]" />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          ))}
        </div>

        <div className="relative flex items-center justify-between font-display text-[1.05rem] font-semibold text-ink">
          Parcourir tout
          <span className="grid h-9 w-9 place-items-center rounded-full bg-white shadow-sm transition-transform group-hover:translate-x-1 group-focus:translate-x-1">
            <Icon name="chevronRight" />
          </span>
        </div>
      </button>
    </motion.div>
  );
}
