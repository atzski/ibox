import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { TWEEN } from "@/motion/tokens";
import { useNav, type Route } from "@/app/navigation";
import { requestDraw } from "@/app/draw";
import { Modal } from "@/components/ui/Modal";
import type { Tone } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { CoverImage } from "@/components/game/CoverImage";
import { PlatformGlyph } from "@/components/platform/PlatformGlyph";
import { PadGlyph } from "@/components/shell/PadGlyph";
import { padKeysOf } from "@/components/shell/HintBar";
import { PLATFORMS, requirePlatform } from "@/domain/platforms";
import { rank } from "@/domain/search";
import { relativeDay } from "@/domain/text";
import type { Game, Platform } from "@/domain/types";
import { tr } from "@/i18n";
import { useCommands } from "@/input/commands";
import { useGamepad } from "@/input/gamepad";
import { visibleSettingsCategories } from "@/screens/settings/categories";
import { capabilities, platformOnDevice, type Capability } from "@/services/capabilities";
import { isDecor, useCollections, type Collection } from "@/services/extras";
import { useLauncher } from "@/services/launcher";
import { countByPlatform, useLibrary } from "@/services/library";
import { useSettings } from "@/services/settings";
import { sound } from "@/services/sound";

/** Une ligne de résultat : ce qu'elle montre, ce qu'elle ouvre. */
interface Entry {
  key: string;
  visual: ReactNode;
  title: string;
  /** Titre venu des données (jeu, collection) : jamais traduit. */
  raw?: boolean;
  detail?: ReactNode;
  open: () => void;
  /** Action rapide (X / □) : lancer le jeu sans ouvrir sa fiche. */
  quick?: () => void;
}

interface Section {
  label: string;
  entries: Entry[];
  /** Meilleure note de la section : la plus pertinente passe en tête. */
  best: number;
}

interface Destination {
  label: string;
  hint: string;
  icon: IconName;
  hue: Tone;
  route: Route;
  /** absent de l'appareil sans cette capacité (Android) */
  needs?: Capability;
}

const DESTINATIONS: Destination[] = [
  { label: "Accueil", hint: "Retour à l'écran d'accueil", icon: "home", hue: "blue", route: { name: "home" } },
  { label: "Toute la collection", hint: "Tous vos jeux, sur l'étagère", icon: "shelf", hue: "purple", route: { name: "library", platformId: "all" } },
  { label: "iBox Platforms", hint: "Les consoles et leurs émulateurs", icon: "gamepad", hue: "red", route: { name: "platforms" }, needs: "platforms" },
  { label: "Succès", hint: "Votre salle des trophées", icon: "trophy", hue: "yellow", route: { name: "achievements" } },
  { label: "Communauté", hint: "Captures et clips partagés", icon: "chat", hue: "green", route: { name: "community" } },
  { label: "SmartConfig", hint: "Réglages adaptés à votre PC", icon: "tune", hue: "orange", route: { name: "smartconfig" }, needs: "smartConfig" },
];

/** Pastille colorée d'une ligne qui n'est pas un jeu (même dessin que le rail des Paramètres). */
function Tile({ hue, children }: { hue: Tone; children: ReactNode }) {
  return (
    <span className={`tone-${hue} grid size-9 shrink-0 place-items-center rounded-xl bg-[linear-gradient(160deg,color-mix(in_srgb,var(--tone)_78%,#ffffff),var(--tone))] text-[var(--tone-on)] shadow-[inset_0_-2px_0_rgba(0,0,0,0.18),0_4px_10px_-4px_var(--tone)]`}>
      {children}
    </span>
  );
}

function PlatformTile({ platform }: { platform: Platform }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-xl shadow-[inset_0_-2px_0_rgba(0,0,0,0.14)]" style={{ background: platform.theme.soft, color: platform.theme.deep }}>
      <PlatformGlyph glyph={platform.glyph} size={20} strokeWidth={2.6} />
    </span>
  );
}

/** Sigle d'une console, comme on le tape : « GameCube » → GC, « PlayStation 2 » → PS2, « Nintendo 64 » → N64. */
const sigle = (name: string) => name.replace(/[^A-Z0-9]/g, "");

/** Jeu joué il y a peu, favori, déjà lancé : à note égale, il passe devant. */
function gameBonus(game: Game, now: number): number {
  let bonus = 0;
  if (game.lastPlayedAt) {
    const days = (now - Date.parse(game.lastPlayedAt)) / 86_400_000;
    bonus += days < 14 ? 5 : days < 90 ? 3 : 1;
  }
  if (game.favorite) bonus += 3;
  if (!game.missing) bonus += 1;
  return bonus;
}

/**
 * Recherche universelle (touche /, Select, ou X sur l'accueil) : un seul champ pour
 * retrouver un jeu, une console, une collection, une page des Paramètres ou une action.
 * Sans rien taper, elle propose de reprendre les dernières parties et d'aller partout.
 * Entrée ouvre le meilleur résultat ; sur un jeu, X le lance sans passer par sa fiche.
 */
export function QuickSearch({ games, onClose, onCollection }: { games: Game[]; onClose: () => void; onCollection: (id: number) => void }) {
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const { list, load } = useCollections();
  useEffect(() => void load().catch(() => undefined), [load]);
  const lang = useSettings((s) => s.language ?? "fr");
  const native = useLibrary((s) => s.native);
  const hasFolders = useLibrary((s) => s.folders.length > 0);
  const scanRunning = useLibrary((s) => s.scan.running);
  const { active: padActive, family, connected } = useGamepad();
  // Android au doigt : ni clavier ni manette active, aucune touche à rappeler
  const showKeys = padActive || capabilities().keyboard;
  const side = useSettings((s) => s.gamepadConfirm);
  const q = query.trim();

  const sections = useMemo<Section[]>(() => {
    const nav = useNav.getState();
    // pages et destinations présentes sur l'appareil (Android : ni PC, ni SmartConfig…)
    const caps = capabilities();
    const places = DESTINATIONS.filter((d) => !d.needs || caps[d.needs]);
    const pages = visibleSettingsCategories(caps);
    const navigate = (route: Route) => {
      onClose();
      if (route.name === "home") nav.home();
      else nav.go(route);
    };
    const play = (game: Game) => {
      const { phase, play: launch } = useLauncher.getState();
      if (game.dbId === undefined || game.missing || phase === "animating" || phase === "starting" || phase === "running") return sound.play("error");
      onClose();
      sound.play("select");
      void launch(game.dbId, game.title);
    };
    const gameEntry = (game: Game): Entry => {
      const platform = requirePlatform(game.platformId);
      return {
        key: `game:${game.id}`,
        visual: (
          <span className="flex h-[3.1rem] w-10 shrink-0 items-center">
            <CoverImage game={game} rounded="rounded-[0.3rem]" sheen={false} className={`w-full shadow-xs ${game.missing ? "opacity-50 grayscale" : ""}`} />
          </span>
        ),
        title: game.title,
        raw: true,
        detail: (
          <>
            <span data-no-i18n>{platform.shortName}</span>
            {game.year && <span data-no-i18n>{` · ${game.year}`}</span>}
            {game.lastPlayedAt && <span> · joué {relativeDay(game.lastPlayedAt)}</span>}
          </>
        ),
        open: () => navigate({ name: "game", gameId: game.id }),
        quick: () => play(game),
      };
    };
    const destinationEntry = (d: Destination): Entry => ({
      key: `go:${d.label}`,
      visual: <Tile hue={d.hue}><Icon name={d.icon} size="1.1em" /></Tile>,
      title: d.label,
      detail: d.hint,
      open: () => navigate(d.route),
    });
    const actions: { label: string; hint: string; icon: IconName; hue: Tone; keywords: string; run: () => void }[] = [
      { label: "Un jeu au hasard", hint: "iBox choisit pour vous sur l'étagère", icon: "dice", hue: "pink", keywords: "hasard aléatoire tirage surprise que jouer", run: () => { onClose(); requestDraw(); } },
      ...(native && hasFolders && !scanRunning
        ? [{ label: "Actualiser la collection", hint: "Relit vos dossiers de jeux", icon: "reset" as IconName, hue: "teal" as Tone, keywords: "scan nouveaux jeux", run: () => { onClose(); void useLibrary.getState().startScan(); } }]
        : []),
      { label: "Commandes et raccourcis", hint: "Le menu rapide et l'aide des boutons", icon: "gamepad", hue: "blue", keywords: "aide touches manette clavier", run: () => useCommands.getState().setMenu(true) },
    ];
    const actionEntry = (a: (typeof actions)[number]): Entry => ({
      key: `do:${a.label}`,
      visual: <Tile hue={a.hue}><Icon name={a.icon} size="1.1em" /></Tile>,
      title: a.label,
      detail: a.hint,
      open: a.run,
    });

    // rien de tapé : reprendre où l'on en était, aller partout
    if (!q) {
      const played = games.filter((g) => g.lastPlayedAt).sort((a, b) => (b.lastPlayedAt! > a.lastPlayedAt! ? 1 : -1)).slice(0, 4);
      const recent = played.length ? played : [...games].sort((a, b) => (b.addedAt > a.addedAt ? 1 : -1)).slice(0, 4);
      return [
        { label: played.length ? "Reprendre" : "Ajoutés récemment", entries: recent.map(gameEntry), best: 0 },
        { label: "Aller à", entries: places.map(destinationEntry), best: 0 },
        { label: "Actions", entries: actions.map(actionEntry), best: 0 },
      ].filter((s) => s.entries.length > 0);
    }

    // les mots anglais trouvent aussi les pages quand l'interface est en anglais
    const both = (...texts: string[]) => (lang === "en" ? texts.flatMap((t) => [t, tr(t, "en")]) : texts);
    const now = Date.now();
    const counts = countByPlatform(games);
    const foundGames = rank(games, q, (g) => g.title, 8, (g) => gameBonus(g, now));
    const foundPlatforms = rank(PLATFORMS.filter((p) => platformOnDevice(p.id, caps)), q, (p) => [p.name, p.shortName, p.manufacturer, p.id, sigle(p.shortName), sigle(p.name)], 4, (p) => ((counts.get(p.id) ?? 0) > 0 ? 5 : 0));
    const foundCollections = rank(list.filter((c) => !isDecor(c.id)), q, (c: Collection) => c.name, 4);
    const foundPages = rank(pages, q, (c) => [...both(c.label), ...both(c.hint), c.keywords], 4);
    const foundPlaces = rank(places, q, (d) => [...both(d.label), ...both(d.hint)], 3);
    const foundActions = rank(actions, q, (a) => [...both(a.label), ...both(a.hint), a.keywords], 3);
    const best = (found: { score: number }[]) => found[0]?.score ?? 0;
    const out: Section[] = [
      { label: "Jeux", entries: foundGames.map((r) => gameEntry(r.item)), best: best(foundGames) },
      {
        label: "Consoles",
        entries: foundPlatforms.map(({ item: p }) => {
          const count = counts.get(p.id) ?? 0;
          return {
            key: `platform:${p.id}`,
            visual: <PlatformTile platform={p} />,
            title: p.name,
            raw: true,
            detail: count > 1 ? `${count} jeux` : count === 1 ? "1 jeu" : "Aucun jeu",
            open: () => navigate({ name: "library", platformId: p.id }),
          };
        }),
        best: best(foundPlatforms),
      },
      {
        label: "Collections",
        entries: foundCollections.map(({ item: c }) => ({
          key: `collection:${c.id}`,
          visual: (
            <span className="grid size-9 shrink-0 place-items-center rounded-xl text-[#ffffff] shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)]" style={{ background: c.color }}>
              <Icon name="shelf" size="1.1em" />
            </span>
          ),
          title: c.name,
          raw: true,
          detail: c.gameIds.length > 1 ? `${c.gameIds.length} jeux` : c.gameIds.length === 1 ? "1 jeu" : "Aucun jeu",
          open: () => onCollection(c.id),
        })),
        best: best(foundCollections),
      },
      {
        label: "Aller à",
        entries: [
          ...foundPlaces.map((r) => destinationEntry(r.item)),
          ...foundPages.map(({ item: c }) => ({
            key: `settings:${c.id}`,
            visual: <Tile hue={c.hue}><Icon name={c.icon} size="1.1em" /></Tile>,
            title: c.label,
            detail: <><span>Paramètres</span>{" · "}<span>{c.hint}</span></>,
            open: () => navigate({ name: "settings", category: c.id }),
          })),
        ],
        best: Math.max(best(foundPlaces), best(foundPages)),
      },
      { label: "Actions", entries: foundActions.map((r) => actionEntry(r.item)), best: best(foundActions) },
    ];
    // la section la plus pertinente d'abord (ordre d'origine à égalité)
    return out.filter((s) => s.entries.length > 0).sort((a, b) => Math.round(b.best / 20) - Math.round(a.best / 20));
  }, [q, games, list, lang, native, hasFolders, scanRunning, onClose, onCollection]);

  const first = sections[0]?.entries[0];
  // nouvelle requête : la liste repart du haut
  useEffect(() => { results.current?.scrollTo({ top: 0 }); }, [q]);

  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || !first) return;
    event.preventDefault();
    sound.play("select");
    first.open();
  };

  const hints: { keys: string[]; label: string }[] = [
    { keys: ["↑", "↓"], label: "Parcourir" },
    { keys: ["Entrée"], label: "Ouvrir" },
    { keys: ["X"], label: "Jouer" },
    { keys: ["Échap"], label: "Fermer" },
  ];

  return (
    <Modal title="Recherche" width="44rem" onClose={onClose}>
      <div className="flex items-center gap-2">
        <label className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-full bg-cream-deep px-5 focus-within:ring-2 focus-within:ring-[var(--accent)]">
          <Icon name="search" className="shrink-0 text-ink-soft" />
          <input
            ref={field}
            data-focusable
            data-autofocus
            type="search"
            autoComplete="off"
            spellCheck={false}
            aria-label="Rechercher un jeu, une console, une collection, un réglage ou une action"
            placeholder="Un jeu, une console, un réglage…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onFieldKey}
            className="w-full bg-transparent text-[1rem] font-semibold text-ink outline-none placeholder:text-ink-faint"
          />
        </label>
        {/* manette branchée (ou Steam Deck) : le clavier virtuel commun écrit directement dans le champ */}
        {connected && (
          <button
            data-focusable
            onClick={() => field.current && window.dispatchEvent(new CustomEvent("ibox:pad-keyboard", { detail: field.current }))}
            className="ibox-focusable ibox-chip h-12 shrink-0 rounded-full px-4 text-[0.85rem] font-bold [--ring-radius:999px]"
          >
            Clavier à l’écran
          </button>
        )}
      </div>

      {/* taille fixe : la fenêtre ne change pas de hauteur pendant la saisie */}
      <div ref={results} data-cover-scroll-root data-nav-group="search-results" className="mt-4 h-[50vh] overflow-y-auto pr-1">
        {sections.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={TWEEN.fast} className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-cream-deep text-ink-soft"><Icon name="search" size="1.5em" /></span>
            <p className="text-[1.05rem] font-bold text-ink">Aucun résultat</p>
            <p className="max-w-[24rem] text-[0.9rem] font-semibold text-ink-soft">Essayez un autre mot, les initiales d'un jeu ou le nom d'une console.</p>
          </motion.div>
        ) : (
          <motion.div key={q ? "results" : "idle"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={TWEEN.fast}>
            {sections.map((section) => (
              <section key={section.label} className="mb-3">
                <h3 className="mb-1 px-2 text-[0.72rem] font-extrabold tracking-[0.14em] text-ink-soft uppercase">{section.label}</h3>
                {section.entries.map((entry) => (
                  <button
                    key={entry.key}
                    data-focusable
                    data-focus-id={entry.key}
                    onClick={entry.open}
                    onKeyDown={entry.quick && ((event) => {
                      if (event.key.toLowerCase() !== "x") return;
                      event.preventDefault();
                      entry.quick!();
                    })}
                    className={`ibox-focusable group flex w-full items-center gap-3 rounded-2xl px-2 py-1.5 text-left [--ring-radius:1rem] hover:bg-cream-deep/70 focus-visible:bg-cream-deep/70 ${entry === first ? "bg-cream-deep/45" : ""}`}
                  >
                    {entry.visual}
                    <span className="min-w-0 flex-1">
                      <span data-no-i18n={entry.raw || undefined} className="block truncate text-[0.98rem] font-bold text-ink">{entry.title}</span>
                      {entry.detail && <span className="block truncate text-[0.8rem] font-semibold text-ink-soft">{entry.detail}</span>}
                    </span>
                    {/* meilleur résultat : la touche qui l'ouvre, celle de la manette s'il y en a une
                        (« Entrée » sur une console sans clavier n'a pas de sens) */}
                    {entry === first && showKeys && (padActive ? (
                      <span className="flex shrink-0">{padKeysOf(["Entrée"]).map((k) => <PadGlyph key={k} k={k} family={family} side={side} size={20} />)}</span>
                    ) : (
                      <kbd className="shrink-0 rounded-md bg-white px-2 py-0.5 font-body text-[0.68rem] font-extrabold text-ink-soft shadow-xs">Entrée</kbd>
                    ))}
                    <Icon name="chevronRight" size="1em" className="shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                  </button>
                ))}
              </section>
            ))}
          </motion.div>
        )}
      </div>

      {/* aide des commandes : la barre du bas de l'écran est masquée par la fenêtre */}
      {showKeys && <div className="mt-3 flex flex-wrap items-center justify-end gap-x-5 gap-y-1 border-t border-[var(--ibox-line)] pt-3" aria-hidden>
        {hints.map((h) => (
          <span key={h.label} className="flex items-center gap-1.5 text-[0.78rem] font-bold text-ink-soft">
            {padActive
              ? padKeysOf(h.keys).map((k) => <PadGlyph key={k} k={k} family={family} side={side} size={22} />)
              : h.keys.map((k) => (
                  <kbd key={k} className="inline-grid h-6 min-w-6 place-items-center rounded-md bg-cream-deep px-1.5 font-body text-[0.7rem] font-extrabold text-ink">{k}</kbd>
                ))}
            <span>{h.label}</span>
          </span>
        ))}
      </div>}
    </Modal>
  );
}
