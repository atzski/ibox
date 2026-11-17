import { useSettings } from "./settings";

/** Musique de menu par défaut : composition originale d'iBox, générée par `scripts/music/menu_music.py` (libre de droits). */
export const MENU_TRACK = "/sounds/menu.mp3";

const FADE_IN_MS = 1400;
const FADE_OUT_MS = 700;

/**
 * Lecteur de musique d'ambiance en boucle.
 *
 * - Fondus enchaînés entre pistes (ex. musique propre à une console via
 *   `Platform.ambience`, sinon la musique de menu).
 * - Si la lecture automatique est bloquée par le WebView, elle démarre au
 *   premier clic ou à la première touche.
 * - Se met en pause en douceur quand la fenêtre est masquée ou réduite.
 * - Suit en direct les réglages « Musique » et « Volume de la musique ».
 */
class MusicPlayer {
  private el: HTMLAudioElement | null = null;
  private url: string | null = null;
  private wanted: string | null = null;
  private fadeTimer = new Map<HTMLAudioElement, number>();
  private started = false;
  /** Musique suspendue (un jeu est en cours). */
  private suspended = false;
  /** Fenêtre d'iBox masquée (démarrage avec Windows, zone de notification). */
  private background = false;

  setBackground(value: boolean): void {
    if (this.background === value) return;
    this.background = value;
    this.sync();
  }

  /** Baisse la musique le temps d'un jingle ; renvoie la fonction qui la remet. */
  duck(): () => void {
    const el = this.el;
    if (!el || el.paused) return () => undefined;
    const before = el.volume;
    el.volume = before * 0.25;
    return () => { if (this.el === el) el.volume = before; };
  }

  private advance: (() => boolean) | null = null;
  /** Playlist : à la fin d'une piste, la suivante (sinon la piste boucle). */
  setAdvance(fn: (() => boolean) | null): void {
    this.advance = fn;
  }

  setSuspended(value: boolean): void {
    if (this.suspended === value) return;
    this.suspended = value;
    this.sync();
  }

  /** À appeler une fois au démarrage de l'application. Renvoie le nettoyage. */
  attach(): () => void {
    const unsubscribe = useSettings.subscribe((s, prev) => {
      if (s.musicEnabled !== prev.musicEnabled || s.musicVolume !== prev.musicVolume) this.sync();
    });
    const onVisibility = () => this.sync();
    const onGesture = () => {
      // Débloque la lecture si le navigateur l'a refusée au démarrage
      if (this.el && this.el.paused && this.shouldPlay()) this.start(this.el);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
      this.wanted = null;
      this.sync();
    };
  }

  /** Demande une piste ; ne fait rien si elle est déjà en cours. */
  play(url: string): void {
    this.wanted = url;
    this.sync();
  }

  stop(): void {
    this.wanted = null;
    this.sync();
  }

  private shouldPlay(): boolean {
    const s = useSettings.getState();
    return !!this.wanted && s.musicEnabled && s.musicVolume > 0 && !document.hidden && !this.suspended && !this.background;
  }

  private targetVolume(): number {
    // Courbe perceptive : le curseur paraît linéaire à l'oreille
    const v = useSettings.getState().musicVolume;
    return Math.min(1, v * v * 0.8);
  }

  private sync(): void {
    // Changement de piste : fondu de sortie de l'ancienne
    if (this.wanted !== this.url) {
      if (this.el) this.retire(this.el);
      this.el = null;
      this.url = this.wanted;
      this.started = false;
      if (this.wanted) {
        const el = new Audio(this.wanted);
        el.loop = !this.advance || this.wanted.startsWith("/");
        el.onended = () => { if (this.el === el && !this.advance?.()) { el.currentTime = 0; void el.play(); } };
        el.preload = "auto";
        el.volume = 0;
        this.el = el;
      }
    }
    const el = this.el;
    if (!el) return;
    if (this.shouldPlay()) {
      if (el.paused) this.start(el);
      else this.fade(el, this.targetVolume(), 250);
    } else if (!el.paused) {
      this.fade(el, 0, FADE_OUT_MS, () => el.pause());
    }
  }

  private start(el: HTMLAudioElement): void {
    el.play()
      .then(() => {
        this.fade(el, this.targetVolume(), this.started ? 400 : FADE_IN_MS);
        this.started = true;
      })
      .catch(() => {
        /* lecture automatique refusée : on attend une interaction */
      });
  }

  private retire(el: HTMLAudioElement): void {
    this.fade(el, 0, FADE_OUT_MS, () => {
      el.pause();
      el.removeAttribute("src");
      el.load();
    });
  }

  /**
   * Fondu de volume. Minuteries plutôt que requestAnimationFrame : rAF est
   * suspendu quand la fenêtre est masquée, ce qui bloquerait la mise en pause.
   */
  private fade(el: HTMLAudioElement, to: number, ms: number, done?: () => void): void {
    const prev = this.fadeTimer.get(el);
    if (prev !== undefined) window.clearInterval(prev);
    const from = el.volume;
    const t0 = performance.now();
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * (1 - Math.pow(1 - k, 3))));
      if (k >= 1) {
        window.clearInterval(id);
        this.fadeTimer.delete(el);
        done?.();
      }
    };
    const id = window.setInterval(tick, 30);
    this.fadeTimer.set(el, id);
    tick();
  }
}

export const music = new MusicPlayer();
