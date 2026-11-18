import { attachAutoJingles } from "@/services/jingles";
import { attachMenuMusic, useMenuMusic } from "@/services/menuMusic";
import { attachSocial } from "@/services/social";
import { attachRemotePlayOnline } from "@/services/remotePlayOnline";
import { RemotePlayLayer } from "@/components/remoteplay/RemotePlayOnline";
import { useEffect } from "react";
import { ProfileGate } from "@/components/start/ProfileGate";
import { SetupWizard } from "@/components/start/SetupWizard";
import { useSession } from "@/services/profiles";
import { shellApi } from "@/services/shell";
import { startUpdateWatch } from "@/services/updater";
import { startRaWatch } from "@/services/retro";
import { DuplicatesHost } from "@/components/game/Versions";
import { PlayerJoinedOverlay } from "@/components/shell/Players";
import { AchievementsScreen } from "@/screens/AchievementsScreen";
import { attachInetbox } from "@/services/inetbox";
import { InetboxModal } from "@/components/social/InetboxPanel";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
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
import { PlatformsScreen } from "@/screens/PlatformsScreen";
import { PlatformSheet } from "@/screens/PlatformSheet";
import { useEmulators } from "@/services/emulators";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { GameScreen } from "@/screens/GameScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { CommunityScreen } from "@/screens/CommunityScreen";
import { SmartConfigScreen } from "@/screens/SmartConfigScreen";
import { SmartConfigFeedback } from "@/components/smartconfig/SmartConfigFeedback";
import { captures } from "@/services/community";
import { isTauri } from "@/services/native";

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

/** Monte un écran et place le focus (élément mémorisé au retour, sinon focus initial). */
function ScreenHost({ route }: { route: Route }) {
  useEffect(() => {
    const id = requestAnimationFrame(() => input.focusInitial(rememberedFocus(route)));
    return () => {
      cancelAnimationFrame(id);
      clearAmbientGame();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Screen route={route} />;
}

// Transitions d'écran : sortie très brève, entrée douce (glissé léger). Uniquement
// opacité et transformations (calculées par la carte graphique) : pas de flou plein
// écran, trop coûteux quand on navigue vite.
const EASE = [0.22, 1, 0.36, 1] as const;
const screenVariants = {
  enter: (dir: number) => ({ opacity: dir < 0 ? 0.45 : 0, x: dir < 0 ? -8 : 24 }),
  center: { opacity: 1, x: 0, scale: 1, transition: { duration: 0.3, ease: EASE } },
  exit: (dir: number) => ({ opacity: 0, x: dir < 0 ? 6 : -14, transition: { duration: dir < 0 ? 0.07 : 0.11, ease: "easeIn" as const } }),
};

export function App() {
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
    if (!import.meta.env.DEV && !useSettings.getState().autostartOffered) {
      void shellApi.autostartSet(true).then(() => useSettings.getState().set("autostartOffered", true), () => undefined);
    }
    return () => {
      alive = false;
      off();
    };
  }, []);
  // nouvelle version d'iBox : annoncée par une notification (installation dans Paramètres › Système)
  useEffect(() => startUpdateWatch(), []);
  // succès RetroAchievements débloqués pendant une partie : annoncés en direct
  useEffect(() => startRaWatch(
    () => useLauncher.getState().phase === "running",
    (fn) => useLauncher.subscribe((s, p) => { if ((s.phase === "running") !== (p.phase === "running")) fn(s.phase === "running"); }),
  ), []);
  // overlay en jeu (Alt+E) : réglages des clips et du raccourci, ouverture de la Communauté
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
  useEffect(() => void setFullscreen(fullscreen), [fullscreen]);
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
      <div data-nav-root data-nav-main className="relative flex h-full flex-col">
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
      </div>
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
    </MotionConfig>
  );
}
