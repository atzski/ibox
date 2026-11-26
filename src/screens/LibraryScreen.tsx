import { SPRING, TWEEN } from "@/motion/tokens";
import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useLibrary, compareGames, countByPlatform, isFavorite } from "@/services/library";
import { useSettings, type LibraryView, type GridDensity } from "@/services/settings";
import { rememberedFocus, useNav } from "@/app/navigation";
import { useIsDark, useReducedMotion, useScreenActive, useScreenChrome, useShell } from "@/app/shellState";
import { getPlatform, PLATFORMS } from "@/domain/platforms";
import { matchesQuery } from "@/domain/text";
import { themeVars } from "@/theme/platformTheme";
import { input } from "@/input/InputController";
import { CoverGrid, CoverZoomControl } from "@/components/library/CoverGrid";
import { clampZoom, stepZoom } from "@/domain/coverZoom";
import { AddPcGameModal } from "@/components/pc/PcParts";
import { PC_DEMO_GAMES } from "@/domain/pcDemo";
import { isInstalled } from "@/services/pc";
import type { Game } from "@/domain/types";
import { PlatformGlyph } from "@/components/platform/PlatformGlyph";
import { ConsoleHeader } from "@/components/platform/ConsoleHeader";
import { ConsoleHighlights } from "@/components/platform/ConsoleHighlights";
import { Button, Segmented } from "@/components/ui/Button";
import { IconBar, IconBarButton } from "@/components/ui/IconBar";
import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/Section";
import { IsoPendingButton } from "@/components/library/IsoConsoleModal";
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
  // recul de la grille de jaquettes : 0 = affichage d'origine, puis de plus en plus de jeux à l'écran
  const zoom = clampZoom(useSettings((st) => st.coverZoom));
  const stepZoomBy = useCallback((delta: number) => {
    const settings = useSettings.getState();
    const current = clampZoom(settings.coverZoom);
    const next = stepZoom(current, delta);
    if (next === current) return;
    sound.play("tab");
    settings.set("coverZoom", next);
  }, []);
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
    return list.sort(compareGames(sort));
  }, [pool, platformId, onlyFavs, onlyReview, favorites, query, sort, isPc, pcCategory]);
  const [restoreFocus] = useState(() => useNav.getState().direction === -1
    ? rememberedFocus({ name: "library", platformId })
    : undefined);
  // la grille repart du haut seulement si l'utilisateur change de console, de filtre, de recherche
  // ou de tri : une relecture des données (jaquettes trouvées, synchro Steam…) garde sa place
  const gridResetKey = `${platformId}|${isPc ? pcCategory : ""}|${onlyFavs}|${onlyReview}|${query}|${sort}`;
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
            ...(visible.length > 1 ? [{ keys: ["R"], label: "Au hasard" }] : []),
          ]
        : [
            { keys: ["X"], label: "Jouer" },
            { keys: ["F"], label: "Favori" },
            { keys: ["−", "+"], label: "Reculer / avancer" },
          ]),
      { keys: ["Pg↑", "Pg↓"], label: "Défiler vite" },
      { keys: ["Entrée"], label: "Ouvrir" },
      { keys: ["Échap"], label: "Retour" },
    ],
  });

  // Q / E (ou L / R à la manette) : bascule de vue (réenregistrée au retour d'une fiche)
  const screenActive = useScreenActive();
  useEffect(
    () =>
      screenActive
        ? input.onTab(() => {
            if (isPc) return "quiet";
            sound.play("view");
            set("libraryView", view === "grid" ? "shelf" : "grid");
            return "quiet";
          })
        : undefined,
    [view, set, isPc, screenActive],
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
        // pas de flou : sur un en-tête aussi large il se recalcule à chaque image pendant le défilement
        animate={hidden ? { height: 0, opacity: 0, y: -18 } : { height: "auto", opacity: 1, y: 0 }}
        transition={reduced ? { duration: 0 } : SPRING.gentle}
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
          iconOnly
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
          iconOnly
          options={[
            { value: "alpha", label: "A → Z", icon: "sortAlpha" },
            { value: "added", label: "Ajout récent", icon: "clock" },
            { value: "played", label: "Joués récemment", icon: "play" },
          ]}
        />
        {/* actions en icônes seules : leur nom s'affiche au survol ou au focus de la manette */}
        <IconBar>
          {!isPc && <IconBarButton icon="star" label="Favoris" active={onlyFavs} cue="toggle" onClick={() => setOnlyFavs((v) => !v)} tint="var(--tone-yellow-ink)" />}
          {(reviewCount > 0 || onlyReview) && (
            <IconBarButton icon="sparkle" label={`À vérifier (${reviewCount})`} title="Jeux à identifier ou introuvables" active={onlyReview} badge={reviewCount}
              cue="toggle" onClick={() => setOnlyReview((v) => !v)} tint="var(--tone-purple-ink)" />
          )}
          {!isPc && <IsoPendingButton />}
          {native && isPc && (
            <IconBarButton icon="reset" label={pcSyncing ? "Lecture des boutiques…" : "Actualiser"} title="Relit les jeux installés des boutiques activées"
              disabled={pcSyncing} onClick={() => void syncPc()} tint="var(--tone-blue-ink)" />
          )}
          {native && hasFolders && !isPc && (
            <IconBarButton icon="reset" label={scanRunning ? "Actualisation…" : "Actualiser"} disabled={scanRunning} onClick={() => void startScan()} tint="var(--tone-blue-ink)" />
          )}
        </IconBar>
        {effView === "grid" && total > 0 && <CoverZoomControl level={zoom} onStep={stepZoomBy} />}

        {showPills && (
          <IconBar className="ml-auto flex-wrap">
            <IconBarButton icon="grid" label="Toutes les consoles" active={platformId === "all"} cue={null} onClick={() => switchPlatform("all")} />
            {filterPlatforms.map((p) => (
              <IconBarButton
                key={p.id}
                label={p.shortName}
                title={p.name}
                active={platformId === p.id}
                cue={null}
                onClick={() => switchPlatform(p.id)}
                glyph={<span className="grid place-items-center" style={{ color: p.theme.primary }}><PlatformGlyph glyph={p.glyph} size={22} /></span>}
              />
            ))}
          </IconBar>
        )}
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
              <Button variant="primary" icon="folder" autoFocusScreen onClick={() => go({ name: "settings", category: "library" })}>
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
              <CoverGrid
                key={`grid-${platformId}`}
                games={visible}
                cardRem={(platform?.layout.gridCardWidth ?? 11.5) * DENSITY[density]}
                pc={isPc}
                level={zoom}
                onStep={stepZoomBy}
                resetKey={gridResetKey}
                restoreFocus={restoreFocus}
                reduced={reduced}
                onScroll={onGridScroll}
              />
            ) : (
              <motion.div
                key={`shelf-${platformId}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={TWEEN.base}
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
  const screenActive = useScreenActive();
  const active = enabled && hidden && screenActive;

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

  const onGridScroll = (e: UIEvent<HTMLElement>, jump = false) => {
    const top = e.currentTarget.scrollTop;
    onTop(top);
    const m = memo.current;
    const d = top - m.last;
    m.last = top;
    // défilement posé par la grille (changement de recul) : ce n'est pas un geste de lecture,
    // le haut de l'écran ne bouge pas
    if (jump && top >= 24) {
      m.up = m.down = 0;
      return;
    }
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
