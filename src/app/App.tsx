import { attachAutoJingles } from "@/services/jingles";
import { PerfOverlay } from "@/components/extras/PerfOverlay";
import { attachPower } from "@/services/power";
import { attachMenuMusic, useMenuMusic } from "@/services/menuMusic";
import { attachSocial } from "@/services/social";
import { attachRemotePlayOnline } from "@/services/remotePlayOnline";
import { RemotePlayLayer } from "@/components/remoteplay/RemotePlayOnline";
import { lazy, Suspense, useEffect } from "react";
import { ErrorBoundary, ScreenFallback } from "@/components/shell/ErrorBoundary";
import { ProfileGate } from "@/components/start/ProfileGate";
import { SetupWizard } from "@/components/start/SetupWizard";
import { useSession } from "@/services/profiles";
import { shellApi } from "@/services/shell";
import { startUpdateWatch } from "@/services/updater";
import { startRaWatch } from "@/services/retro";
import { DuplicatesHost } from "@/components/game/Versions";
import { PlayerJoinedOverlay } from "@/components/shell/Players";
import { attachInetbox } from "@/services/inetbox";
import { InetboxModal } from "@/components/social/InetboxPanel";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { EASE, SPRING, TWEEN } from "@/motion/tokens";
import { rememberedFocus, routeKey, useNav, useRoute, type Route } from "./navigation";
import { clearAmbientGame, useIsDark, useReducedMotion, useShell } from "./shellState";
import { useSettings } from "@/services/settings";
import { setFullscreen, syncWindowTheme } from "@/services/native";
import { music, MENU_TRACK } from "@/services/music";
import { input } from "@/input/InputController";
import { attachGamepads } from "@/input/gamepad";
import { FlightLayer, preload3D } from "@/three/lazy";
import { useLibrary } from "@/services/library";
import { scheduleManualFetch } from "@/services/manuals";
import { useLauncher } from "@/services/launcher";
import { usePlatformArtStore } from "@/services/platformArt";
import { applyAppTheme } from "@/theme/appThemes";
import { Backdrop } from "@/components/shell/Backdrop";
import { TopBar } from "@/components/shell/TopBar";
import { HintBar } from "@/components/shell/HintBar";
import { CommandsHost } from "@/components/shell/QuickMenu";
import { PlayerSheetHost } from "@/components/social/PlayerProfile";
import { BackgroundJobs } from "@/components/library/MetaStatus";
import { LaunchOverlay } from "@/components/library/LaunchOverlay";
import { HomeScreen } from "@/screens/HomeScreen";
import { useEmulators } from "@/services/emulators";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { GameScreen } from "@/screens/GameScreen";
import { SmartConfigFeedback } from "@/components/smartconfig/SmartConfigFeedback";
import { captures } from "@/services/community";
import { applyShortcuts, DEFAULT_KEYS } from "@/services/shortcuts";
import { isTauri } from "@/services/native";
import { invoke } from "@tauri-apps/api/core";
import { isLinux, usePlatform } from "@/services/platform";

// Écrans secondaires chargés à la demande (préchargés pendant un temps mort, voir
// `preloadScreens`) : le démarrage ne lit que l'accueil, la bibliothèque et la fiche.
const loadSettings = () => import("@/screens/SettingsScreen");
const loadCommunity = () => import("@/screens/CommunityScreen");
const loadSmartConfig = () => import("@/screens/SmartConfigScreen");
const loadPlatforms = () => import("@/screens/PlatformsScreen");
const loadPlatformSheet = () => import("@/screens/PlatformSheet");
const loadAchievements = () => import("@/screens/AchievementsScreen");
const SettingsScreen = lazy(() => loadSettings().then((m) => ({ default: m.SettingsScreen })));
const CommunityScreen = lazy(() => loadCommunity().then((m) => ({ default: m.CommunityScreen })));
const SmartConfigScreen = lazy(() => loadSmartConfig().then((m) => ({ default: m.SmartConfigScreen })));
const PlatformsScreen = lazy(() => loadPlatforms().then((m) => ({ default: m.PlatformsScreen })));
const PlatformSheet = lazy(() => loadPlatformSheet().then((m) => ({ default: m.PlatformSheet })));
const AchievementsScreen = lazy(() => loadAchievements().then((m) => ({ default: m.AchievementsScreen })));
// Linux (Steam Deck) : notifications dans la fenêtre principale, pas dans une fenêtre à part
const NativeGuestBench = lazy(() => import("@/components/remoteplay/NativeGuestBench").then((m) => ({ default: m.NativeGuestBench })));
const InlineToasts = lazy(() => import("@/components/social/ToastWindow").then((m) => ({ default: () => <m.ToastWindow inline /> })));

function preloadScreens(): void {
  const run = () => void Promise.all([loadSettings(), loadPlatforms(), loadPlatformSheet(), loadAchievements(), loadCommunity(), loadSmartConfig()]).catch(() => undefined);
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 2000);
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <HomeScreen />;
    case "platforms":
      return <PlatformsScreen />;
    case "platform":
      return <PlatformSheet platformId={route.platformId} />;
    case "library":
      return <LibraryScreen platformId={route.platformId} shelfGameId={route.shelfGameId} />;
    case "game":
      return <GameScreen gameId={route.gameId} />;
    case "settings":
      return <SettingsScreen category={route.category} />;
    case "achievements":
      return <AchievementsScreen gameId={route.gameId} />;
    case "community":
      return <CommunityScreen />;
    case "smartconfig":
      return <SmartConfigScreen tab={route.tab} />;
  }
}

/** Place le focus une fois l'écran réellement affiché (après son chargement éventuel). */
function FocusOnShow({ route }: { route: Route }) {
  useEffect(() => {
    const id = requestAnimationFrame(() => input.focusInitial(rememberedFocus(route)));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/**
 * Monte un écran et place le focus (élément mémorisé au retour, sinon focus initial).
 * Une erreur d'affichage reste confinée à l'écran : barre du haut et navigation restent utilisables.
 */
function ScreenHost({ route }: { route: Route }) {
  useEffect(() => () => clearAmbientGame(), []);
  return (
    <ErrorBoundary
      where={`écran ${route.name}`}
      fallback={(retry) => (
        <ScreenFallback onRetry={retry} onHome={route.name === "home" ? undefined : () => useNav.getState().go({ name: "home" })} />
      )}
    >
      <Suspense fallback={null}>
        <Screen route={route} />
        <FocusOnShow route={route} />
      </Suspense>
    </ErrorBoundary>
  );
}

// Transitions d'écran : une seule idée de profondeur. Avancer, c'est entrer dans l'écran
// suivant (il arrive de la droite, légèrement en retrait, et se pose) ; revenir, c'est
// reculer (l'écran précédent revient de la gauche, à peine agrandi). La sortie est très
// brève pour que la navigation rapide reste immédiate ; l'entrée est un ressort, donc une
// nouvelle navigation l'interrompt sans à-coup. Uniquement opacité et transformations
// (calculées par la carte graphique) : pas de flou plein écran.
const screenVariants = {
  enter: (dir: number) => (dir < 0 ? { opacity: 0, x: -18, scale: 1.012 } : { opacity: 0, x: 30, scale: 0.988 }),
  center: { opacity: 1, x: 0, scale: 1, transition: { ...SPRING.smooth, opacity: TWEEN.fast } },
  exit: (dir: number) => ({
    opacity: 0,
    x: dir < 0 ? 12 : -16,
    scale: dir < 0 ? 0.992 : 1.006,
    transition: { duration: dir < 0 ? 0.09 : 0.12, ease: EASE.in },
  }),
};

export function App() {
  const singleWindow = usePlatform((p) => p.os === "linux");
  useEffect(() => attachInetbox(), []);
  useEffect(() => attachSocial(), []);
  useEffect(() => attachRemotePlayOnline(), []);
  useEffect(() => attachAutoJingles(), []);
  // manuels : chaque boîte reçoit le sien, en arrière-plan
  useEffect(() => scheduleManualFetch(() => useLibrary.getState().realGames.length, (cb) => useLibrary.subscribe(cb)), []);

  // Démarrage : première configuration, puis « Qui joue ? »
  const setupDone = useSettings((s) => s.setupDone);
  const askProfile = useSettings((s) => s.askProfileOnStart);
  const profileChosen = useSession((s) => s.chosen);
  const gateForced = useSession((s) => s.forced);

  // iBox dans Windows : arrière-plan et fenêtre masquée pendant le jeu
  const keepInTray = useSettings((s) => s.keepInTray);
  const hideOnLaunch = useSettings((s) => s.hideOnLaunch);
  useEffect(() => void shellApi.setBehavior(keepInTray, hideOnLaunch), [keepInTray, hideOnLaunch]);
  // Démarrage avec Windows : iBox attend en silence tant que sa fenêtre est cachée,
  // et il est activé par défaut une seule fois (le choix reste ensuite dans Paramètres)
  useEffect(() => {
    let off: () => void = () => undefined;
    let alive = true;
    void shellApi.visible().then((v) => music.setBackground(v === false), () => undefined);
    void shellApi.onVisibility((v) => music.setBackground(!v)).then((f) => (alive ? (off = f) : f()));
    // Linux (Steam Deck) : jamais de démarrage automatique (il lancerait iBox à chaque Mode Bureau)
    if (!import.meta.env.DEV && !isLinux() && !useSettings.getState().autostartOffered) {
      void shellApi.autostartSet(true).then(() => useSettings.getState().set("autostartOffered", true), () => undefined);
    }
    return () => {
      alive = false;
      off();
    };
  }, []);
  // nouvelle version d'iBox : annoncée par une notification (installation dans Paramètres › Système)
  useEffect(() => startUpdateWatch(), []);
  // batterie et sortie de veille (Steam Deck) : veilles espacées, reprise au réveil
  useEffect(() => attachPower(), []);
  // succès RetroAchievements débloqués pendant une partie : annoncés en direct
  useEffect(() => startRaWatch(
    () => useLauncher.getState().phase === "running",
    (fn) => useLauncher.subscribe((s, p) => { if ((s.phase === "running") !== (p.phase === "running")) fn(s.phase === "running"); }),
  ), []);
  // overlay en jeu (Alt+X par défaut) : réglages des clips et du raccourci, ouverture de la Communauté
  const captureClips = useSettings((s) => s.captureClips !== false);
  const captureHotkey = useSettings((s) => s.captureHotkey !== false);
  const clipQuality = useSettings((s) => s.clipQuality ?? "medium");
  const clipSeconds = useSettings((s) => s.clipSeconds ?? 15);
  const clipSystemAudio = useSettings((s) => s.clipSystemAudio !== false);
  const clipMicrophone = useSettings((s) => s.clipMicrophone === true);
  useEffect(
    () => void captures.settings(captureClips, captureHotkey, { quality: clipQuality, seconds: clipSeconds, systemAudio: clipSystemAudio, microphone: clipMicrophone }).catch(() => undefined),
    [captureClips, captureHotkey, clipQuality, clipSeconds, clipSystemAudio, clipMicrophone],
  );
  // raccourcis globaux : overlay de capture et Music in the Box (Paramètres › Système, › Plugins)
  const captureKeys = useSettings((s) => s.captureKeys ?? DEFAULT_KEYS.capture);
  const musicKeys = useSettings((s) => s.musicKeys ?? DEFAULT_KEYS.music);
  useEffect(() => void applyShortcuts(captureKeys, musicKeys), [captureKeys, musicKeys]);
  // écran où le lecteur Music in the Box s’ouvre (le dernier où il a été posé)
  const musicMonitor = useSettings((s) => s.musicMonitor ?? null);
  useEffect(() => {
    if (isTauri()) void invoke("music_set_monitor", { name: musicMonitor }).catch(() => undefined);
  }, [musicMonitor]);
  useEffect(() => {
    if (!isTauri()) return;
    const off = import("@tauri-apps/api/event").then(({ listen }) => listen("open-community", () => useNav.getState().go({ name: "community" })));
    return () => void off.then((f) => f());
  }, []);
  // menu de l'icône de notification : Jeux ou Social
  useEffect(() => {
    const off = shellApi.onTrayNavigate((place) => {
      if (place === "games") useNav.getState().go({ name: "library", platformId: "all" });
      else if (place === "social") window.dispatchEvent(new Event("ibox:open-friends"));
    });
    return () => void off.then((f) => f());
  }, []);
  const libraryError = useLibrary((s) => s.status === "error" ? s.error : undefined);

  const route = useRoute();
  const direction = useNav((s) => s.direction);
  const reduced = useReducedMotion();
  const load = useLibrary((s) => s.load);

  useEffect(() => {
    void load();
    void useLauncher.getState().load();
    void usePlatformArtStore.getState().refresh();
    const off = useLauncher.getState().attach();
    const offEmu = useEmulators.getState().attach();
    return () => {
      void off.then((f) => f());
      void offEmu.then((f) => f());
    };
  }, [load]);

  // Entrées : clavier, manettes + bouton « précédent » de la souris
  useEffect(() => {
    const detach = input.attachKeyboard();
    const detachPads = attachGamepads();
    preload3D();
    preloadScreens();
    // tableau des succès préchargé : l'écran Succès s'ouvre déjà rempli
    const warm = window.setTimeout(() => void import("@/services/achievementsCache").then((m) => m.prefetchAchievements()), 8000);
    const offBack = input.onBack(() => useNav.getState().back());
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        input.dispatch("back");
      }
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("mouseup", onMouse);
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.clearTimeout(warm);
      detach();
      detachPads();
      offBack();
      window.removeEventListener("mouseup", onMouse);
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  // Musique en boucle : piste de la console affichée si elle en a une, sinon musique de menu
  const custom = useMenuMusic((s) => s.url);
  const ambientTrack = useShell((s) => s.ambientPlatform?.ambience) ?? custom ?? MENU_TRACK;
  useEffect(() => music.attach(), []);
  useEffect(() => attachMenuMusic(), []);
  useEffect(() => music.play(ambientTrack), [ambientTrack]);

  // Thème : color-scheme pilote toutes les couleurs light-dark() des tokens
  const theme = useSettings((s) => s.theme);
  const dark = useIsDark();
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    void syncWindowTheme(theme);
  }, [dark, theme]);

  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? "reduced" : "full";
  }, [reduced]);

  const animatedBg = useSettings((s) => s.animatedBackground !== false);
  useEffect(() => {
    document.documentElement.dataset.bg = animatedBg ? "live" : "still";
  }, [animatedBg]);

  // Palette et taille de l'interface (Paramètres › Apparence, Thèmes)
  const appTheme = useSettings((s) => s.appTheme ?? "ibox");
  const uiScale = useSettings((s) => s.uiScale ?? 1);
  useEffect(() => applyAppTheme(appTheme), [appTheme]);
  useEffect(() => document.documentElement.style.setProperty("--ui-scale", String(uiScale)), [uiScale]);

  // Plein écran : appliqué au démarrage et à chaque changement ; F11 bascule
  const fullscreen = useSettings((s) => s.fullscreen);
  // aperçu Steam Deck sur PC : fenêtre 1280×800, jamais plein écran
  const preview = usePlatform((p) => p.preview);
  useEffect(() => void (preview ? undefined : setFullscreen(fullscreen)), [fullscreen, preview]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F11") return;
      e.preventDefault();
      const { fullscreen: on, set } = useSettings.getState();
      set("fullscreen", !on);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <MotionConfig reducedMotion={reduced ? "always" : "never"}>
      <Backdrop home={route.name === "home"} />
      {/* arrivée dans iBox : le décor d'abord, puis l'interface qui monte se poser */}
      <motion.div
        data-nav-root
        data-nav-main
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING.gentle, delay: 0.12, opacity: { ...TWEEN.slow, delay: 0.12 } }}
        className="relative flex h-full flex-col"
      >
        <TopBar />
        {libraryError && route.name !== "settings" && (
          <div role="alert" className="mx-8 mb-2 flex items-center justify-between gap-4 rounded-lg bg-peach-soft p-3 text-ink">
            <div className="min-w-0">
              <p className="font-bold">La bibliothèque n’a pas pu être chargée.</p>
              <p className="max-h-20 overflow-auto text-sm">{libraryError}</p>
            </div>
            <button data-focusable className="ibox-focusable shrink-0 rounded-lg bg-white px-4 py-2 font-bold"
              onClick={() => useNav.getState().go({ name: "settings" })}>Paramètres</button>
          </div>
        )}
        <main className="relative min-h-0 flex-1">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={routeKey(route)}
              custom={direction}
              variants={screenVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="absolute inset-0"
            >
              <ScreenHost route={route} />
            </motion.div>
          </AnimatePresence>
        </main>
        <HintBar />
      </motion.div>
      <BackgroundJobs />
      <AnimatePresence>
        {!setupDone ? <SetupWizard key="setup" /> : (askProfile || gateForced) && !profileChosen ? <ProfileGate key="gate" /> : null}
      </AnimatePresence>
      <InetboxModal />
      <DuplicatesHost />
      <CommandsHost />
      <PlayerSheetHost />
      <PlayerJoinedOverlay />
      <LaunchOverlay />
      <SmartConfigFeedback />
      <RemotePlayLayer />
      <FlightLayer />
      <PerfOverlay />
      {singleWindow && (
        <Suspense fallback={null}>
          <InlineToasts />
        </Suspense>
      )}
      {preview && (
        <Suspense fallback={null}>
          <NativeGuestBench />
        </Suspense>
      )}
    </MotionConfig>
  );
}
