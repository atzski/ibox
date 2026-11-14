import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/nunito";
import "@fontsource-variable/fredoka";
import "./styles/global.css";
import { useSettings } from "./services/settings";
import { defaultLang, startTranslation } from "./i18n";
import { restorePortableSettings } from "./services/portableBackup";

// Outils de vérification en développement uniquement (absents du build de production)
if (import.meta.env.DEV) {
  void Promise.all([import("./services/library"), import("./app/navigation"), import("./domain/demoLibrary"), import("./services/sound")]).then(
    ([lib, nav, demo, snd]) => {
      (window as unknown as Record<string, unknown>).__ibox = { useLibrary: lib.useLibrary, useNav: nav.useNav, DEMO_GAMES: demo.DEMO_GAMES, sound: snd.sound };
    },
  );
}

// La fenêtre des notifications (en bas à droite) n'affiche que les notifications.
const isToast = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__?.metadata?.currentWindow?.label === "toast";
const root = createRoot(document.getElementById("root")!);
const initialize = async () => {
  if (!isToast) await restorePortableSettings().catch((error) => console.error("Sauvegarde iBox", error));
  const settings = useSettings.getState();
  if (!settings.language) settings.set("language", defaultLang());
  startTranslation(useSettings.getState().language ?? "fr");
};
if (isToast) {
  void initialize().then(() => import("./components/social/ToastWindow")).then(({ ToastWindow }) => root.render(<ToastWindow />));
} else {
  void initialize().then(() => Promise.all([import("./app/App"), import("./services/tvMode")])).then(([{ App }]) =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
}
