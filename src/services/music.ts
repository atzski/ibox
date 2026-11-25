import { useSettings } from "./settings";
import { AMBIENCE_FADE, AmbienceComposer, ambienceLevel, ambienceOutput, scheduleVoice, type AmbienceBus } from "./ambience";

/** Une fois le fondu de sortie terminé, le moteur audio est mis en veille (plus aucun calcul). */
const SLEEP_AFTER_MS = 1600;
/** Le compositeur est interrogé chaque seconde, pour les voix des trois secondes à venir. */
const TICK_MS = 1000;
const LOOKAHEAD = 3;
/** Part du niveau gardée pendant un jingle. */
const DUCK = 0.25;

/**
 * Ambiance sonore des menus (le nom du fichier et de l'export date de la musique des menus
 * qu'elle remplace).
 *
 * - Synthétisée en direct (`ambience.ts`) : aucune piste, aucun fichier.
 * - Une seule ambiance, toujours : un seul moteur audio, un seul compositeur, une seule
 *   minuterie pour toute la vie de la fenêtre. Couper, remettre, changer de profil ou revenir
 *   de veille reprend le même air là où il s'était arrêté, sans jamais en lancer un second.
 * - S'efface en douceur, puis met son moteur audio en veille, quand la fenêtre est masquée ou
 *   réduite, quand un jeu tourne, ou quand la musique de l'utilisateur joue ; revient en douceur.
 * - Si le WebView refuse le son avant une interaction, elle démarre au premier clic ou à la
 *   première touche.
 * - Suit en direct les réglages « Ambiance sonore » et son volume.
 */
class AmbiencePlayer {
  private ctx: AudioContext | null = null;
  private bus: AmbienceBus | null = null;
  private readonly composer = new AmbienceComposer();
  /** Instant du contexte où l'air a commencé, et jusqu'où il a été composé (secondes depuis cet instant). */
  private origin = 0;
  private composed = 0;
  private timer = 0;
  private sleepTimer = 0;
  private attached = false;
  private playing = false;
  /** Ambiance suspendue (un jeu est en cours). */
  private suspended = false;
  /** Fenêtre d'iBox masquée (démarrage avec Windows, zone de notification). */
  private background = false;
  /** La musique de l'utilisateur joue (Music in the Box) : l'ambiance lui laisse la place. */
  private yielding = false;
  private ducks = 0;

  /**
   * Votre musique d'abord : tant qu'elle joue, l'ambiance des menus se tait (fondu) ;
   * elle revient d'elle-même quand la vôtre s'arrête.
   */
  setYielding(value: boolean): void {
    if (this.yielding === value) return;
    this.yielding = value;
    this.sync();
  }

  setBackground(value: boolean): void {
    if (this.background === value) return;
    this.background = value;
    this.sync();
  }

  setSuspended(value: boolean): void {
    if (this.suspended === value) return;
    this.suspended = value;
    this.sync();
  }

  /** Baisse l'ambiance le temps d'un jingle ; renvoie la fonction qui la remet. */
  duck(): () => void {
    this.ducks++;
    this.sync();
    let restored = false;
    return () => {
      if (restored) return;
      restored = true;
      this.ducks--;
      this.sync();
    };
  }

  /** À appeler une fois au démarrage de l'application. Renvoie le nettoyage. */
  attach(): () => void {
    this.attached = true;
    const unsubscribe = useSettings.subscribe((s, prev) => {
      if (s.ambienceEnabled !== prev.ambienceEnabled || s.ambienceVolume !== prev.ambienceVolume) this.sync();
    });
    const onVisibility = () => this.sync();
    const onGesture = () => {
      // Débloque le son si le WebView l'a refusé au démarrage
      if (this.playing && this.ctx?.state === "suspended") void this.ctx.resume();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
    this.sync();
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
      this.attached = false;
      this.sync();
    };
  }

  private shouldPlay(): boolean {
    const s = useSettings.getState();
    return this.attached && s.ambienceEnabled && s.ambienceVolume > 0 && !document.hidden && !this.suspended && !this.background && !this.yielding;
  }

  private context(): AudioContext | null {
    if (typeof window === "undefined" || !("AudioContext" in window)) return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.bus = ambienceOutput(this.ctx);
      this.origin = this.ctx.currentTime + 0.05;
    }
    return this.ctx;
  }

  private sync(): void {
    if (this.shouldPlay()) this.wake();
    else this.rest();
  }

  private wake(): void {
    const ctx = this.context();
    if (!ctx || !this.bus) return;
    window.clearTimeout(this.sleepTimer);
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    const level = ambienceLevel(useSettings.getState().ambienceVolume) * (this.ducks > 0 ? DUCK : 1);
    this.bus.master.gain.setTargetAtTime(level, ctx.currentTime, this.playing ? AMBIENCE_FADE.level : AMBIENCE_FADE.in);
    this.playing = true;
    if (!this.timer) {
      this.compose();
      // Minuterie plutôt que requestAnimationFrame : rAF s'arrête quand la fenêtre est masquée
      this.timer = window.setInterval(() => this.compose(), TICK_MS);
    }
  }

  private rest(): void {
    const { ctx, bus } = this;
    if (!ctx || !bus || !this.playing) return;
    this.playing = false;
    window.clearInterval(this.timer);
    this.timer = 0;
    bus.master.gain.setTargetAtTime(0, ctx.currentTime, AMBIENCE_FADE.out);
    // Fondu terminé : le moteur dort (temps figé, zéro calcul) et reprendra où il s'est arrêté
    this.sleepTimer = window.setTimeout(() => void ctx.suspend().catch(() => undefined), SLEEP_AFTER_MS);
  }

  private compose(): void {
    const { ctx, bus } = this;
    if (!ctx || !bus) return;
    const now = ctx.currentTime;
    // Trou dans la composition (minuterie retardée, moteur resté éveillé) : on reprend au présent,
    // sans rattraper d'un coup tout ce qui aurait dû être joué.
    if (now - this.origin > this.composed) this.origin = now - this.composed;
    const until = now - this.origin + LOOKAHEAD;
    for (const voice of this.composer.next(until)) {
      const at = this.origin + voice.at;
      // une voix dont l'instant est déjà passé est abandonnée plutôt que jouée en retard, hors tempo
      if (at >= now) scheduleVoice(ctx, { ...voice, at }, bus);
    }
    this.composed = until;
  }
}

export const music = new AmbiencePlayer();
