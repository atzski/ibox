import { create } from "zustand";
import { PLATFORMS } from "@/domain/platforms";
import { orderCandidates, type PendingIso } from "@/domain/isoQueue";
import { isTauri } from "./native";
import { nativeLibrary, type IsoQueueDto } from "./nativeLibrary";
import { useLibrary } from "./library";
import { useSettings } from "./settings";

/**
 * Fichiers « .iso » dont la console est à demander (Rust › library::iso).
 *
 * Le scan ne s'arrête jamais pour eux : ils attendent ici. La question s'ouvre
 * d'elle-même quand un scan en trouve de nouveaux, et reste accessible depuis
 * la bibliothèque tant qu'il en reste.
 */
interface Backend {
  queue: () => Promise<IsoQueueDto>;
  assign: (paths: string[], platformId: string | null) => Promise<number[]>;
  restoreIgnored: () => Promise<number>;
}

const native: Backend = {
  queue: nativeLibrary.isoQueue,
  assign: nativeLibrary.isoAssign,
  restoreIgnored: nativeLibrary.isoRestoreIgnored,
};

/** Aperçu de développement dans un navigateur : `?iso-demo` simule des .iso en attente. */
export const isoDemo =
  import.meta.env.DEV && !isTauri() && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("iso-demo");

let backend: Promise<Backend> | undefined;
function api(): Promise<Backend> {
  backend ??= isoDemo ? import("./isoQueue.demo").then((m) => m.demoBackend) : Promise.resolve(native);
  return backend;
}

interface IsoQueueState {
  pending: PendingIso[];
  /** Fichiers écartés (« ce n'est pas un jeu »). */
  ignored: number;
  /** Consoles proposées, dans l'ordre du registre. */
  candidates: string[];
  /** La question est affichée. */
  open: boolean;
  load: () => Promise<void>;
  /** Fin d'un scan : relit la file et pose la question s'il y a du nouveau. */
  afterScan: (fresh: number) => Promise<void>;
  show: () => void;
  hide: () => void;
  /** Range des fichiers dans une console ; `null` : « ce n'est pas un jeu ». */
  assign: (paths: string[], platformId: string | null) => Promise<void>;
  restoreIgnored: () => Promise<void>;
}

export const useIsoQueue = create<IsoQueueState>((set, get) => {
  const available = () => isTauri() || isoDemo;
  const apply = (q: IsoQueueDto) =>
    set({ pending: q.pending, ignored: q.ignored, candidates: orderCandidates(q.candidates, PLATFORMS.map((p) => p.id)) });

  return {
    pending: [],
    ignored: 0,
    candidates: [],
    open: false,

    load: async () => {
      if (!available()) return;
      apply(await (await api()).queue());
    },

    afterScan: async (fresh) => {
      await get().load().catch(() => undefined);
      if (fresh > 0 && get().pending.length > 0) set({ open: true });
    },

    show: () => set({ open: true }),
    hide: () => set({ open: false }),

    assign: async (paths, platformId) => {
      const backend = await api();
      const created = await backend.assign(paths, platformId);
      apply(await backend.queue());
      if (!created.length || isoDemo) return;
      const library = useLibrary.getState();
      await library.reload();
      // jaquettes et infos des jeux qui viennent d'être rangés, en arrière-plan
      if (useSettings.getState().autoFetchMetadata) void library.fetchMetadata(created, { auto: true });
    },

    restoreIgnored: async () => {
      const backend = await api();
      await backend.restoreIgnored();
      apply(await backend.queue());
    },
  };
});
