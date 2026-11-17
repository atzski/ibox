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
import { useCommands } from "@/input/commands";
import { relativeDay } from "@/domain/text";
import { themeVars } from "@/theme/platformTheme";
import { useLauncher } from "@/services/launcher";
import { usePlayState } from "@/components/library/PlayControls";
import { CoverImage } from "@/components/game/CoverImage";
import { getArtUrl } from "@/art/covers";
import { useMediaUrl } from "@/art/useMediaUrl";
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
  const search = useCommands((s) => s.search);
  const setSearch = useCommands((s) => s.setSearch);
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
          { keys: ["X"], label: "Jouer" },
          { keys: ["F"], label: "Favori" },
          { keys: ["/"], label: "Recherche" },
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
          <div className={`grid gap-6 px-[3rem] ${hero ? "grid-cols-[minmax(0,1fr)_19rem]" : "grid-cols-1"}`}>
            {/* à gauche, en grand : la collection sur son étagère 3D ; à droite, en petit, la dernière
                aventure (ou le dernier ajout). Premier lancement : le dossier se choisit dans les Paramètres */}
            <CollectionShowcase games={games} onOpen={() => go({ name: "library", platformId: "all" })} />
            {hero && <LastAdventureTile game={hero} label={last || welcome || hero.isDemo ? "Votre dernière aventure" : "Dernier ajout à la collection"} />}
          </div>
        );
      case "consoles":
        return (
          <ShelfRow
            title="Consoles"
            group="home-platforms"
          >
            <motion.div variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }} className="shrink-0">
              <button
                data-focusable
                data-focus-id="all-platforms"
                onClick={() => {
                  sound.play("select");
                  go({ name: "platforms" });
                }}
                // verre dépoli aux couleurs du thème : dégradé qui glisse lentement, reflet et icône en relief
                className="ibox-focusable ibox-lift ibox-platforms-tile group relative isolate flex h-[11rem] w-[11rem] flex-col items-center justify-center gap-3 overflow-hidden rounded-lg text-[#ffffff] [--ring-radius:var(--radius-lg)]"
              >
                <span aria-hidden className="ibox-platforms-glow absolute inset-0 -z-10" />
                <span aria-hidden className="absolute -top-8 -right-8 -z-10 size-28 rounded-full bg-[#ffffff33] blur-xl transition-transform duration-500 group-hover:scale-125" />
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#ffffffcc] text-[var(--theme-deep)] shadow-[inset_0_-3px_0_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_-8px_color-mix(in_srgb,var(--theme-deep)_70%,transparent)] backdrop-blur-sm transition-transform duration-500 ease-[var(--ease-bounce)] group-hover:-rotate-6 group-hover:scale-110">
                  <Icon name="grid" size="1.4em" />
                </span>
                <span className="flex flex-col items-center leading-tight drop-shadow-[0_2px_6px_rgba(30,20,80,0.35)]">
                  <span className="font-display text-[1.05rem] font-semibold">iBox Platforms</span>
                  <span className="mt-0.5 text-[0.78rem] font-bold text-[#ffffffd9]">Découvrir les consoles</span>
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

/** « Votre dernière aventure », en petite carte : jaquette, titre, reprise en un geste. */
function LastAdventureTile({ game, label }: { game: Game; label: string }) {
  const play = useLauncher((s) => s.play);
  const { reason: playReason } = usePlayState(game);
  const go = useNav((s) => s.go);
  const platform = requirePlatform(game.platformId);
  const reduced = useReducedMotion();
  const hero = useMediaUrl(game, "hero");
  // repli automatique : la jaquette du jeu sert de fond quand il n'a pas de grande illustration
  const [cover, setCover] = useState<string | null>(null);
  useEffect(() => {
    setCover(null);
    let alive = true;
    getArtUrl(game, "front").then((u) => alive && setCover(u)).catch(() => undefined);
    return () => { alive = false; };
  }, [game]);
  const deep =`color-mix(in oklab, ${platform.theme.deep} 82%, #0f1420)`;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      className="ibox-sweep relative isolate flex h-[21rem] flex-col overflow-hidden rounded-xl p-6 text-[#ffffff] shadow-md"
      style={{ ...themeVars(platform), background: deep }}
    >
      {/* fond : illustration du jeu si elle existe, sinon sa jaquette floutée */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        {hero ? (
          <motion.img
            key={hero}
            src={hero}
            alt=""
            draggable={false}
            initial={{ opacity: 0, scale: reduced ? 1 : 1.06 }}
            animate={{ opacity: 0.55, scale: 1 }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            className="ibox-kenburns h-full w-full object-cover object-[center_30%]"
          />
        ) : (
          // pas de grande illustration : la jaquette remplit la case, juste adoucie (reconnaissable)
          <motion.div
            key={game.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.8 }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            className={`absolute inset-[-8%] blur-[5px] saturate-[1.15] ${reduced ? "" : "ibox-kenburns"}`}
          >
            {cover && <img src={cover} alt="" draggable={false} className="h-full w-full object-cover object-[center_25%]" />}
          </motion.div>
        )}
        <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, color-mix(in oklab, ${deep} 35%, transparent) 0%, color-mix(in oklab, ${deep} 92%, transparent) 72%)` }} />
      </div>

      <div className="text-[0.75rem] font-extrabold tracking-[0.16em] text-[#ffffffd9] uppercase">{label}</div>

      <div className="mt-3 flex min-h-0 flex-1 items-end gap-4">
        <motion.div
          animate={reduced ? undefined : { y: [0, -5, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          className="w-[5.6rem] shrink-0 [transform:rotateZ(-2deg)]"
        >
          <CoverImage game={game} className="shadow-lg" rounded="rounded-[0.7rem]" />
        </motion.div>
        <div className="min-w-0 pb-1">
          <h2 className="line-clamp-3 font-display text-[1.25rem] leading-tight font-semibold">{game.title}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[0.75rem] font-bold text-[#ffffffd9]">
            <span className="inline-flex items-center gap-1 rounded-full bg-[#ffffff26] px-2.5 py-0.5 backdrop-blur-sm">
              <PlatformGlyph glyph={platform.glyph} size={14} strokeWidth={3} />
              {platform.shortName}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#ffffff26] px-2.5 py-0.5 backdrop-blur-sm">
              <Icon name="clock" size="1em" />
              {game.lastPlayedAt ? `Joué ${relativeDay(game.lastPlayedAt)}` : `Ajouté ${relativeDay(game.addedAt)}`}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <Button
          variant="primary"
          icon="play"
          autoFocusScreen
          data-focus-id="hero-open"
          disabled={!!playReason}
          badge={game.isDemo ? "Démo" : undefined}
          title={playReason ?? `Lancer ${game.title}`}
          className={`flex-1 ${playReason ? "" : "ibox-beckon"}`}
          onClick={() => void play(game.dbId!, game.title)}
        >
          Reprendre
        </Button>
        <Button icon="open" aria-label="Voir le jeu" title="Voir le jeu" onClick={() => go({ name: "game", gameId: game.id })} />
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

/** Jaquettes par rangée au plus (chaque rangée est dupliquée pour boucler sans couture). */
const MARQUEE_PER_ROW = 18;

/**
 * Toute la bibliothèque répartie sur deux étagères qui défilent lentement en
 * sens alternés. Ordre stable (pas de mélange à chaque rendu), jeux réels
 * d'abord ; une petite collection est répétée pour remplir la rangée.
 */
function useMarqueeRows(games: Game[]): Game[][] {
  return useMemo(() => {
    const real = games.filter((g) => !g.isDemo);
    const pool = (real.length >= 3 ? real : games).slice().sort((a, b) => a.sortTitle.localeCompare(b.sortTitle));
    if (pool.length === 0) return [];
    const rows: Game[][] = [[], []];
    pool.forEach((g, i) => rows[i % 2].push(g));
    return rows.map((row, r) => {
      const base = row.length > 0 ? row : pool;
      const filled: Game[] = [];
      // au moins 8 jaquettes par rangée pour couvrir la largeur
      for (let i = 0; filled.length < Math.max(8, Math.min(base.length, MARQUEE_PER_ROW)); i++) filled.push(base[(i + r * 2) % base.length]);
      return filled;
    });
  }, [games]);
}

type ShelfFx = { row: number; index: number; kind: "spin" | "hop" | "wobble"; token: number };

/**
 * Vie de l'étagère : toutes les 0,9 à 2,3 secondes, une jaquette prise au hasard
 * tourne sur elle-même, saute ou se balance. Rien quand les animations sont
 * réduites ou que la fenêtre est cachée.
 */
function useShelfFx(rows: Game[][], reduced: boolean): ShelfFx | null {
  const [fx, setFx] = useState<ShelfFx | null>(null);
  useEffect(() => {
    if (reduced || rows.length === 0) return;
    let timer = 0;
    let clear = 0;
    let token = 0;
    const kinds: ShelfFx["kind"][] = ["spin", "spin", "hop", "wobble"];
    const next = () => {
      timer = window.setTimeout(() => {
        if (document.visibilityState === "visible") {
          const row = Math.floor(Math.random() * rows.length);
          const index = Math.floor(Math.random() * rows[row].length);
          window.clearTimeout(clear);
          setFx({ row, index, kind: kinds[Math.floor(Math.random() * kinds.length)], token: ++token });
          // effet retiré à la fin : la même jaquette pourra le rejouer plus tard
          clear = window.setTimeout(() => setFx(null), 1300);
        }
        next();
      }, 900 + Math.random() * 1400);
    };
    next();
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clear);
    };
  }, [rows, reduced]);
  return fx;
}

/**
 * Jeu tiré au hasard pour la case « Ma collection » : un nouveau à chaque arrivée sur
 * l'accueil (la case est recréée), parmi les jeux qui ont une grande illustration.
 */
function useRandomHeroGame(games: Game[], active: boolean): Game | null {
  // de préférence un jeu avec une grande illustration ; sinon n'importe lequel (sa jaquette servira)
  const pool = useMemo(() => {
    const real = games.filter((g) => !g.isDemo);
    const heroes = real.filter((g) => (g.media ?? []).some((m) => m.kind === "hero"));
    return heroes.length > 0 ? heroes : real;
  }, [games]);
  const [id, setId] = useState<string | null>(null);
  const ready = pool.length > 0;
  useEffect(() => {
    if (active && ready && !id) setId(pool[Math.floor(Math.random() * pool.length)].id);
    // un tirage par affichage de l'accueil, dès que la bibliothèque est chargée
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ready]);
  return active ? (pool.find((g) => g.id === id) ?? null) : null;
}

function CollectionShowcase({ games, onOpen }: { games: Game[]; onOpen: () => void }) {
  const reduced = useReducedMotion();
  const rows = useMarqueeRows(games);
  // un jeu mis en avant à chaque arrivée sur l'accueil, quel que soit le fond d'écran choisi
  const featured = useRandomHeroGame(games, true);
  const featuredHero = useMediaUrl(featured ?? undefined, "hero");
  // repli : la jaquette, si le jeu n'a pas (ou plus) de grande illustration lisible
  const [featuredCover, setFeaturedCover] = useState<string | null>(null);
  useEffect(() => {
    setFeaturedCover(null);
    if (!featured || (featured.media ?? []).some((m) => m.kind === "hero")) return;
    let alive = true;
    getArtUrl(featured, "front").then((u) => alive && setFeaturedCover(u)).catch(() => undefined);
    return () => { alive = false; };
  }, [featured]);
  const featuredArt = featuredHero ?? featuredCover;
  const shown = useCountUp(games.length, reduced);
  const fx = useShelfFx(rows, reduced);
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
        className="ibox-focusable ibox-lift ibox-bubble ibox-collection-tile group relative isolate flex h-[21rem] w-full overflow-hidden rounded-xl text-left shadow-md [--ring-radius:var(--radius-xl)]"
        style={{ background: "linear-gradient(150deg, var(--ibox-sky-soft) 0%, var(--ibox-lavender-soft) 60%, var(--ibox-peach-soft) 100%)" }}
      >
        {/* visuel du jeu tiré au hasard, derrière l'étagère : net mais adouci, fondu en douceur */}
        <AnimatePresence>
          {featuredArt && (
            <motion.img
              key={featuredArt}
              aria-hidden
              src={featuredArt}
              alt=""
              draggable={false}
              initial={{ opacity: 0, scale: reduced ? 1 : 1.06 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
              className={`pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover object-[center_30%] saturate-[1.1] ${featuredHero ? "blur-[3px]" : "scale-125 blur-[18px]"} ${reduced ? "" : "ibox-kenburns"}`}
            />
          )}
        </AnimatePresence>
        {featuredArt && (
          <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--ibox-white)_18%,transparent),color-mix(in_srgb,var(--ibox-white)_42%,transparent))]" />
        )}
        <span aria-hidden className="ibox-collection-orbits" />

        {/* la bibliothèque rangée sur une étagère 3D vue de biais : les jaquettes, debout sur
            leurs planches, glissent lentement ; reflets et ombres donnent le relief */}
        <div aria-hidden className="ibox-shelf3d pointer-events-none absolute inset-y-0 right-0 left-[24%]">
          <div className="ibox-shelf3d-scene">
            {rows.map((row, r) => (
              <div key={r} className="ibox-shelf3d-row">
                <div className="ibox-shelf3d-viewport">
                  <div
                    className={`flex w-max shrink-0 items-end ${reduced ? "" : "ibox-marquee"}`}
                    data-reverse={r % 2 === 1 || undefined}
                    style={{ ["--marquee-duration" as string]: `${80 + r * 18}s` }}
                  >
                    {/* deux copies identiques : la boucle tombe pile au milieu, sans à-coup */}
                    {[0, 1].map((copy) =>
                      row.map((g, i) => (
                        <div
                          key={`${copy}-${i}`}
                          className={`ibox-shelf3d-item ${fx && fx.row === r && fx.index === i ? `ibox-shelf3d-${fx.kind}` : ""}`}
                        >
                          <div className="ibox-shelf3d-box">
                            <CoverImage game={g} rounded="rounded-[0.35rem]" sheen={false} />
                          </div>
                        </div>
                      )),
                    )}
                  </div>
                </div>
                <div className="ibox-shelf3d-plank" />
              </div>
            ))}
          </div>
        </div>

        {/* lisibilité du texte : voile clair à gauche */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--ibox-white)_88%,transparent)_0%,color-mix(in_srgb,var(--ibox-white)_62%,transparent)_30%,transparent_52%)]" />

        <div className="relative flex h-full w-[15rem] shrink-0 flex-col justify-between p-7">
          <div>
            <div className="text-[0.8rem] font-extrabold tracking-[0.16em] text-lavender-deep uppercase">Ma collection</div>
            <div className="mt-2 font-display text-[3.4rem] leading-none font-semibold text-ink tabular-nums">{shown}</div>
            <div className="mt-1 text-[0.95rem] font-bold text-ink-soft">jeux, toutes consoles</div>
          </div>
          <div className="flex items-center gap-3 font-display text-[1.05rem] font-semibold text-ink">
            Parcourir tout
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white shadow-sm transition-transform group-hover:translate-x-1 group-focus:translate-x-1">
              <Icon name="chevronRight" />
            </span>
          </div>
        </div>
      </button>
    </motion.div>
  );
}
