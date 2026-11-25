import type { Game } from "@/domain/types";
import { artKey, prepareThumb } from "./covers";

/**
 * Vignettes des jaquettes pour la vue reculée de la bibliothèque.
 *
 * Une jaquette complète fait 800 px de large : en afficher des centaines à 40 px coûterait
 * des secondes de peinture et des centaines de Mo. Ici chaque jeu donne une petite image à
 * la taille demandée, et seul son fichier WebP (quelques Ko) est gardé.
 *
 * Les demandes sont servies par petites tranches de temps pour ne jamais bloquer une image,
 * la plus urgente d'abord : la grille indique à quelle distance du centre de la vue se trouve
 * chaque jeu (`setThumbRank`), si bien que ce qu'on regarde se remplit avant la marge montée
 * autour. Sans ce classement, la demande la plus récente passe d'abord. Une demande
 * abandonnée avant son tour n'est pas peinte.
 */
const SIZES = [320, 192, 96] as const;
/** Temps de peinture par tranche (ms) : il reste de quoi dessiner l'image en cours. */
const BUDGET = 5;
/** Lectures simultanées des vraies jaquettes (fichiers du cache natif). */
const WORKERS = 4;

interface Waiter {
  ok: (url: string) => void;
  fail: () => void;
}
interface Job {
  key: string;
  game: Game;
  width: number;
  waiters: Set<Waiter>;
  started: boolean;
}

const ready = new Map<string, string>();
const jobs = new Map<string, Job>();
let pending: Job[] = [];
let rank: ((game: Game) => number) | null = null;
let workers = 0;
let sliceStart = 0;
let nextSlice: Promise<void> | null = null;

const keyOf = (game: Game, width: number) => `${artKey(game)}@${width}`;

/** Vignette déjà prête à cette taille. */
export function peekThumbUrl(game: Game, width: number): string | undefined {
  return ready.get(keyOf(game, width));
}

/** Vignette déjà prête, quelle que soit sa taille (la plus grande d'abord) : image d'attente. */
export function peekAnyThumbUrl(game: Game): string | undefined {
  for (const width of SIZES) {
    const url = ready.get(keyOf(game, width));
    if (url) return url;
  }
  return undefined;
}

// Un message à soi-même rend la main au navigateur sans le délai minimal de 4 ms des
// minuteurs enchaînés : entre deux tranches, il peut dessiner et traiter les entrées.
const channel = typeof MessageChannel === "undefined" ? null : new MessageChannel();
let wake: (() => void) | null = null;
if (channel) channel.port1.onmessage = () => wake?.();

/** Rend la main au navigateur, puis ouvre une nouvelle tranche de temps. */
function pause(): Promise<void> {
  nextSlice ??= new Promise((resolve) => {
    wake = () => {
      wake = null;
      nextSlice = null;
      sliceStart = performance.now();
      resolve();
    };
    if (channel) channel.port2.postMessage(0);
    else setTimeout(() => wake?.(), 0);
  });
  return nextSlice;
}

function toUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("Encodage impossible"))), "image/webp", 0.86),
  );
}

/**
 * Classement des demandes en attente : plus la valeur est petite, plus le jeu est servi tôt
 * (la grille donne la distance au centre de la vue). `null` : la plus récente d'abord.
 */
export function setThumbRank(fn: ((game: Game) => number) | null): void {
  rank = fn;
}

/** Prochaine demande encore attendue. */
function take(): Job | undefined {
  // celles qui ont été abandonnées avant leur tour sortent de la file
  if (pending.some((job) => job.waiters.size === 0)) {
    pending = pending.filter((job) => {
      if (job.waiters.size > 0) return true;
      if (jobs.get(job.key) === job) jobs.delete(job.key);
      return false;
    });
  }
  if (pending.length === 0) return undefined;
  let best = pending.length - 1;
  if (rank) {
    let lowest = Infinity;
    for (let i = 0; i < pending.length; i++) {
      const value = rank(pending[i].game);
      if (value < lowest) {
        lowest = value;
        best = i;
      }
    }
  }
  return pending.splice(best, 1)[0];
}

function settle(job: Job, url: string | null): void {
  if (url) ready.set(job.key, url);
  if (jobs.get(job.key) === job) jobs.delete(job.key);
  job.waiters.forEach((w) => (url ? w.ok(url) : w.fail()));
}

async function work(): Promise<void> {
  workers++;
  try {
    for (;;) {
      while (performance.now() - sliceStart > BUDGET) await pause();
      const job = take();
      if (!job) break;
      job.started = true;
      try {
        const paint = await prepareThumb(job.game, job.width);
        // plusieurs préparations aboutissent souvent ensemble : le budget se revérifie juste
        // avant chaque peinture, sinon elles s'enchaîneraient dans la même tranche
        while (performance.now() - sliceStart > BUDGET) await pause();
        const canvas = paint();
        // l'encodage se fait hors du fil principal : on n'attend pas pour peindre la suivante
        void toUrl(canvas).then(
          (url) => settle(job, url),
          () => settle(job, null),
        );
      } catch {
        settle(job, null);
      }
    }
  } finally {
    workers--;
  }
}

/**
 * Demande la vignette d'un jeu. `ok` reçoit son URL (tout de suite si elle est prête).
 * Renvoie la fonction d'abandon, à appeler quand la jaquette quitte l'écran.
 */
export function requestThumb(game: Game, width: number, ok: (url: string) => void, fail: () => void): () => void {
  const key = keyOf(game, width);
  const url = ready.get(key);
  if (url) {
    ok(url);
    return () => undefined;
  }
  let job = jobs.get(key);
  // abandonnée puis redemandée avant d'avoir été peinte : elle repart en fin de file
  if (!job || (job.waiters.size === 0 && !job.started)) {
    job = { key, game, width, waiters: new Set(), started: false };
    jobs.set(key, job);
    pending.push(job);
  }
  const waiter: Waiter = { ok, fail };
  job.waiters.add(waiter);
  if (workers < WORKERS) {
    if (workers === 0) sliceStart = performance.now();
    void work();
  }
  const owner = job;
  return () => {
    owner.waiters.delete(waiter);
  };
}
