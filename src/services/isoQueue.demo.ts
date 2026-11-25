import type { Game } from "@/domain/types";
import { getPlatform } from "@/domain/platforms";
import { sortKey } from "@/domain/text";
import type { PendingIso } from "@/domain/isoQueue";
import type { IsoQueueDto } from "./nativeLibrary";
import { useLibrary } from "./library";

/**
 * Natif simulé pour l'aperçu de développement (`?iso-demo`, navigateur seulement) :
 * quelques .iso factices en attente, et des jeux de démonstration créés à la
 * réponse. Chargé à la demande, jamais dans l'application.
 */
const CANDIDATES = ["gamecube", "wii", "ps1", "ps2", "ps3", "psp", "xbox", "xbox360"];
const GO = 1024 ** 3;

let pending: (PendingIso & { ignored?: boolean })[] = [
  { path: "D:\\Jeux\\A trier\\Okami (Europe).iso", folderId: 1, size: 4.1 * GO, title: "Okami", region: "PAL", guess: null, guessSource: null },
  { path: "D:\\Jeux\\A trier\\Shadow of the Colossus (USA).iso", folderId: 1, size: 3.9 * GO, title: "Shadow of the Colossus", region: "NTSC-U", guess: null, guessSource: null },
  { path: "D:\\Jeux\\A trier\\Jak and Daxter (Europe).iso", folderId: 1, size: 1.3 * GO, title: "Jak and Daxter", region: "PAL", guess: null, guessSource: null },
  { path: "D:\\Jeux\\PSP\\Patapon (Europe).iso", folderId: 1, size: 0.3 * GO, title: "Patapon", region: "PAL", guess: "psp", guessSource: "folder" },
  { path: "D:\\Jeux\\Anciens\\Wipeout (Europe).iso", folderId: 2, size: 0.5 * GO, title: "Wipeout", region: "PAL", guess: "ps1", guessSource: "header" },
  { path: "D:\\Telechargements\\Installation.iso", folderId: 3, size: 5.2 * GO, title: "Installation", region: null, guess: null, guessSource: null },
];
let nextId = 1;

function demoGame(file: PendingIso, platformId: string): Game {
  const t = getPlatform(platformId)?.theme;
  return {
    id: `iso-demo-${nextId++}`,
    platformId,
    title: file.title,
    sortTitle: sortKey(file.title),
    region: file.region ?? undefined,
    filePath: file.path,
    addedAt: new Date().toISOString(),
    isDemo: true,
    art: { motif: "placeholder", palette: t ? [t.soft, t.primary, t.deep, t.primary, "#ffffff"] : ["#EAF6FD", "#8CCDF1", "#2F7FB0", "#8CCDF1", "#ffffff"] },
  };
}

export const demoBackend = {
  queue: async (): Promise<IsoQueueDto> => ({
    pending: pending.filter((p) => !p.ignored),
    ignored: pending.filter((p) => p.ignored).length,
    candidates: CANDIDATES,
  }),

  assign: async (paths: string[], platformId: string | null): Promise<number[]> => {
    const chosen = pending.filter((p) => paths.includes(p.path));
    if (platformId === null) {
      for (const p of chosen) p.ignored = true;
      return [];
    }
    pending = pending.filter((p) => !paths.includes(p.path));
    // les jeux rangés rejoignent la collection affichée, dans la console choisie
    useLibrary.setState((s) => ({ games: [...s.games, ...chosen.map((p) => demoGame(p, platformId))] }));
    return chosen.map(() => nextId);
  },

  restoreIgnored: async (): Promise<number> => {
    const n = pending.filter((p) => p.ignored).length;
    for (const p of pending) p.ignored = false;
    return n;
  },
};
