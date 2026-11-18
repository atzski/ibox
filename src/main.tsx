import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/nunito";
import "@fontsource-variable/fredoka";
import "./styles/global.css";
import { useSettings } from "./services/settings";
import { defaultLang, startTranslation } from "./i18n";
import { restorePortableSettings } from "./services/portableBackup";
import { attachCrashLog } from "./services/crashLog";
import { loadPlatform } from "./services/platform";
import { ErrorBoundary, RootFallback } from "./components/shell/ErrorBoundary";

// erreurs non rattrapées de cette fenêtre : notées dans logs/crash.log
attachCrashLog();

// Outils de vérification en développement uniquement (absents du build de production)
if (import.meta.env.DEV) {
  void Promise.all([import("./services/library"), import("./app/navigation"), import("./domain/demoLibrary"), import("./services/sound")]).then(
    ([lib, nav, demo, snd]) => {
      (window as unknown as Record<string, unknown>).__ibox = { useLibrary: lib.useLibrary, useNav: nav.useNav, DEMO_GAMES: demo.DEMO_GAMES, sound: snd.sound };
    },
  );
}

// La fenêtre des notifications (en bas à droite) n'affiche que les notifications.
const windowLabel = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
const isToast = windowLabel === "toast";
// L'overlay en jeu (Alt+E) : captures et clips par-dessus la partie.
const isOverlay = windowLabel === "overlay";
// Remote Play : bandeau de l'hôte, toujours visible pendant un partage.
const isIndicator = windowLabel === "remote-play-indicator";
// fenêtres transparentes : jamais de décor plein écran derrière leur contenu
if (isToast || isOverlay || isIndicator) document.documentElement.classList.add("ibox-transparent-window");
const root = createRoot(document.getElementById("root")!);
const initialize = async () => {
  await loadPlatform();
  if (!isToast && !isOverlay && !isIndicator) await restorePortableSettings().catch((error) => console.error("Sauvegarde iBox", error));
  const settings = useSettings.getState();
  if (!settings.language) settings.set("language", defaultLang());
  startTranslation(useSettings.getState().language ?? "fr");
};
if (isIndicator) {
  void initialize().then(() => import("./components/remoteplay/RemotePlayIndicator")).then(({ RemotePlayIndicator }) => root.render(<RemotePlayIndicator />));
} else if (isOverlay) {
  void initialize().then(() => import("./components/overlay/OverlayWindow")).then(({ OverlayWindow }) => root.render(<OverlayWindow />));
} else if (isToast) {
  void initialize().then(() => import("./components/social/ToastWindow")).then(({ ToastWindow }) => root.render(<ToastWindow />));
} else {
  void initialize().then(async () => {
    const { usePlatform } = await import("./services/platform");
    if (!usePlatform.getState().bench) return renderApp();
    // banc d'essai Remote Play de l'aperçu Steam Deck : mesures sans la scène 3D derrière
    const { NativeGuestBench } = await import("./components/remoteplay/NativeGuestBench");
    root.render(<NativeGuestBench />);
  });
}

function renderApp() {
  void Promise.all([import("./app/App"), import("./services/tvMode")]).then(([{ App }]) =>
    root.render(
      <StrictMode>
        <ErrorBoundary where="application" fallback={() => <RootFallback />}>
          <App />
        </ErrorBoundary>
      </StrictMode>,
    ),
  );
}
