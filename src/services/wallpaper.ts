import { useEffect, useState } from "react";
import { isTauri } from "./native";
import { metadataApi } from "./metadata";

/**
 * Fond d'écran personnel : l'image choisie est copiée par iBox dans son dossier
 * de données (l'original n'est ni déplacé ni modifié), puis relue ici.
 */
export const wallpaperApi = {
  /** Ouvre le sélecteur, copie l'image et renvoie vrai si un fond a été posé. */
  async choose(): Promise<boolean> {
    const path = await metadataApi.pickImage();
    if (!path) return false;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("wallpaper_set", { path });
    return true;
  },
  async clear(): Promise<void> {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("wallpaper_clear");
  },
};

/** Adresse locale du fond personnel ; `stamp` change à chaque nouveau choix. */
export function useWallpaperUrl(stamp: number | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (stamp === null || !isTauri()) {
      setUrl(null);
      return;
    }
    let alive = true;
    let made: string | null = null;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const bytes = await invoke<ArrayBuffer>("wallpaper_read");
        if (!alive) return;
        made = URL.createObjectURL(new Blob([bytes]));
        const img = new Image();
        img.src = made;
        await img.decode().catch(() => undefined);
        if (alive) setUrl(made);
      } catch {
        if (alive) setUrl(null);
      }
    })();
    return () => {
      alive = false;
      // laisse le fondu se terminer avant de libérer l'image
      if (made) {
        const u = made;
        setTimeout(() => URL.revokeObjectURL(u), 2000);
      }
    };
  }, [stamp]);
  return url;
}
