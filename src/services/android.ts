/**
 * Socle Android (plugin `ibox-android`, docs/ANDROID.md) : accès aux fichiers et choix d'un
 * dossier de ROM. Le relais de la manette et le bouton Retour sont dans `input/`.
 */
import { usePlatform } from "./platform";

export interface StorageVolume {
  path: string;
  label: string;
  primary: boolean;
  removable: boolean;
  mounted: boolean;
}

export interface StorageStatus {
  /** iBox lit tous les fichiers (Android 11+ : « Accès à tous les fichiers »). */
  allFiles: boolean;
  sdk: number;
  volumes: StorageVolume[];
}

export interface PickedFolder {
  uri: string;
  path: string;
}

export interface FolderEntry {
  name: string;
  path: string;
}

/** Contenu d'un dossier pour le sélecteur d'iBox (`android_browse`). */
export interface Browse {
  /** null : liste des volumes. */
  path: string | null;
  /** null depuis la racine d'un volume. */
  parent: string | null;
  folders: FolderEntry[];
  /** Fichiers de jeu reconnus dans ce dossier. */
  games: number;
  volumes: StorageVolume[];
}

export const isAndroid = () => !!usePlatform.getState().android;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : "Erreur inattendue.");
  }
}

export const androidApi = {
  storage: () => call<StorageStatus>("android_storage"),
  /** Ouvre la page « Accès à tous les fichiers » d'Android ; répond au retour dans iBox. */
  requestStorage: () => call<StorageStatus>("android_storage_request"),
  /** Sélecteur du système, ouvert sur `initial` si possible (autorisation SAF gardée). */
  pickFolder: (initial: string | null = null) => call<PickedFolder>("android_pick_folder", { initial }),
  /** Le dossier est couvert par une autorisation SAF (les émulateurs y ont accès). */
  safCovered: (path: string) => call<boolean>("android_saf_covered", { path }),
  /** Sélecteur d'iBox : volumes (null) ou contenu d'un dossier. */
  browse: (path: string | null) => call<Browse>("android_browse", { path }),
  setImmersive: (enabled: boolean) => call<void>("android_immersive", { enabled }),

  /** Accès à tous les fichiers : demandé s'il manque (page d'Android). */
  async ensureFiles(): Promise<void> {
    let status = await androidApi.storage();
    if (!status.allFiles) status = await androidApi.requestStorage();
    if (!status.allFiles) throw new Error("iBox a besoin de l'accès à tous les fichiers pour lire vos jeux : autorisez-le dans la page d'Android qui vient de s'ouvrir.");
  },

  /**
   * Dossier de ROM : l'accès aux fichiers d'abord (le scanner lit les fichiers directement), puis
   * le sélecteur d'iBox, à la manette (mémoire interne, cartes SD, racine comprise ; celui du
   * système en secours). null si l'utilisateur annule.
   */
  async pickRomFolder(title = "Choisir un dossier de jeux"): Promise<string | null> {
    await androidApi.ensureFiles();
    const { browseFolder } = await import("@/components/android/FolderBrowser");
    return browseFolder({ title, purpose: "roms" });
  },

  /** Dossier des BIOS (sélecteur d'iBox, ouvert sur `start`). */
  async pickBiosFolder(title: string, start: string | null): Promise<string | null> {
    await androidApi.ensureFiles();
    const { browseFolder } = await import("@/components/android/FolderBrowser");
    return browseFolder({ title, purpose: "bios", start });
  },
};
