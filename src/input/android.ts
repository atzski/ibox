/**
 * Entrées propres à Android (docs/ANDROID.md, « Manette » et « Retour ») :
 * - relais natif de la manette (`nativePad.ts`) ;
 * - bouton Retour du système (geste ou touche) : même chemin que B / Échap.
 */
import { attachNativePads } from "./nativePad";

export function attachAndroidInput(onBack: () => void): () => void {
  const offPads = attachNativePads();
  let offBack: (() => void) | null = null;
  let stopped = false;
  void import("@tauri-apps/api/app")
    .then(({ onBackButtonPress }) => onBackButtonPress(() => onBack()))
    .then((listener) => {
      if (stopped) void listener.unregister();
      else offBack = () => void listener.unregister();
    })
    .catch((e) => console.warn("iBox : bouton Retour d'Android indisponible", e));
  return () => {
    stopped = true;
    offPads();
    offBack?.();
  };
}
