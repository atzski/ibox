import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { SPRING, stagger } from "@/motion/tokens";
import { sound, type SoundCue } from "@/services/sound";
import { Icon, type IconName } from "@/components/ui/Icon";
import { applyAppTheme } from "@/theme/appThemes";
import { useSettings } from "@/services/settings";
import {
  applyKey,
  keyboardRows,
  playTime,
  sessionTime,
  viewOf,
  type PlayPanel,
  type SecondAchievements,
  type SecondCommand,
  type SecondGame,
  type SecondState,
  type ShortcutTarget,
} from "./model";
import "./second.css";

/**
 * Écran du bas des consoles à deux écrans (AYN Thor). Page servie par la fenêtre principale
 * (`?screen=second`), sans IPC : l'état arrive par `window.__iboxSecond`, les touchers repartent
 * par `IboxSecond.send` (plugin `ibox-android`, `SecondScreen.kt`). Tout se pilote au doigt ; la
 * manette reste sur l'écran du haut. Conception : docs/ANDROID.md, « Second écran ».
 */

interface Bridge {
  send(json: string): void;
  state(): string;
}
declare global {
  interface Window {
    IboxSecond?: Bridge;
    __iboxSecond?: (state: SecondState) => void;
  }
}

function send(cmd: SecondCommand, cue?: SoundCue) {
  if (cue) sound.play(cue);
  window.IboxSecond?.send(JSON.stringify(cmd));
}

const LANG_RELOAD = "ibox.second.langReload";

function useSecondState(): SecondState | null {
  const [state, setState] = useState<SecondState | null>(() => {
    try {
      return JSON.parse(window.IboxSecond?.state() ?? "null") as SecondState | null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    window.__iboxSecond = (s) => {
      // Langue changée en haut : la traduction ne se change qu'au chargement (i18n), la page se
      // recharge donc comme la fenêtre principale ; une seule fois par langue demandée.
      if (s.lang !== document.documentElement.lang && sessionStorage.getItem(LANG_RELOAD) !== s.lang) {
        sessionStorage.setItem(LANG_RELOAD, s.lang);
        window.location.reload();
        return;
      }
      if (s.lang === document.documentElement.lang) sessionStorage.removeItem(LANG_RELOAD);
      setState(s);
    };
    send({ type: "ready" });
    return () => {
      window.__iboxSecond = undefined;
    };
  }, []);
  return state;
}

/** Minute courante (durée de la partie). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

export function SecondScreen() {
  const state = useSecondState();
  const appTheme = useSettings((s) => s.appTheme ?? "ibox");

  useEffect(() => {
    if (!state) return;
    document.documentElement.dataset.theme = state.dark ? "dark" : "light";
    document.documentElement.dataset.motion = state.reduced ? "reduced" : "full";
    applyAppTheme(appTheme);
  }, [state?.dark, state?.reduced, appTheme, state]);

  if (!state || state.setup) {
    return (
      <div className="ibx2">
        <div className="ibx2-wait">
          <div className="ibx2-wait-inner">
            <img src="/logo.svg" alt="" className="ibx2-wait-logo" />
            {state?.setup && <p className="ibx2-wait-text">Suivez l'assistant sur l'écran du haut.</p>}
          </div>
        </div>
      </div>
    );
  }

  const view = viewOf(state);
  return (
    <MotionConfig reducedMotion={state.reduced ? "always" : "never"}>
      <div className="ibx2" style={state.game ? ({ "--ibx2-a": state.game.tint[0], "--ibx2-b": state.game.tint[1] } as CSSProperties) : undefined}>
        <TopBar state={state} shortcuts={view.kind === "shortcuts"} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={view.kind + (view.kind === "card" ? state.game?.id : "")}
            className="ibx2-body"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={SPRING.smooth}
          >
            {view.kind === "card" && state.game && <GameCardView game={state.game} launching={state.phase === "launching"} />}
            {view.kind === "shortcuts" && <ShortcutsView state={state} />}
            {view.kind === "play" && <PlayView state={state} panels={view.panels} />}
          </motion.main>
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

// ——— Barre du haut ———

function TopBar({ state, shortcuts }: { state: SecondState; shortcuts: boolean }) {
  const now = useNow();
  const playing = state.phase === "playing";
  return (
    <header className="ibx2-top">
      <img src="/logo.svg" alt="iBox" className="ibx2-logo" />
      <span className="ibx2-context">
        {playing ? (
          <>
            <span className="ibx2-live" aria-hidden />
            <span>En jeu</span>
            {state.session?.startedAt && <span className="ibx2-faint">· {sessionTime(state.session.startedAt, now)}</span>}
          </>
        ) : state.phase === "launching" ? (
          <span>Lancement…</span>
        ) : (
          <span>{shortcuts ? "Raccourcis" : "Jeu choisi"}</span>
        )}
      </span>
      {playing && (
        <Tap className="ibx2-return" onTap={() => send({ type: "return" }, "home")} label="Revenir à iBox">
          <Icon name="home" size="1.1em" />
          <span>Revenir à iBox</span>
        </Tap>
      )}
    </header>
  );
}

// ——— Fiche du jeu choisi ———

function GameCardView({ game, launching }: { game: SecondGame; launching: boolean }) {
  const last = game.lastPlayedAt ? new Date(game.lastPlayedAt) : null;
  return (
    <div className="ibx2-card">
      <div className="ibx2-cover-wrap">
        {game.cover ? <img className="ibx2-cover" src={game.cover} alt="" /> : <div className="ibx2-cover ibx2-cover-empty"><Icon name="disc" size="2.4em" /></div>}
      </div>
      <div className="ibx2-info">
        <span className="ibx2-platform">{game.platform}</span>
        <h1 className="ibx2-title" data-raw>{game.title}</h1>
        <p className="ibx2-meta">{[game.year, game.developer, game.genre].filter(Boolean).join(" · ")}</p>
        <div className="ibx2-stats">
          <Stat icon="clock" label="Temps de jeu" value={playTime(game.playSeconds)} />
          <Stat icon="play" label="Parties" value={String(game.playCount ?? 0)} />
          {last && <Stat icon="history" label="Dernière partie" value={last.toLocaleDateString(document.documentElement.lang || "fr", { day: "numeric", month: "short" })} />}
        </div>
        {game.summary && <p className="ibx2-summary" data-raw>{game.summary}</p>}
        <div className="ibx2-actions">
          <Tap className="ibx2-btn ibx2-btn-primary" onTap={() => send({ type: "game", action: "play" })} label="Jouer" disabled={launching}>
            <Icon name="play" size="1.1em" />
            <span>{launching ? "Lancement…" : "Jouer"}</span>
          </Tap>
          <Tap className="ibx2-btn" onTap={() => send({ type: "game", action: "open" }, "open")} label="Fiche du jeu">
            <Icon name="front" size="1.1em" />
            <span>Fiche</span>
          </Tap>
          <Tap className="ibx2-btn ibx2-btn-round" onTap={() => send({ type: "game", action: "favorite" }, game.favorite ? "unfavorite" : "favorite")} label={game.favorite ? "Retirer des favoris" : "Ajouter aux favoris"} pressed={game.favorite}>
            <Icon name="star" size="1.15em" />
          </Tap>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className="ibx2-stat">
      <Icon name={icon} size="1em" />
      <span className="ibx2-stat-label">{label}</span>
      <span className="ibx2-stat-value">{value}</span>
    </div>
  );
}

// ——— Raccourcis ———

const SHORTCUTS: { target: ShortcutTarget; label: string; icon: IconName; tone: string; cue: SoundCue }[] = [
  { target: "search", label: "Rechercher", icon: "search", tone: "blue", cue: "search" },
  { target: "collections", label: "Collections", icon: "shelf", tone: "purple", cue: "open" },
  { target: "friends", label: "Amis", icon: "smile", tone: "green", cue: "friends" },
  { target: "library", label: "Tous les jeux", icon: "grid", tone: "orange", cue: "open" },
  { target: "achievements", label: "Succès", icon: "trophy", tone: "yellow", cue: "open" },
  { target: "settings", label: "Paramètres", icon: "gear", tone: "teal", cue: "settings" },
];

function ShortcutsView({ state }: { state: SecondState }) {
  return (
    <div className="ibx2-shortcuts">
      <div className="ibx2-tiles">
        {SHORTCUTS.map((s, i) => (
          <motion.div key={s.target} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...SPRING.pop, delay: stagger(i) }}>
            <Tap className={`ibx2-tile tone-${s.tone}`} onTap={() => send({ type: "open", target: s.target }, s.cue)} label={s.label}>
              <span className="ibx2-tile-icon"><Icon name={s.icon} size="1.5em" /></span>
              <span className="ibx2-tile-label">{s.label}</span>
              {s.target === "friends" && state.friendsOnline > 0 && <span className="ibx2-badge">{state.friendsOnline}</span>}
              {s.target === "library" && state.libraryCount > 0 && <span className="ibx2-tile-hint">{state.libraryCount > 1 ? `${state.libraryCount} jeux` : "1 jeu"}</span>}
            </Tap>
          </motion.div>
        ))}
      </div>
      {state.collections.length > 0 && (
        <div className="ibx2-collections">
          {state.collections.slice(0, 8).map((c) => (
            <Tap key={c.id} className="ibx2-collection" onTap={() => send({ type: "collection", id: c.id }, "open")} label={c.name}>
              <span className="ibx2-dot" style={{ background: c.color }} />
              <span data-raw>{c.name}</span>
              <span className="ibx2-faint">{c.count}</span>
            </Tap>
          ))}
        </div>
      )}
    </div>
  );
}

// ——— Pendant une partie ———

const PANEL_LABEL: Record<PlayPanel, { label: string; icon: IconName }> = {
  achievements: { label: "Succès", icon: "trophy" },
  manual: { label: "Manuel", icon: "manual" },
  notes: { label: "Notes", icon: "chat" },
  music: { label: "Musique", icon: "sound" },
};

function PlayView({ state, panels }: { state: SecondState; panels: PlayPanel[] }) {
  const [panel, setPanel] = useState<PlayPanel | null>(panels[0] ?? null);
  const current = panel && panels.includes(panel) ? panel : (panels[0] ?? null);
  const game = state.game;
  return (
    <div className="ibx2-play">
      <div className="ibx2-play-head">
        {game?.cover && <img className="ibx2-mini-cover" src={game.cover} alt="" />}
        <div className="ibx2-play-title">
          <span className="ibx2-platform">{game?.platform}</span>
          <strong data-raw>{game?.title ?? "Partie en cours"}</strong>
        </div>
        {panels.length > 1 && (
          <nav className="ibx2-tabs" aria-label="Panneaux">
            {panels.map((p) => (
              <Tap key={p} className="ibx2-tab" pressed={p === current} onTap={() => setPanel(p)} label={PANEL_LABEL[p].label} cue="tab">
                <Icon name={PANEL_LABEL[p].icon} size="1.05em" />
                <span>{PANEL_LABEL[p].label}</span>
              </Tap>
            ))}
          </nav>
        )}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.section key={current ?? "none"} className="ibx2-panel" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={SPRING.snappy}>
          {current === "achievements" && <AchievementsPanel data={state.achievements} />}
          {current === "manual" && <ManualPanel state={state} />}
          {current === "notes" && game && <NotesPanel gameId={game.id} note={state.note} lang={state.lang} />}
          {current === "music" && state.music && <MusicPanel music={state.music} />}
          {!current && <p className="ibx2-empty">Bonne partie !</p>}
        </motion.section>
      </AnimatePresence>
    </div>
  );
}

function AchievementsPanel({ data }: { data: SecondAchievements | null }) {
  if (!data) return <p className="ibx2-empty">Lecture des succès…</p>;
  if (!data.linked) return <p className="ibx2-empty">Reliez votre compte RetroAchievements dans Paramètres › Profil pour suivre vos succès en direct.</p>;
  if (!data.total) return <p className="ibx2-empty">Aucun succès RetroAchievements trouvé pour ce jeu.</p>;
  const pct = Math.round((data.earned / data.total) * 100);
  return (
    <div className="ibx2-ach">
      <div className="ibx2-progress">
        <span className="ibx2-progress-text">
          <strong>{data.earned}</strong> / {data.total} · {data.points} points
        </span>
        <span className="ibx2-bar"><motion.span className="ibx2-bar-fill" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={SPRING.gentle} /></span>
      </div>
      <ul className="ibx2-ach-list">
        {data.list.map((a, i) => (
          <motion.li key={a.id} className={`ibx2-ach-item${a.earned ? " is-earned" : ""}${a.fresh ? " is-fresh" : ""}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING.smooth, delay: stagger(i, 0.03) }}>
            {a.badge ? <img src={a.badge} alt="" className="ibx2-ach-badge" loading="lazy" /> : <span className="ibx2-ach-badge" />}
            <span className="ibx2-ach-text">
              <span className="ibx2-ach-title" data-raw>{a.title}</span>
              <span className="ibx2-ach-desc" data-raw>{a.description}</span>
            </span>
            <span className="ibx2-ach-points">{a.fresh ? "Nouveau" : `${a.points}`}</span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function ManualPanel({ state }: { state: SecondState }) {
  const page = state.manualPage;
  const start = useRef<number | null>(null);
  useEffect(() => {
    if (!page) send({ type: "manual", index: 0 });
  }, [page]);
  const go = (delta: number) => {
    if (!page) return;
    const index = page.index + delta;
    if (index < 0 || index >= page.count) return;
    send({ type: "manual", index }, "page");
  };
  const down = (e: ReactPointerEvent) => (start.current = e.clientX);
  const up = (e: ReactPointerEvent) => {
    if (start.current === null) return;
    const dx = e.clientX - start.current;
    start.current = null;
    if (Math.abs(dx) > 48) go(dx < 0 ? 1 : -1);
  };
  return (
    <div className="ibx2-manual">
      <Tap className="ibx2-btn ibx2-btn-round" onTap={() => go(-1)} label="Page précédente" disabled={!page || page.index === 0}>
        <Icon name="chevronLeft" size="1.2em" />
      </Tap>
      <div className="ibx2-page" onPointerDown={down} onPointerUp={up}>
        {page ? <img src={page.src} alt="" draggable={false} /> : <span className="ibx2-empty">Ouverture du manuel…</span>}
        {page && <span className="ibx2-page-num">{page.index + 1} / {page.count}</span>}
      </div>
      <Tap className="ibx2-btn ibx2-btn-round" onTap={() => go(1)} label="Page suivante" disabled={!page || page.index >= page.count - 1}>
        <Icon name="chevronRight" size="1.2em" />
      </Tap>
    </div>
  );
}

function NotesPanel({ gameId, note, lang }: { gameId: string; note: string; lang: "fr" | "en" }) {
  const [text, setText] = useState(note);
  const [shift, setShift] = useState(false);
  const typed = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!typed.current) setText(note);
  }, [note]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const press = (key: string) => {
    typed.current = true;
    const next = applyKey(text, shift && key.length === 1 ? key.toUpperCase() : key);
    if (shift) setShift(false);
    setText(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => send({ type: "note", gameId, text: next }), 600);
  };
  return (
    <div className="ibx2-notes">
      <div className="ibx2-note-text" data-raw>
        {text || <span className="ibx2-faint">Un code, un chemin, où vous en êtes…</span>}
        <span className="ibx2-caret" aria-hidden />
      </div>
      <div className="ibx2-keys" role="group" aria-label="Clavier">
        {keyboardRows(lang).map((row, i) => (
          <div key={i} className="ibx2-key-row">
            {row.map((k) => (
              <button key={k} type="button" className="ibx2-key" data-silent onPointerDown={(e) => { e.preventDefault(); sound.play("tap"); press(k); }}>
                {shift ? k.toUpperCase() : k}
              </button>
            ))}
          </div>
        ))}
        <div className="ibx2-key-row">
          <button type="button" className="ibx2-key ibx2-key-wide" aria-pressed={shift} aria-label="Majuscule" data-silent onPointerDown={(e) => { e.preventDefault(); sound.play("tap"); setShift((v) => !v); }}>⇧</button>
          {(lang === "fr" ? ["é", "è", "à"] : [",", "."]).map((k) => (
            <button key={k} type="button" className="ibx2-key" data-silent onPointerDown={(e) => { e.preventDefault(); sound.play("tap"); press(k); }}>{k}</button>
          ))}
          <button type="button" className="ibx2-key ibx2-key-space" aria-label="Espace" data-silent onPointerDown={(e) => { e.preventDefault(); sound.play("tap"); press("space"); }} />
          <button type="button" className="ibx2-key ibx2-key-wide" aria-label="Nouvelle ligne" data-silent onPointerDown={(e) => { e.preventDefault(); sound.play("tap"); press("enter"); }}>↵</button>
          <button type="button" className="ibx2-key ibx2-key-wide" aria-label="Effacer" data-silent onPointerDown={(e) => { e.preventDefault(); sound.play("back"); press("backspace"); }}>⌫</button>
        </div>
      </div>
    </div>
  );
}

function MusicPanel({ music }: { music: NonNullable<SecondState["music"]> }) {
  return (
    <div className="ibx2-music">
      {music.artwork ? <img className="ibx2-music-art" src={music.artwork} alt="" /> : <span className="ibx2-music-art"><Icon name="sound" size="2em" /></span>}
      <div className="ibx2-music-text">
        <strong data-raw>{music.title}</strong>
        <span className="ibx2-faint" data-raw>{music.artist}</span>
      </div>
      <div className="ibx2-actions">
        <Tap className="ibx2-btn ibx2-btn-round" onTap={() => send({ type: "music", action: "prev" }, "tap")} label="Titre précédent"><Icon name="chevronLeft" size="1.2em" /></Tap>
        <Tap className="ibx2-btn ibx2-btn-primary" onTap={() => send({ type: "music", action: "toggle" }, "tap")} label={music.playing ? "Pause" : "Lecture"}>
          <Icon name={music.playing ? "minus" : "play"} size="1.2em" />
          <span>{music.playing ? "Pause" : "Lecture"}</span>
        </Tap>
        <Tap className="ibx2-btn ibx2-btn-round" onTap={() => send({ type: "music", action: "next" }, "tap")} label="Titre suivant"><Icon name="chevronRight" size="1.2em" /></Tap>
      </div>
    </div>
  );
}

// ——— Bouton tactile ———

function Tap({ className, onTap, label, children, disabled, pressed, cue }: { className: string; onTap: () => void; label: string; children: ReactNode; disabled?: boolean; pressed?: boolean; cue?: SoundCue }) {
  return (
    <motion.button
      type="button"
      className={className}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      data-silent={cue ? undefined : true}
      whileTap={{ scale: 0.95 }}
      transition={SPRING.snappy}
      onClick={() => {
        if (cue) sound.play(cue);
        onTap();
      }}
    >
      {children}
    </motion.button>
  );
}
