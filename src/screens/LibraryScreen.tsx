import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useLibrary, countByPlatform, isFavorite } from "@/services/library";
import { useSettings, type LibraryView, type GridDensity } from "@/services/settings";
import { rememberedFocus, useNav } from "@/app/navigation";
import { useIsDark, useReducedMotion, useScreenChrome, useShell } from "@/app/shellState";
import { getPlatform, PLATFORMS } from "@/domain/platforms";
import { matchesQuery } from "@/domain/text";
import { themeVars } from "@/theme/platformTheme";
import { input } from "@/input/InputController";
import { GameCard } from "@/components/game/GameCard";
import { AddPcGameModal } from "@/components/pc/PcParts";
import { PC_DEMO_GAMES } from "@/domain/pcDemo";
import { isInstalled } from "@/services/pc";
import type { Game } from "@/domain/types";
import { PlatformGlyph } from "@/components/platform/PlatformGlyph";
import { ConsoleHeader } from "@/components/platform/ConsoleHeader";
import { ConsoleHighlights } from "@/components/platform/ConsoleHighlights";
import { Button, Segmented } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/Section";
import { ShelfView } from "@/three/lazy";
import { sound } from "@/services/sound";

/**
 * Bibliothèque : grille de jaquettes (mode A) ou étagère 3D (mode B).
 * Recherche, tri, favoris et filtre console partagent le même état.
 */
export function LibraryScreen({ platformId, shelfGameId }: { platformId: string | "all"; shelfGameId?: string }) {
  const games = useLibrary((s) => s.games);
  const { libraryView: view, librarySort: sort, favorites, set } = useSettings();
  const isPc = platformId === "pc";
  // Chaque console s'ouvre sur l'étagère 3D (« Jaquettes » reste à un clic, ou L / R).
  // Le PC n'a pas de boîtier physique : grande grille de jaquettes.
  useEffect(() => {
    if (!isPc && useNav.getState().direction === 1) useSettings.getState().set("libraryView", "shelf");
  }, [isPc]);
  const [pcCategory, setPcCategory] = useState<PcCategory>("all");
  const density = useSettings((st) => st.gridDensity ?? "standard");
  const [addingPc, setAddingPc] = useState(false);
  const reduced = useReducedMotion();
  const dark = useIsDark();
  const { go, replace } = useNav();
  const [query, setQuery] = useState("");
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [onlyReview, setOnlyReview] = useState(false);
  const native = useLibrary((s) => s.native);
  const hasFolders = useLibrary((s) => s.folders.length > 0);
  const scanRunning = useLibrary((s) => s.scan.running);
  const startScan = useLibrary((s) => s.startScan);
  const syncPc = useLibrary((s) => s.syncPc);
  const pcSyncing = useLibrary((s) => s.pcSync.running);

  const platform = platformId === "all" ? undefined : getPlatform(platformId);
  const counts = useMemo(() => countByPlatform(games), [games]);
  const realPc = useMemo(() => games.filter((g) => g.platformId === "pc" && !g.isDemo), [games]);
  const pcDemo = isPc && realPc.length === 0;
  const pool = isPc ? (pcDemo ? PC_DEMO_GAMES : realPc) : games;

  // Consoles proposées dans le filtre : celles qui ont des jeux + la console courante
  const filterPlatforms = useMemo(
    () => PLATFORMS.filter((p) => (counts.get(p.id) ?? 0) > 0 || p.id === platformId),
    [counts, platformId],
  );

  const visible = useMemo(() => {
    const list = pool.filter(
      (g) =>
        (platformId === "all" || g.platformId === platformId) &&
        (!isPc || inPcCategory(g, pcCategory, favorites)) &&
        (!onlyFavs || isFavorite(g, favorites)) &&
        (!onlyReview || g.needsReview || g.missing || g.mediaStatus === "ambiguous") &&
        matchesQuery(`${g.title} ${g.publisher ?? ""} ${g.genre ?? ""}`, query),
    );
    return list.sort((a, b) =>
      sort === "alpha" ? a.sortTitle.localeCompare(b.sortTitle) : b.addedAt.localeCompare(a.addedAt),
    );
  }, [pool, platformId, onlyFavs, onlyReview, favorites, query, sort, isPc, pcCategory]);
  // grandes bibliothèques : les premières cartes tout de suite, les suivantes par lots
  const [restoreFocus] = useState(() => useNav.getState().direction === -1
    ? rememberedFocus({ name: "library", platformId })
    : undefined);
  const shown = useProgressive(visible, isPc || view === "grid", restoreFocus);
  const reviewCount = useMemo(
    () => games.filter((g) => (platformId === "all" || g.platformId === platformId) && (g.needsReview || g.missing || g.mediaStatus === "ambiguous")).length,
    [games, platformId],
  );

  const total = isPc ? pool.length : platformId === "all" ? games.length : (counts.get(platformId) ?? 0);
  const effView = isPc ? "grid" : view;
  // grille : l'en-tête se compacte et les filtres se replient dès qu'on fait défiler
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => setScrolled(false), [platformId, effView]);
  // lecture immersive : en descendant, tout le haut s'efface (seuls Retour, titre et
  // Accueil restent) ; il revient dès qu'on remonte, qu'on vise le haut ou qu'on y navigue
  const { hidden, onGridScroll } = useImmersiveChrome(effView === "grid", `${platformId}:${effView}`, (top) => {
    if (!scrolled && top > 32) setScrolled(true);
    else if (scrolled && top < 4) setScrolled(false);
  });
  // l'étagère de toute la collection a ses propres onglets de consoles
  const showPills = !(effView === "shelf" && platformId === "all") && !scrolled;

  useScreenChrome({
    title: platform ? platform.name : "Toute la collection",
    platform: platform ?? null,
    hints: [
      ...(isPc ? [] : [{ keys: ["Q", "E"], label: "Changer de vue" }]),
      ...(effView === "shelf"
        ? [
            ...(platformId === "all" ? [{ keys: ["↑", "↓"], label: "Étagère" }] : []),
            { keys: ["F"], label: "Retourner" },
            { keys: ["X"], label: "Jouer" },
          ]
        : []),
      { keys: ["Entrée"], label: "Ouvrir" },
      { keys: ["Échap"], label: "Retour" },
    ],
  });

  // Q / E (ou L / R à la manette) : bascule de vue
  useEffect(
    () =>
      input.onTab(() => {
        if (isPc) return "quiet";
        sound.play("view");
        set("libraryView", view === "grid" ? "shelf" : "grid");
        return "quiet";
      }),
    [view, set, isPc],
  );

  const switchPlatform = (id: string) => {
    if (id === platformId) return;
    sound.play("tab");
    replace({ name: "library", platformId: id });
  };

  return (
    <div className="flex h-full flex-col px-[3rem] pb-3" style={themeVars(platform)}>
      <motion.div
        initial={false}
        animate={hidden ? { height: 0, opacity: 0, y: -18, filter: "blur(6px)" } : { height: "auto", opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 210, damping: 30, mass: 0.9 }}
        inert={hidden}
        className={hidden ? "shrink-0 overflow-hidden" : "shrink-0"}
      >
      {/* En-tête */}
      <ConsoleHeader platform={platform} total={total} compact={effView === "shelf" || scrolled}>
        {!isPc && (
        <Segmented<LibraryView>
          label="Mode d'affichage"
          value={view}
          onChange={(v) => set("libraryView", v)}
          cue="view"
          options={[
            { value: "shelf", label: "Étagère 3D", icon: "shelf" },
            { value: "grid", label: "Jaquettes", icon: "grid" },
          ]}
        />
        )}
        {isPc && native && (
          <Button variant="primary" icon="plus" onClick={() => setAddingPc(true)}>
            Ajouter un jeu PC
          </Button>
        )}
      </ConsoleHeader>

      {/* Barre d'outils */}
      <div className={`${scrolled ? "mt-3" : "mt-4"} flex flex-wrap items-center gap-3 transition-[margin]`} data-nav-group="library-tools">
        <label className="flex h-11 w-[17rem] items-center gap-2 rounded-full bg-white/90 px-4 shadow-xs focus-within:ring-2 focus-within:ring-[var(--accent)]">
          <Icon name="search" className="text-ink-soft" />
          <input
            data-focusable
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un jeu…"
            aria-label="Rechercher un jeu"
            className="w-full bg-transparent text-[0.95rem] font-semibold text-ink outline-none placeholder:text-ink-faint"
          />
        </label>
        <Segmented
          label="Tri"
          value={sort}
          onChange={(v) => set("librarySort", v)}
          options={[
            { value: "alpha", label: "A → Z", icon: "sortAlpha" },
            { value: "added", label: "Ajout récent", icon: "clock" },
          ]}
        />
        {!isPc && (
        <Button
          cue="toggle"
          icon="star"
          aria-pressed={onlyFavs}
          onClick={() => setOnlyFavs((v) => !v)}
          className={onlyFavs ? "!bg-[var(--accent-deep)] !text-on-accent" : "!bg-white/80"}
        >
          Favoris
        </Button>
        )}
        {(reviewCount > 0 || onlyReview) && (
          <Button
            cue="toggle"
            icon="sparkle"
            aria-pressed={onlyReview}
            onClick={() => setOnlyReview((v) => !v)}
            className={onlyReview ? "!bg-[var(--accent-deep)] !text-on-accent" : "!bg-white/80"}
            title="Jeux à identifier ou introuvables"
          >
            À vérifier ({reviewCount})
          </Button>
        )}
        {native && isPc && (
          <Button icon="reset" cue="select" disabled={pcSyncing} onClick={() => void syncPc()} className="!bg-white/80" title="Relit les jeux installés des boutiques activées">
            {pcSyncing ? "Lecture des boutiques…" : "Actualiser"}
          </Button>
        )}
        {native && hasFolders && !isPc && (
          <Button icon="reset" cue="select" disabled={scanRunning} onClick={() => void startScan()} className="!bg-white/80">
            {scanRunning ? "Actualisation…" : "Actualiser"}
          </Button>
        )}

        {showPills && <div className="ml-auto flex flex-wrap items-center gap-2">
          <FilterPill active={platformId === "all"} onClick={() => switchPlatform("all")} label="Toutes" />
          {filterPlatforms.map((p) => (
            <FilterPill
              key={p.id}
              active={platformId === p.id}
              onClick={() => switchPlatform(p.id)}
              label={p.shortName}
              color={p.theme.primary}
            />
          ))}
        </div>}
        {scrolled && filterPlatforms.length > 0 && (
          <button data-focusable onClick={() => setScrolled(false)} className="ibox-focusable ml-auto inline-flex h-9 items-center gap-2 rounded-full bg-white/75 px-3.5 text-[0.85rem] font-bold text-ink-soft [--ring-radius:999px] hover:text-ink">
            <Icon name="grid" size="1em" /> {platform ? platform.shortName : "Toutes les consoles"}
          </button>
        )}
      </div>

      {isPc && (
        <div className="mt-3 flex flex-wrap items-center gap-3" data-nav-group="pc-filters">
          <Segmented<PcCategory>
            label="Catégorie"
            value={pcCategory}
            onChange={setPcCategory}
            options={PC_CATEGORIES.map(([value, label]) => ({ value, label }))}
          />
        </div>
      )}
      {pcDemo && (
        <div role="note" className="mt-3 flex items-center gap-3 rounded-lg bg-[var(--accent-soft)] px-4 py-2.5 text-[0.86rem] font-semibold text-accent-text">
          <Icon name="sparkle" />
          Jeux de démonstration : votre bibliothèque PC est vide.
          {native ? " Ajoutez un jeu avec « Ajouter un jeu PC », ou activez une boutique dans Paramètres › PC." : ""}
        </div>
      )}
      {addingPc && <AddPcGameModal onClose={() => setAddingPc(false)} />}

      {/* Zone secondaire : raccourcis d'une grande bibliothèque (pas pendant une recherche) */}
      {effView !== "shelf" && platform && !query && !pcDemo && total >= 8 && !scrolled && <ConsoleHighlights platform={platform} games={pool} />}
      </motion.div>

      {/* Contenu */}
      <div className={`relative ${scrolled ? "mt-2" : "mt-4"} min-h-0 flex-1`}>
        {total === 0 ? (
          <EmptyState
            icon={platform ? <PlatformGlyph glyph={platform.glyph} size={64} /> : <Icon name="grid" size="3rem" />}
            title={`Aucun jeu ${platform?.shortName ?? ""} pour l'instant`}
            body={
              native
                ? "Ajoutez le dossier qui contient ces jeux dans les paramètres, ou associez un dossier existant à cette console."
                : "La gestion des dossiers est disponible dans l'application Windows. Les jeux de démonstration se trouvent dans la bibliothèque GameCube."
            }
          >
            {native ? (
              <Button variant="primary" icon="folder" autoFocusScreen onClick={() => go({ name: "settings" })}>
                Gérer les dossiers
              </Button>
            ) : (
              <Button variant="primary" icon="chevronRight" autoFocusScreen onClick={() => go({ name: "library", platformId: "gamecube" })}>
                Voir la GameCube
              </Button>
            )}
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Icon name="search" size="3rem" />}
            title="Aucun résultat"
            body={onlyFavs || onlyReview ? "Aucun jeu ne correspond à ces filtres." : "Essayez un autre titre, éditeur ou genre."}
          >
            <Button
              icon="reset"
              autoFocusScreen
              onClick={() => {
                setQuery("");
                setOnlyFavs(false);
                setOnlyReview(false);
              }}
            >
              Réinitialiser les filtres
            </Button>
          </EmptyState>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {effView === "grid" ? (
              <motion.div
                key={`grid-${platformId}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22 }}
                data-cover-scroll-root
                onScroll={onGridScroll}
                className="absolute inset-0 overflow-y-auto"
              >
                <motion.div
                  data-nav-group="library-grid"
                  initial="hidden"
                  animate="show"
                  variants={{ show: { transition: { staggerChildren: 0 } } }}
                  className="grid gap-x-6 gap-y-7 px-3 pt-5 pb-8"
                  style={{
                    gridTemplateColumns: `repeat(auto-fill, minmax(${((platform?.layout.gridCardWidth ?? 11.5) * DENSITY[density]).toFixed(2)}rem, 1fr))`,
                  }}
                >
                  {shown.map((g, i) => (
                    <GameCard key={g.id} game={g} autoFocus={i === 0} />
                  ))}
                </motion.div>
              </motion.div>
            ) : (
              <motion.div
                key={`shelf-${platformId}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="absolute inset-0 overflow-hidden rounded-xl shadow-sm"
              >
                <ShelfView key={query.trim() ? "search" : "all"} games={visible} mixed={!!query.trim()} returnGameId={shelfGameId} reduced={reduced} dark={dark} onOpen={(g) => go({ name: "game", gameId: g.id }, g.id)} />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

/**
 * Haut d'écran escamotable de la grille : se replie après un vrai mouvement vers le
 * bas, revient après un vrai mouvement vers le haut (pas au moindre tressaillement),
 * quand la souris s'attarde en haut de l'écran, ou quand le focus quitte la grille.
 */
function useImmersiveChrome(enabled: boolean, resetKey: string, onTop: (top: number) => void) {
  const [hidden, setHidden] = useState(false);
  const memo = useRef({ last: 0, up: 0, down: 0 });
  const setShell = useShell((s) => s.set);
  const active = enabled && hidden;

  useEffect(() => {
    memo.current = { last: 0, up: 0, down: 0 };
    setHidden(false);
  }, [resetKey]);
  useEffect(() => setShell({ immersive: active }), [active, setShell]);
  useEffect(() => () => setShell({ immersive: false }), [setShell]);

  useEffect(() => {
    if (!active) return;
    const reveal = () => {
      memo.current.up = 0;
      memo.current.down = 0;
      setHidden(false);
    };
    let timer: number | undefined;
    const onMove = (e: PointerEvent) => {
      // la souris qui s'attarde tout en haut fait revenir les boutons
      if (e.clientY < 72) timer ??= window.setTimeout(reveal, 220);
      else if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };
    const onFocus = (e: FocusEvent) => {
      if (!(e.target as Element | null)?.closest?.("[data-cover-scroll-root]")) reveal();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("focusin", onFocus);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active]);

  const onGridScroll = (e: UIEvent<HTMLElement>) => {
    const top = e.currentTarget.scrollTop;
    onTop(top);
    const m = memo.current;
    const d = top - m.last;
    m.last = top;
    if (top < 24) {
      m.up = m.down = 0;
      if (hidden) setHidden(false);
      return;
    }
    if (d > 0) {
      m.down += d;
      m.up = 0;
      if (!hidden && m.down > 56 && top > 140) setHidden(true);
    } else if (d < 0) {
      m.up -= d;
      m.down = 0;
      if (hidden && m.up > 110) setHidden(false);
    }
  };
  return { hidden: active, onGridScroll };
}

function FilterPill({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color?: string }) {
  return (
    <button
      data-focusable
      aria-pressed={active}
      onClick={onClick}
      className={`ibox-focusable inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[0.85rem] font-bold [--ring-radius:999px] ${
        active ? "bg-ink text-cream shadow-sm" : "bg-white/75 text-ink-soft hover:text-ink"
      }`}
    >
      {color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />}
      {label}
    </button>
  );
}

/**
 * Affichage progressif d'une longue liste : un premier lot immédiatement (avec
 * l'animation d'entrée), puis le reste par lots à chaque image, sans bloquer
 * l'écran. Repart du début quand la liste change (filtre, recherche, console).
 */
function useProgressive(list: Game[], enabled: boolean, restoreFocus?: string): Game[] {
  const first = 36;
  const step = 48;
  const [count, setCount] = useState(() => Math.max(first, list.findIndex((game) => `game:${game.id}` === restoreFocus) + 1));
  const [previousList, setPreviousList] = useState(list);
  if (previousList !== list) {
    setPreviousList(list);
    setCount(first);
  }
  useEffect(() => {
    if (!enabled || count >= list.length) return;
    const id = requestAnimationFrame(() => setCount((c) => c + step));
    return () => cancelAnimationFrame(id);
  }, [count, enabled, list.length]);
  return enabled ? (count >= list.length ? list : list.slice(0, count)) : [];
}

/** Taille des jaquettes selon la densité choisie (Paramètres › Apparence). */
const DENSITY: Record<GridDensity, number> = { compact: 0.8, standard: 1, comfortable: 1.25 };

type PcCategory = "all" | "installed" | "notInstalled" | "played" | "added" | "favorites";

const PC_CATEGORIES: [PcCategory, string][] = [
  ["all", "Tous les jeux"],
  ["installed", "Installés"],
  ["notInstalled", "Non installés"],
  ["played", "Récemment joués"],
  ["added", "Récemment ajoutés"],
  ["favorites", "Favoris"],
];

const RECENT_DAYS = 30;

/** Catégories de la bibliothèque PC. */
function inPcCategory(g: Game, cat: PcCategory, favorites: string[]): boolean {
  const recent = (iso?: string) => !!iso && Date.now() - Date.parse(iso) < RECENT_DAYS * 86_400_000;
  switch (cat) {
    case "installed":
      return isInstalled(g);
    case "notInstalled":
      return !isInstalled(g);
    case "played":
      return !!g.lastPlayedAt;
    case "added":
      return recent(g.addedAt);
    case "favorites":
      return isFavorite(g, favorites);
    default:
      return true;
  }
}
