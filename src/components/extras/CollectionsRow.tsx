import type React from "react";
import { useEffect, useLayoutEffect, useMemo, useState, type FormEvent, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";
import type { Game } from "@/domain/types";
import { ShelfView } from "@/three/lazy";
import { ShelfRow } from "@/components/ui/Section";
import { Modal } from "@/components/ui/Modal";
import { Button, Segmented } from "@/components/ui/Button";
import { IconBar, IconBarButton } from "@/components/ui/IconBar";
import { Icon, type IconName } from "@/components/ui/Icon";
import { CoverImage } from "@/components/game/CoverImage";
import { useLibrary } from "@/services/library";
import { COLLECTION_COLORS, useCollections, useCollectionStyles, matchesSmartRule, type SmartRule, type Collection, type CollectionStyle } from "@/services/extras";
import { useMediaUrl } from "@/art/useMediaUrl";
import { invoke } from "@tauri-apps/api/core";
import { useReducedMotion, useIsDark } from "@/app/shellState";
import { useNav } from "@/app/navigation";
import { input } from "@/input/InputController";
import { PLATFORMS } from "@/domain/platforms";
import { sound } from "@/services/sound";
import { POKEMON, SHOWDOWN, pokemonImages } from "@/content/decorations";
import { anchorFor, layoutGrid, moveInGrid, occupiedCells, type GridItem } from "./collectionGrid";

/** Grille de l'accueil : cases carrées d'au moins 12,5 rem, étirées sur toute la largeur. */
const CELL = { min: 12.5, gap: 1.5 };

/** Accueil : les collections personnelles, chacune ouvre son étagère 3D. */
export function CollectionsRow() {
  const { list, load } = useCollections();
  const games = useLibrary((s) => s.realGames);
  const [open, setOpen] = useState<Collection | null>(null);
  const [editing, setEditing] = useState<Collection | "new" | null>(null);
  const [decorating, setDecorating] = useState<Collection | "new" | null>(null);
  useEffect(() => void load().catch(() => undefined), [load]);
  const byDb = useMemo(() => new Map(games.map((g) => [g.dbId, g])), [games]);
  const styles = useCollectionStyles((s) => s.styles);
  const setSlots = useCollectionStyles((s) => s.setSlots);
  const gamesOf = (c: Collection) => {
    const rule = styles[c.id]?.rule;
    const items = rule ? games.filter((g) => matchesSmartRule(rule, g)) : c.gameIds.map((id) => byDb.get(id)).filter((g): g is Game => !!g);
    const order = styles[c.id]?.gameOrder;
    if (!order?.length) return items;
    const positions = new Map(order.map((id, index) => [id, index]));
    return [...items].sort((a, b) => (positions.get(a.dbId!) ?? Infinity) - (positions.get(b.dbId!) ?? Infinity));
  };
  useEffect(() => {
    const listener = (event: Event) => {
      const collection = useCollections.getState().list.find((c) => c.id === (event as CustomEvent<number>).detail);
      if (collection) setOpen(collection);
    };
    window.addEventListener("ibox:open-collection", listener);
    return () => window.removeEventListener("ibox:open-collection", listener);
  }, []);

  // Grille libre : cases carrées sur toute la largeur ; une carte carrée (icône, décoration)
  // prend 1 case, une carte large 2. Des cases peuvent rester vides.
  const grid = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState({ cols: 6, cell: 200, gap: 24 });
  const cols = geom.cols;
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const gap = CELL.gap * rem;
      const n = Math.max(2, Math.floor((el.clientWidth + gap) / (CELL.min * rem + gap)));
      setGeom({ cols: n, cell: (el.clientWidth - gap * (n - 1)) / n, gap });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const gridItems = useMemo<GridItem[]>(() => list.map((c) => ({
    id: c.id,
    span: styles[c.id]?.decor || styles[c.id]?.iconStamp ? 1 : 2,
    slot: styles[c.id]?.slot,
  })), [list, styles]);
  const spanOf = (id: number) => gridItems.find((g) => g.id === id)?.span ?? 1;
  const at = useMemo(() => layoutGrid(gridItems, cols), [gridItems, cols]);
  const last = Math.max(-1, ...gridItems.map((g) => at.get(g.id)! + g.span - 1));

  // Mode « Organiser » : on attrape une carte (clic maintenu), elle suit la souris et se
  // pose dans la case visée, vide ou non (les deux cartes échangent alors leur place).
  const reorder = useCollections((s) => s.reorder);
  const [organizing, setOrganizing] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const rows = Math.floor(last / cols) + 1 + (organizing ? 1 : 0);
  const cellAt = (x: number, y: number) => {
    const el = grid.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const step = geom.cell + geom.gap;
    const col = Math.floor((x - r.left + geom.gap / 2) / step);
    const row = Math.floor((y - r.top + geom.gap / 2) / step);
    if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
    return row * cols + col;
  };
  const place = (id: number, cell: number) => {
    if (cell < 0) return false;
    const next = moveInGrid(gridItems, cols, at, id, cell);
    if (next === at) return false;
    setSlots(Object.fromEntries(next));
    sound.play("move");
    // l'ordre enregistré suit la lecture de la grille (clavier, recherche…)
    const ids = [...next].sort((a, b) => a[1] - b[1]).map(([k]) => k);
    if (ids.join() !== list.map((c) => c.id).join()) void reorder(ids).catch(() => sound.play("error"));
    return true;
  };
  const shown = [...list].sort((a, b) => at.get(a.id)! - at.get(b.id)!);
  const used = occupiedCells(gridItems, at);
  const empty = organizing ? Array.from({ length: rows * cols }, (_, s) => s).filter((s) => !used.has(s)) : [];
  // cases que recouvrirait la carte attrapée
  const aimed = new Set(target !== null && dragId !== null ? Array.from({ length: spanOf(dragId) }, (_, k) => anchorFor(target, spanOf(dragId), cols) + k) : []);

  return (
    <ShelfRow
      title="Mes collections"
      group="home-collections"
      wrap
      action={
        <IconBar>
          {list.length > 1 && (
            <IconBarButton
              icon={organizing ? "check" : "grid"}
              label={organizing ? "Terminé" : "Organiser"}
              title={organizing ? "Terminé" : "Organiser : maintenez le clic sur une carte et posez-la dans la case de votre choix"}
              active={organizing}
              cue={organizing ? "back" : "open"}
              tint={organizing ? "var(--tone-green-ink)" : "var(--tone-purple-ink)"}
              onClick={() => setOrganizing((v) => !v)}
            />
          )}
          {!organizing && <IconBarButton icon="sparkle" label="Décoration" title="Ajouter une décoration (image ou GIF)" cue="open" tint="var(--tone-pink-ink)" onClick={() => setDecorating("new")} />}
          {!organizing && <IconBarButton icon="plus" label="Nouvelle collection" cue="open" tint="var(--tone-blue-ink)" onClick={() => setEditing("new")} />}
        </IconBar>
      }
    >
      {list.length === 0 && (
        <div className="flex h-40 items-center gap-3 rounded-lg bg-white/60 px-6 text-[0.95rem] font-semibold text-ink-soft">
          <Icon name="grid" /> Rangez vos jeux comme vous voulez : « À finir », « Coop »… depuis la fiche d'un jeu (bouton Collections).
        </div>
      )}
      <motion.div
        ref={grid}
        className="grid w-full"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridAutoRows: `${geom.cell}px`,
          gap: `${geom.gap}px`,
          display: list.length ? undefined : "none",
        }}
      >
        {empty.map((s) => (
          // cases libres, visibles seulement pendant le rangement
          <div
            key={`empty-${s}`}
            aria-hidden
            className={`rounded-[1.6rem] border-2 border-dashed transition-colors ${aimed.has(s) ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-ink/15"}`}
            style={{ gridRow: Math.floor(s / cols) + 1, gridColumn: (s % cols) + 1 }}
          />
        ))}
        {shown.map((c, i) => {
          const slot = at.get(c.id)!;
          const decor = !!styles[c.id]?.decor;
          const span = spanOf(c.id);
          return (
            <GridSlot
              key={c.id}
              id={c.id}
              row={Math.floor(slot / cols) + 1}
              col={(slot % cols) + 1}
              span={span}
              organizing={organizing}
              dragging={dragId === c.id}
              highlight={dragId !== c.id && Array.from({ length: span }, (_, k) => slot + k).some((k) => aimed.has(k))}
              onStart={() => { setDragId(c.id); sound.play("open"); }}
              onMove={(x, y) => setTarget(cellAt(x, y))}
              onDrop={(x, y) => {
                const to = cellAt(x, y);
                setDragId(null);
                setTarget(null);
                return to !== null && place(c.id, to);
              }}
            >
              <div
                className={`h-full ${organizing ? "pointer-events-none" : ""} ${organizing && dragId !== c.id ? "ibox-organize-wiggle" : ""}`}
                style={organizing ? { ["--wiggle-delay" as string]: `${(i % 4) * -0.17}s` } : undefined}
              >
                {decor ? (
                  <DecorCard fill collection={c} onEdit={organizing ? undefined : () => setDecorating(c)} />
                ) : (
                  <CollectionCard
                    fill
                    collection={c}
                    items={gamesOf(c)}
                    onOpen={organizing ? undefined : () => {
                      sound.play("select");
                      setOpen(c);
                    }}
                    onEdit={organizing ? undefined : () => setEditing(c)}
                  />
                )}
              </div>
              {organizing && dragId === null && (
                // clavier et manette : déplacer d'une case à gauche ou à droite
                <div className="absolute inset-x-0 -bottom-4 flex justify-center gap-2" onPointerDownCapture={(e) => e.stopPropagation()}>
                  <button
                    data-focusable
                    aria-label={`Déplacer ${c.name} vers la gauche`}
                    disabled={slot === 0}
                    onClick={() => place(c.id, slot - 1)}
                    className="ibox-focusable ibox-chip grid size-9 place-items-center rounded-full disabled:opacity-35 [--ring-radius:999px]"
                  >
                    <Icon name="chevronRight" size="1em" className="rotate-180" />
                  </button>
                  <button
                    data-focusable
                    aria-label={`Déplacer ${c.name} vers la droite`}
                    disabled={slot + span >= rows * cols}
                    onClick={() => place(c.id, slot + 1)}
                    className="ibox-focusable ibox-chip grid size-9 place-items-center rounded-full disabled:opacity-35 [--ring-radius:999px]"
                  >
                    <Icon name="chevronRight" size="1em" />
                  </button>
                </div>
              )}
            </GridSlot>
          );
        })}
      </motion.div>
      {editing && <CollectionEditor collection={editing === "new" ? null : editing} games={editing === "new" ? [] : gamesOf(editing)} onClose={() => setEditing(null)} />}
      {decorating && <DecorEditor decor={decorating === "new" ? null : decorating} onClose={() => setDecorating(null)} />}
      <AnimatePresence>{open && <CollectionShelf key={open.id} collection={list.find((x) => x.id === open.id) ?? open} games={gamesOf(list.find((x) => x.id === open.id) ?? open)} onClose={() => setOpen(null)} />}</AnimatePresence>
    </ShelfRow>
  );
}

/** Une case de la grille : la carte elle-même suit la souris, puis atterrit en douceur dans sa nouvelle case. */
function GridSlot({ id, row, col, span, organizing, dragging, highlight, onStart, onMove, onDrop, children }: {
  id: number; row: number; col: number; span: number; organizing: boolean; dragging: boolean; highlight: boolean;
  onStart: () => void; onMove: (x: number, y: number) => void; onDrop: (x: number, y: number) => boolean; children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const from = useRef<{ left: number; top: number } | null>(null);
  const [landing, setLanding] = useState(false);
  const settle = () => {
    // vitesse remise à zéro : la carte se pose sans reprendre l'élan du geste
    const spring = { type: "spring", stiffness: 420, damping: 34, velocity: 0 } as const;
    x.jump(x.get());
    y.jump(y.get());
    void animate(x, 0, spring);
    void animate(y, 0, spring).then(() => setLanding(false));
  };
  // nouvelle case : on repart de l'endroit exact où la carte a été lâchée
  useLayoutEffect(() => {
    const start = from.current;
    const el = box.current;
    if (!start || !el) return;
    from.current = null;
    const r = el.getBoundingClientRect();
    x.jump(start.left - (r.left - x.get()));
    y.jump(start.top - (r.top - y.get()));
    settle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, col, span]);
  return (
    <motion.div
      ref={box}
      data-collection-id={id}
      layout={dragging || landing ? false : "position"}
      transition={{ layout: { type: "spring", stiffness: 420, damping: 34 } }}
      variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }}
      drag={organizing}
      dragMomentum={false}
      dragElastic={0}
      whileDrag={{ scale: 1.06, cursor: "grabbing" }}
      onDragStart={() => { setLanding(true); onStart(); }}
      onDrag={(e) => { const p = e as PointerEvent; onMove(p.clientX, p.clientY); }}
      onDragEnd={(e) => {
        const p = e as PointerEvent;
        const r = box.current?.getBoundingClientRect();
        if (r) from.current = { left: r.left, top: r.top };
        if (!onDrop(p.clientX, p.clientY)) { from.current = null; settle(); }
      }}
      className={`${organizing ? "" : "group/collection"} relative ${organizing ? "cursor-grab touch-none select-none" : ""} ${dragging || landing ? "z-50" : ""} ${dragging ? "drop-shadow-[0_24px_30px_rgba(20,30,60,0.35)]" : ""} ${highlight ? "rounded-[1.6rem] outline-4 outline-offset-4 outline-[var(--accent)]" : ""}`}
      style={{ gridRow: row, gridColumn: `${col} / span ${span}`, x, y }}
    >
      {children}
    </motion.div>
  );
}

/** Logo d'un jeu (fichier local), sinon rien. */
function GameLogo({ game, className }: { game?: Game; className?: string }) {
  const url = useMediaUrl(game ?? ({ media: [] } as unknown as Game), "logo");
  if (!game || !url) return null;
  return <img src={url} alt="" draggable={false} className={`object-contain drop-shadow-[0_3px_8px_rgba(0,0,0,0.45)] ${className ?? ""}`} />;
}
function GameHero({ game, className }: { game?: Game; className?: string }) {
  const url = useMediaUrl(game ?? ({ media: [] } as unknown as Game), "hero");
  if (!game || !url) return null;
  return <img src={url} alt="" draggable={false} className={`object-cover ${className ?? ""}`} />;
}
/** Image personnalisée d'une collection (fichier local), en URL blob. */
function useCollectionArt(id: number, kind: "logo" | "hero" | "icon", stamp?: number) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!stamp) return setUrl(null);
    let live = true;
    let made: string | null = null;
    invoke<ArrayBuffer>("collection_art_get", { id, kind }).then((b) => {
      if (!live) return;
      made = URL.createObjectURL(new Blob([b]));
      setUrl(made);
    }, () => live && setUrl(null));
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [id, kind, stamp]);
  return url;
}
const LOGO_H = { s: "h-10", m: "h-14", l: "h-20" } as const;
const SHADE = { none: 0, light: 25, medium: 45, strong: 70 } as const;

/** Texte lisible sur la couleur d'une collection. */
function inkOn(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? "#2b3445" : "#ffffff";
}
const hasMedia = (g: Game, kind: string) => (g.media ?? []).some((m) => m.kind === kind);
function styleFor(style: CollectionStyle | undefined, items: Game[]) {
  const pick = (id: number | undefined, kind: string) => items.find((g) => g.dbId === id && hasMedia(g, kind));
  return {
    logo: pick(style?.logoGameId, "logo"),
    hero: pick(style?.heroGameId, "hero") ?? items.find((g) => hasMedia(g, "hero")),
    look: style?.look ?? "fan",
  };
}

/** Carte d'une collection : fond d'un jeu, logo choisi, jaquettes en éventail. */
const cardDetails = "translate-y-1 opacity-0 transition-[opacity,translate] duration-300 ease-out group-hover/collection:translate-y-0 group-hover/collection:opacity-100 group-has-[:focus-visible]/collection:translate-y-0 group-has-[:focus-visible]/collection:opacity-100 motion-reduce:translate-y-0 motion-reduce:transition-none";
const editReveal = `${cardDetails} pointer-events-none group-hover/collection:pointer-events-auto group-has-[:focus-visible]/collection:pointer-events-auto`;

function CollectionCard({ collection: c, items, onOpen, onEdit, draft, images, fill }: { collection: Collection; items: Game[]; onOpen?: () => void; onEdit?: () => void; draft?: CollectionStyle; images?: Partial<Record<"logo" | "hero" | "icon", Pic | null>>; fill?: boolean }) {
  const savedStyle = useCollectionStyles((st) => st.styles[c.id]);
  const style = draft ?? savedStyle;
  const { logo, hero, look } = styleFor(style, items);
  const savedLogo = useCollectionArt(c.id, "logo", style?.logoStamp);
  const logoUrl = images?.logo?.thumb ?? savedLogo;
  const savedHero = useCollectionArt(c.id, "hero", style?.heroStamp);
  const heroUrl = images?.hero?.thumb ?? savedHero;
  const savedIcon = useCollectionArt(c.id, "icon", style?.iconStamp);
  const iconUrl = images?.icon?.thumb ?? savedIcon;
  if (style?.iconStamp || images?.icon) {
    // icône de licence seule : la carte prend sa forme carrée
    return (
      <>
        <button
          data-focusable={draft ? undefined : true}
          tabIndex={draft ? -1 : undefined}
          onClick={onOpen}
          onContextMenu={(e) => { e.preventDefault(); onEdit?.(); }}
          aria-label={`${c.name}, ${items.length} jeu${items.length > 1 ? "x" : ""}`}
          title={c.name}
          className={`group ibox-focusable ibox-lift relative block ${fill ? "size-full" : "size-[12.5rem]"} [--ring-radius:1.6rem]`}
        >
          {iconUrl && <img src={iconUrl} alt="" draggable={false} className="h-full w-full object-contain drop-shadow-[0_8px_14px_rgba(10,20,40,0.35)] transition-transform duration-500 group-hover:scale-105" />}
          <span className={`${cardDetails} absolute right-2.5 bottom-2.5 rounded-full px-2 py-0.5 text-[0.72rem] font-bold shadow-sm ring-2 ring-white/70`} style={{ background: c.color, color: inkOn(c.color) }}>{items.length}</span>
        </button>
        <button
          data-focusable={draft ? undefined : true}
          tabIndex={draft ? -1 : undefined}
          aria-label={`Modifier ${c.name}`}
          onClick={onEdit}
          className={`${editReveal} ibox-focusable absolute top-2.5 left-2.5 z-10 grid size-8 place-items-center rounded-full shadow-sm ring-2 ring-white/70 [--ring-radius:999px]`}
          style={{ background: c.color, color: inkOn(c.color) }}
        >
          <Icon name="gear" size={15} />
        </button>
      </>
    );
  }
  const covers = items.slice(0, look === "grid" ? 6 : 5);
  const shade = SHADE[style?.shade ?? "medium"];
  const logoH = LOGO_H[style?.logoSize ?? "m"];
  return (
    <>
      <button
        data-focusable={draft ? undefined : true}
          tabIndex={draft ? -1 : undefined}
        onClick={onOpen}
        onContextMenu={(e) => { e.preventDefault(); onEdit?.(); }}
        className={`group ibox-focusable ibox-lift relative flex ${fill ? "h-full w-full" : "h-[12.5rem] w-[19rem]"} flex-col justify-end overflow-hidden rounded-[1.6rem] text-left shadow-md [--ring-radius:1.6rem]`}
        style={{ background: `linear-gradient(150deg, ${c.color}, color-mix(in oklab, ${c.color} 60%, #1b2030))` }}
      >
        {heroUrl ? (
          // fond choisi : toujours affiché, quel que soit le style de carte
          <img src={heroUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        ) : look !== "grid" && look !== "plain" && (hero && <GameHero game={hero} className={`absolute inset-0 h-full w-full transition-transform duration-500 group-hover:scale-105 ${look === "hero" ? "opacity-100" : "opacity-45 mix-blend-luminosity"}`} />)}
        {shade > 0 && <span aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 20%, color-mix(in oklab, ${c.color} ${100 - shade}%, #0b0f1d) 100%)` }} />}
        {look === "grid" ? (
          <span className="absolute inset-x-3 top-3 grid grid-cols-6 gap-1.5">
            {covers.map((g) => <span key={g.id} className="aspect-[3/4] overflow-hidden rounded-md shadow-sm ring-1 ring-white/50"><CoverImage game={g} className="size-full" /></span>)}
          </span>
        ) : look === "fan" ? (
          <span className="absolute top-4 right-4 flex">
            {covers.map((g, i) => (
              <span
                key={g.id}
                className="-ml-6 h-[6.2rem] w-[4.5rem] overflow-hidden rounded-lg shadow-lg ring-2 ring-white/85 transition-transform duration-300 group-hover:-translate-y-1"
                style={{ zIndex: 10 - i, transform: `rotate(${(i - (covers.length - 1) / 2) * 7}deg) translateY(${Math.abs(i - (covers.length - 1) / 2) * 5}px)` }}
              >
                <CoverImage game={g} className="size-full" />
              </span>
            ))}
          </span>
        ) : null}
        <span className="relative flex items-end gap-3 p-4">
          <span className="min-w-0 flex-1">
            {logoUrl ? <img src={logoUrl} alt="" draggable={false} className={`mb-1 ${logoH} max-w-[12rem] object-contain object-left drop-shadow-[0_3px_8px_rgba(0,0,0,0.45)]`} />
              : logo ? <GameLogo game={logo} className={`mb-1 ${logoH} max-w-[12rem] object-left`} /> : null}
            {!style?.hideName && <span data-no-i18n className="block truncate font-display text-[1.3rem] text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)]">{c.name}</span>}
          </span>
          <span className={`${cardDetails} shrink-0 rounded-full px-2.5 py-1 text-[0.78rem] font-bold shadow-sm ring-2 ring-white/70`} style={{ background: c.color, color: inkOn(c.color) }}>
            {`${items.length} jeu${items.length > 1 ? "x" : ""}`}
          </span>
        </span>
      </button>
      <button
        data-focusable={draft ? undefined : true}
          tabIndex={draft ? -1 : undefined}
        aria-label={`Modifier ${c.name}`}
        onClick={onEdit}
        className={`${editReveal} ibox-focusable absolute top-2.5 left-2.5 z-10 grid size-8 place-items-center rounded-full shadow-sm ring-2 ring-white/70 [--ring-radius:999px]`}
          style={{ background: c.color, color: inkOn(c.color) }}
      >
        <Icon name="gear" size={15} />
      </button>
    </>
  );
}

function CollectionEditor({ collection, games, onClose }: { collection: Collection | null; games: Game[]; onClose: () => void }) {
  const { create, update, remove, list } = useCollections();
  const { styles, setStyle } = useCollectionStyles();
  const [style, setLocalStyle] = useState<CollectionStyle>(collection ? (styles[collection.id] ?? {}) : {});
  const all = useLibrary((s) => s.realGames);
  const displayedGames = style.rule ? all.filter((game) => matchesSmartRule(style.rule!, game)) : games;
  const logos = displayedGames.filter((g) => hasMedia(g, "logo"));
  const heroes = displayedGames.filter((g) => hasMedia(g, "hero"));
  const [name, setName] = useState(collection?.name ?? "");
  const [color, setColor] = useState(collection?.color ?? COLLECTION_COLORS[list.length % COLLECTION_COLORS.length]);
  const [images, setImages] = useState<Partial<Record<"logo" | "hero" | "icon", Pic | null>>>({});
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const createdId = useRef<number>(undefined);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"look" | "content" | "icon">(style.iconStamp ? "icon" : "look");
  const [searching, setSearching] = useState<"logo" | "hero" | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (confirm || deleting || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      if (style.rule && ["genre", "platform"].includes(style.rule.kind) && !style.rule.value.trim()) {
        setError("Précisez le critère de la collection.");
        return;
      }
      const existingId = collection?.id ?? createdId.current;
      const id = existingId ?? await create(name, color);
      createdId.current = id;
      if (existingId !== undefined) await update(id, name, color);
      const next = { ...style };
      for (const kind of ["icon", "logo", "hero"] as const) {
        const image = images[kind];
        if (!image) continue;
        // image d'origine, sinon sa version allégée (fichiers très lourds)
        try { await invoke("collection_art_set", { id, kind, url: image.url }); }
        catch (err) { if (!image.thumb || image.thumb === image.url) throw err; await invoke("collection_art_set", { id, kind, url: image.thumb }); }
        next[`${kind}Stamp`] = Date.now();
      }
      setStyle(id, next);
      sound.play("select");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { submitting.current = false; setSaving(false); }
  };
  const iconMode = Boolean(style.iconStamp || images.icon);
  const clearIcon = () => { setImages((old) => ({ ...old, icon: null })); setLocalStyle({ ...style, iconStamp: undefined }); };
  const hasLogo = Boolean(style.logoGameId || style.logoStamp || images.logo);
  const rules: { kind: SmartRule["kind"] | ""; label: string; icon: IconName }[] = [
    { kind: "", label: "À la main", icon: "gamepad" },
    { kind: "unplayed", label: "Jamais lancés", icon: "play" },
    { kind: "multiplayer", label: "Multijoueur", icon: "user" },
    { kind: "genre", label: "Par genre", icon: "tune" },
    { kind: "platform", label: "Par console", icon: "disc" },
  ];
  return (
    <Modal title={collection ? "Modifier la collection" : "Nouvelle collection"} onClose={() => { if (!saving) onClose(); }} width="38rem">
      <form onSubmit={save} className="flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            data-focusable
            data-autofocus
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom (ex. À finir)"
            aria-label="Nom de la collection"
            className="ibox-focusable h-12 min-w-0 flex-1 rounded-full bg-cream-deep px-5 font-bold text-ink [--ring-radius:999px]"
          />
          <button type="button" data-focusable aria-pressed={!style.hideName} aria-label={style.hideName ? "Afficher le nom" : "Masquer le nom"} title={style.hideName ? "Afficher le nom" : "Masquer le nom"} onClick={() => setLocalStyle({ ...style, hideName: !style.hideName })} className="ibox-focusable grid size-12 place-items-center rounded-full bg-cream-deep text-ink [--ring-radius:999px]">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{style.hideName && <path d="M3 3l18 18"/>}</svg>
          </button>
        </div>
        {/* aperçu toujours visible pendant les réglages */}
        <div className="sticky top-0 z-20 -mx-1 grid justify-items-center gap-2.5 rounded-2xl bg-cream-deep px-1 pt-3 pb-2.5 shadow-md">
          <div inert className="group/collection relative max-w-full">
            <CollectionCard collection={{ id: collection?.id ?? 0, name: name || "Nouvelle collection", color, gameIds: [] }} items={displayedGames} draft={style} images={images} />
          </div>
          <div className="flex justify-center">
            <Segmented
              label="Sections de la collection"
              value={tab}
              onChange={setTab}
              options={[
                { value: "look", label: "Apparence", icon: "sparkle" },
                { value: "content", label: "Contenu", icon: "gamepad" },
                { value: "icon", label: "Icône", icon: "star" },
              ]}
            />
          </div>
        </div>

        {tab === "content" && (
          <EditorSection icon="gamepad" tone="#98ddb6" label="Jeux">
            <ChipRow>
              {rules.map((r) => (
                <Chip key={r.kind} active={(style.rule?.kind ?? "") === r.kind} onClick={() => setLocalStyle({ ...style, rule: r.kind ? { kind: r.kind, value: "" } : undefined })}>
                  <Icon name={r.icon} size={16} /><span className="ml-1.5">{r.label}</span>
                </Chip>
              ))}
            </ChipRow>
            {style.rule?.kind === "genre" && (
              <div className="flex flex-wrap gap-2">
                <input data-focusable aria-label="Genre" placeholder="Ex. RPG" className="ibox-focusable h-10 min-w-0 flex-1 rounded-full bg-white px-4 font-bold text-ink [--ring-radius:999px]" value={style.rule.value}
                  onChange={(event) => setLocalStyle({ ...style, rule: { ...style.rule, kind: "genre", value: event.target.value } })} />
                <select data-focusable aria-label="Boutique du genre" className="ibox-focusable h-10 rounded-full bg-white px-4 font-bold text-ink [--ring-radius:999px]"
                  value={style.rule.source ?? ""} onChange={(event) => setLocalStyle({ ...style, rule: { ...style.rule!, source: event.target.value } })}>
                  <option value="">Toutes les boutiques</option><option value="steam">Steam</option>
                </select>
              </div>
            )}
            {style.rule?.kind === "platform" && (
              <select data-focusable aria-label="Console ou boutique" className="ibox-focusable h-10 rounded-full bg-white px-4 font-bold text-ink [--ring-radius:999px]" value={style.rule.value}
                onChange={(event) => setLocalStyle({ ...style, rule: { kind: "platform", value: event.target.value } })}>
                <option value="">Choisir…</option><option value="steam">Steam</option>
                {PLATFORMS.map((platform) => <option key={platform.id} value={platform.id}>{platform.name}</option>)}
              </select>
            )}
          </EditorSection>
        )}

        {tab === "look" && iconMode && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-cream-deep/60 p-3.5">
            <span className="flex items-center gap-2 font-bold text-ink"><ToneDot icon="star" tone="#f5d27a" />Icône de licence</span>
            <Button type="button" icon="x" onClick={clearIcon}>Retirer l’icône</Button>
          </div>
        )}

        {tab === "look" && !iconMode && (
          <>
            <EditorSection icon="shelf" tone="#8ecdf0" label="Style">
              <ChipRow>
                {(["fan", "hero", "grid", "plain"] as const).map((k) => (
                  <Chip key={k} active={(style.look ?? "fan") === k} onClick={() => setLocalStyle({ ...style, look: k })}>
                    {k === "fan" ? "Éventail" : k === "hero" ? "Grande image" : k === "grid" ? "Mosaïque" : "Sans jaquettes"}
                  </Chip>
                ))}
              </ChipRow>
            </EditorSection>
            <EditorSection icon="sparkle" tone="#f3a5c8" label="Couleur">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Couleur">
                {COLLECTION_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    data-focusable
                    role="radio"
                    aria-checked={c === color}
                    aria-label={c}
                    onClick={() => setColor(c)}
                    className={`ibox-focusable size-8 rounded-full transition-transform [--ring-radius:999px] ${c === color ? "scale-110 ring-[3px] ring-white" : ""}`}
                    style={{ background: c }}
                  />
                ))}
                <label className="ibox-focusable relative grid size-8 cursor-pointer place-items-center rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)] [--ring-radius:999px]" title="Couleur libre">
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Couleur libre" className="absolute inset-0 cursor-pointer opacity-0" />
                </label>
              </div>
            </EditorSection>
            <EditorSection icon="star" tone="#f5d27a" label="Logo">
              <ChipRow>
                <Chip active={!hasLogo} onClick={() => { setImages((old) => ({ ...old, logo: null })); setLocalStyle({ ...style, logoGameId: undefined, logoStamp: undefined }); }}>Aucun</Chip>
                {collection && style.logoStamp && !images.logo && <Chip active onClick={() => undefined}><CustomPreview id={collection.id} kind="logo" stamp={style.logoStamp} /></Chip>}
                {images.logo && <Chip active onClick={() => undefined}><span className="block h-9 w-24 rounded-md bg-[#2b3445] p-1"><img src={images.logo.thumb} alt="" className="h-full w-full object-contain" /></span></Chip>}
                {logos.map((g) => (
                  <Chip key={g.id} active={!style.logoStamp && !images.logo && style.logoGameId === g.dbId} onClick={() => { setImages((old) => ({ ...old, logo: null })); setLocalStyle({ ...style, logoGameId: g.dbId, logoStamp: undefined }); }} title={g.title}>
                    <span className="block h-9 w-24 rounded-md bg-[#2b3445] p-1"><GameLogo game={g} className="h-full w-full" /></span>
                  </Chip>
                ))}
                <SearchChip open={searching === "logo"} onClick={() => setSearching(searching === "logo" ? null : "logo")} />
              </ChipRow>
              {searching === "logo" && <ArtSearch kind="logo" onPicked={(image) => { setImages((old) => ({ ...old, logo: image })); setSearching(null); }} />}
              {hasLogo && (
                <SubRow label="Taille">
                  {(["s", "m", "l"] as const).map((k) => (
                    <Chip key={k} active={(style.logoSize ?? "m") === k} onClick={() => setLocalStyle({ ...style, logoSize: k })}>{k === "s" ? "Petit" : k === "m" ? "Moyen" : "Grand"}</Chip>
                  ))}
                </SubRow>
              )}
            </EditorSection>
            <EditorSection icon="front" tone="#bba6ec" label="Fond">
              <ChipRow>
                <Chip active={!style.heroGameId && !style.heroStamp && !images.hero} onClick={() => { setImages((old) => ({ ...old, hero: null })); setLocalStyle({ ...style, heroGameId: undefined, heroStamp: undefined }); }}>Automatique</Chip>
                {collection && style.heroStamp && !images.hero && <Chip active onClick={() => undefined}><CustomPreview id={collection.id} kind="hero" stamp={style.heroStamp} /></Chip>}
                {images.hero && <Chip active onClick={() => undefined}><span className="block h-9 w-20 overflow-hidden rounded-md"><img src={images.hero.thumb} alt="" className="h-full w-full object-cover" /></span></Chip>}
                {heroes.map((g) => (
                  <Chip key={g.id} active={!style.heroStamp && !images.hero && style.heroGameId === g.dbId} onClick={() => { setImages((old) => ({ ...old, hero: null })); setLocalStyle({ ...style, heroGameId: g.dbId, heroStamp: undefined }); }} title={g.title}>
                    <span className="block h-9 w-20 overflow-hidden rounded-md"><GameHero game={g} className="h-full w-full" /></span>
                  </Chip>
                ))}
                <SearchChip open={searching === "hero"} onClick={() => setSearching(searching === "hero" ? null : "hero")} />
              </ChipRow>
              {searching === "hero" && <ArtSearch kind="hero" onPicked={(image) => { setImages((old) => ({ ...old, hero: image })); setSearching(null); }} />}
              <SubRow label="Dégradé">
                {(["none", "light", "medium", "strong"] as const).map((k) => (
                  <Chip key={k} active={(style.shade ?? "medium") === k} onClick={() => setLocalStyle({ ...style, shade: k })}>{k === "none" ? "Aucun" : k === "light" ? "Léger" : k === "medium" ? "Moyen" : "Fort"}</Chip>
                ))}
              </SubRow>
            </EditorSection>
          </>
        )}

        {tab === "icon" && (
          <EditorSection icon="star" tone="#f5d27a" label="Icône de licence">
            <ChipRow>
              <Chip active={!iconMode} onClick={clearIcon}>Aucune</Chip>
              {collection && style.iconStamp && !images.icon && <Chip active onClick={() => undefined}><CustomPreview id={collection.id} kind="icon" stamp={style.iconStamp} /></Chip>}
              {images.icon && <Chip active onClick={() => undefined}><span className="block size-9"><img src={images.icon.thumb} alt="" className="h-full w-full object-contain" /></span></Chip>}
            </ChipRow>
            <IconSearch onPicked={(image) => setImages((old) => ({ ...old, icon: image }))} />
          </EditorSection>
        )}

        <div className="mt-1 flex flex-wrap justify-between gap-2">
          {collection ? (
            confirm ? (
              <Button
                type="button"
                icon="x"
                cue="back"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  setError(null);
                  try {
                    await remove(collection.id);
                    onClose();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                    setDeleting(false);
                  }
                }}
              >
                Confirmer (les jeux restent)
              </Button>
            ) : (
              <Button type="button" icon="trash" cue="back" onClick={() => setConfirm(true)}>
                Supprimer
              </Button>
            )
          ) : (
            <span />
          )}
          <Button variant="primary" type="submit" icon="check" disabled={!name.trim() || confirm || saving}>
            Enregistrer
          </Button>
        </div>
        {error && <p role="alert" className="text-[0.85rem] font-bold text-peach-deep">{error}</p>}
      </form>
    </Modal>
  );
}

/** Pastille colorée qui identifie une section. */
function ToneDot({ icon, tone }: { icon: IconName; tone: string }) {
  return <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full text-[#1b2030]" style={{ background: tone }}><Icon name={icon} size={15} /></span>;
}
function EditorSection({ icon, tone, label, children }: { icon: IconName; tone: string; label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-2xl bg-cream-deep/60 p-3.5" style={{ boxShadow: `inset 3px 0 0 ${tone}` }}>
      <h3 className="flex items-center gap-2 text-[0.95rem] font-extrabold text-ink"><ToneDot icon={icon} tone={tone} />{label}</h3>
      {children}
    </section>
  );
}
function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto p-0.5">{children}</div>;
}
function SubRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[0.72rem] font-bold tracking-[0.12em] text-ink-soft uppercase">{label}</span>
      {children}
    </div>
  );
}
function SearchChip({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <Chip active={open} onClick={onClick} title={open ? "Fermer la recherche" : "Chercher en ligne"}>
      <Icon name={open ? "x" : "search"} size={16} /><span className="ml-1.5">{open ? "Fermer la recherche" : "Chercher en ligne"}</span>
    </Chip>
  );
}
function Chip({ active, onClick, title, children }: { active: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button type="button" data-focusable title={title} aria-pressed={active} onClick={onClick}
      className={`ibox-focusable flex min-h-10 items-center rounded-xl px-2.5 text-[0.85rem] font-bold [--ring-radius:0.75rem] ${active ? "bg-[var(--accent-soft)] text-ink ring-2 ring-[var(--accent)]" : "bg-cream-deep text-ink-soft"}`}>
      {children}
    </button>
  );
}

/** La collection sur l'étagère 3D, par-dessus l'accueil. */
function CollectionShelf({ collection, games, onClose }: { collection: Collection; games: Game[]; onClose: () => void }) {
  const smart = useCollectionStyles((state) => !!state.styles[collection.id]?.rule);
  const reduced = useReducedMotion();
  const dark = useIsDark();
  const go = useNav((s) => s.go);
  const [editing, setEditing] = useState(false);
  const [ordering, setOrdering] = useState(false);
  useEffect(() => {
    if (editing || ordering) return;
    const off = input.onBack(() => {
      onClose();
      return true;
    });
    const id = requestAnimationFrame(() => input.focusInitial());
    return () => {
      off();
      cancelAnimationFrame(id);
    };
  }, [onClose, editing, ordering]);
  return createPortal(
    <motion.div
      data-nav-root
      className="fixed inset-0 z-40 flex flex-col bg-[#07070c] p-6"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25 }}
    >
      <div className="flex items-center gap-4 pb-4 text-[#f3f5fb]">
        <button
          data-focusable
          aria-label="Fermer"
          onClick={onClose}
          className="ibox-focusable grid size-11 place-items-center rounded-full bg-white/10 [--ring-radius:999px]"
        >
          <Icon name="back" />
        </button>
        <span className="size-3 rounded-full" style={{ background: collection.color }} />
        <ShelfTitle collection={collection} games={games} />
        <span className="text-[0.9rem] font-bold text-white/60">
          {`${games.length} jeu${games.length > 1 ? "x" : ""}`}
        </span>
        <span className="flex-1" />
        {games.length > 1 && <button data-focusable onClick={() => setOrdering(true)} className="ibox-focusable flex h-11 items-center gap-2 rounded-full bg-white/12 px-4 text-[0.92rem] font-bold [--ring-radius:999px] hover:bg-white/20">↕ Ordre des jeux</button>}
        {!smart && <button
          data-focusable
          onClick={() => { sound.play("open"); setEditing(true); }}
          className="ibox-focusable flex h-11 items-center gap-2 rounded-full bg-white/12 px-4 text-[0.92rem] font-bold [--ring-radius:999px] hover:bg-white/20"
        >
          <Icon name="plus" size="1em" />
          Modifier les jeux
        </button>}
      </div>
      {editing && <GamesEditor collection={collection} onClose={() => setEditing(false)} />}
      {ordering && <OrderEditor collection={collection} games={games} onClose={() => setOrdering(false)} />}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl">
        {games.length === 0 ? (
          <div className="grid h-full place-items-center text-[1rem] font-bold text-white/60">{smart ? "Aucun jeu ne correspond au critère." : "Collection vide : ajoutez des jeux avec « Modifier les jeux »."}</div>
        ) : <ShelfView
          games={games}
          mixed
          reduced={reduced}
          dark={dark}
          onOpen={(g) => {
            onClose();
            go({ name: "game", gameId: g.id });
          }}
        />}
      </div>
    </motion.div>,
    document.body,
  );
}

function ShelfTitle({ collection, games }: { collection: Collection; games: Game[] }) {
  const style = useCollectionStyles((st) => st.styles[collection.id]);
  const { logo } = styleFor(style, games);
  return logo ? (
    <span className="flex items-center gap-3">
      <GameLogo game={logo} className="h-12 max-w-[14rem]" />
      <h2 data-no-i18n className="font-display text-[1.4rem] text-white/80">{collection.name}</h2>
    </span>
  ) : (
    <h2 data-no-i18n className="font-display text-[1.8rem] font-semibold">{collection.name}</h2>
  );
}

function CustomPreview({ id, kind, stamp }: { id: number; kind: "logo" | "hero" | "icon"; stamp: number }) {
  const url = useCollectionArt(id, kind, stamp);
  return (
    <span className={`block h-9 overflow-hidden rounded-md ${kind === "logo" ? "w-24 bg-[#2b3445] p-1" : kind === "icon" ? "w-9 !overflow-visible" : "w-20"}`}>
      {url && <img src={url} alt="" className={`h-full w-full ${kind === "hero" ? "object-cover" : "object-contain"}`} />}
    </span>
  );
}

interface Found { id: number; name: string; year?: number | null }
interface Pic { url: string; thumb: string }
/** Recherche d'un logo (iiDB ou SteamGridDB) ou d'un fond (SteamGridDB) pour une collection. */
function ArtSearch({ kind, onPicked }: { kind: "logo" | "hero"; onPicked: (image: Pic) => void }) {
  const [source, setSource] = useState<"iidb" | "sgdb">(kind === "logo" ? "iidb" : "sgdb");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [pics, setPics] = useState<Pic[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(f: () => Promise<T>) => {
    setBusy(true);
    setError(null);
    try { return await f(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const search = () => run(async () => {
    setPics(null);
    const r = source === "iidb"
      ? await invoke<Found[]>("collection_iidb_search", { q })
      : (await invoke<{ id: number; name: string }[]>("avatar_steam_search", { query: q }));
    setFound(r);
  });
  const open = (f: Found) => run(async () => {
    const r = source === "iidb"
      ? (await invoke<{ url: string; thumbnail_url?: string | null }[]>("collection_iidb_logos", { parentId: f.id })).map((a) => ({ url: a.url, thumb: a.thumbnail_url ?? a.url }))
      : await invoke<Pic[]>("collection_sgdb_images", { id: f.id, kind });
    setPics(r);
  });
  const pick = (p: Pic) => run(async () => {
    sound.play("select");
    onPicked(p);
  });
  return (
    <div className="rounded-2xl bg-cream-deep/60 p-3">
      {kind === "logo" && (
        <div className="mb-2 flex gap-2">
          {(["iidb", "sgdb"] as const).map((k) => (
            <Chip key={k} active={source === k} onClick={() => { setSource(k); setFound(null); setPics(null); }}>{k === "iidb" ? "iiDB" : "SteamGridDB"}</Chip>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          data-focusable
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }}
          placeholder={kind === "logo" ? "Licence ou jeu (ex. Zelda, Mario)" : "Jeu (ex. Hollow Knight)"}
          aria-label={kind === "logo" ? "Chercher un logo" : "Chercher un fond"}
          className="ibox-focusable h-10 min-w-0 flex-1 rounded-full bg-white px-4 font-bold text-ink [--ring-radius:999px]"
        />
        <Button type="button" icon="search" disabled={busy || q.trim().length < 2} onClick={() => void search()}>Chercher</Button>
      </div>
      {error && <p role="alert" className="mt-2 text-[0.8rem] font-bold text-peach-deep">{error}</p>}
      {found && !pics && (
        <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
          {found.length === 0 && <p className="text-[0.85rem] text-ink-soft">Aucun résultat.</p>}
          {found.map((f) => (
            <Chip key={f.id} active={false} onClick={() => void open(f)}>
              <span data-no-i18n>{f.name}{f.year ? ` (${f.year})` : ""}</span>
            </Chip>
          ))}
        </div>
      )}
      {pics && (
        <div className="mt-2">
          <button type="button" data-focusable onClick={() => setPics(null)} className="ibox-focusable mb-1.5 text-[0.8rem] font-bold text-accent-text">← Résultats</button>
          {pics.length === 0 ? <p className="text-[0.85rem] text-ink-soft">Aucune image pour ce jeu.</p> : (
            <div className={`grid max-h-48 gap-2 overflow-y-auto ${kind === "logo" ? "grid-cols-3" : "grid-cols-2"}`}>
              {pics.map((p) => (
                <button key={p.url} type="button" data-focusable disabled={busy} onClick={() => void pick(p)}
                  className={`ibox-focusable overflow-hidden rounded-lg [--ring-radius:0.5rem] ${kind === "logo" ? "h-16 bg-[#2b3445] p-1.5" : "aspect-[96/31]"}`}>
                  <img src={p.thumb} alt="" loading="lazy" className={`h-full w-full ${kind === "logo" ? "object-contain" : "object-cover"}`} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface Licence { id: number; name: string; iconUrl?: string | null; games?: number | null }
interface IconPage { icons: Pic[]; nextOffset: number | null }

function IconSearch({ onPicked }: { onPicked: (image: Pic) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Licence[] | null>(null);
  const [pics, setPics] = useState<Pic[] | null>(null);
  const [catalogue, setCatalogue] = useState<IconPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await f(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const search = () => {
    if (busy || !q.trim()) return;
    void run(async () => {
      const results = await invoke<Licence[]>("collection_iidb_collections", { q });
      setCatalogue(null);
      setPics(null);
      setFound(results);
    });
  };
  const browse = (offset: number) => run(async () => {
    const page = await invoke<IconPage>("collection_iidb_browse", { offset });
    setCatalogue((previous) => ({
      icons: offset && previous ? [...previous.icons, ...page.icons.filter((icon) => !previous.icons.some((p) => p.url === icon.url))] : page.icons,
      nextOffset: page.nextOffset,
    }));
  });
  const open = (l: Licence) => run(async () => {
    const r = await invoke<{ url: string; thumbnail_url?: string | null }[]>("collection_iidb_icons", { collectionId: l.id });
    setPics(r.map((a) => ({ url: a.url, thumb: a.thumbnail_url ?? a.url })));
  });
  const pick = (p: Pic) => run(async () => {
    sound.play("select");
    onPicked(p);
  });
  const visibleIcons = catalogue?.icons ?? pics;
  const nextOffset = catalogue?.nextOffset;
  return (
    <div className="rounded-2xl bg-cream-deep/60 p-3">
      <div className="flex flex-wrap gap-2">
        <input
          data-focusable
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }}
          placeholder="Licence (ex. Mario, Pokémon, Zelda)"
          aria-label="Chercher une icône de licence"
          className="ibox-focusable h-10 min-w-0 flex-1 rounded-full bg-white px-4 font-bold text-ink [--ring-radius:999px]"
        />
        <Button type="button" icon="search" disabled={busy || !q.trim()} onClick={search}>Chercher</Button>
        <Button type="button" icon="grid" disabled={busy} onClick={() => catalogue ? setCatalogue(null) : void browse(0)}>
          {catalogue ? "Fermer le catalogue" : "Parcourir les icônes iiDB"}
        </Button>
      </div>
      {busy && <p role="status" className="mt-2 text-[0.8rem] text-ink-soft">Chargement…</p>}
      {error && <p role="alert" className="mt-2 text-[0.8rem] font-bold text-peach-deep">{error}</p>}
      {!catalogue && found && !pics && (
        <div className="mt-2 grid max-h-52 grid-cols-4 gap-2 overflow-y-auto">
          {found.length === 0 && <p className="col-span-4 text-[0.85rem] text-ink-soft">Aucun résultat.</p>}
          {found.map((l) => (
            <button key={l.id} type="button" data-focusable disabled={busy} onClick={() => void open(l)} title={l.name}
              className="ibox-focusable flex flex-col items-center gap-1 rounded-xl bg-white p-1.5 [--ring-radius:0.75rem]">
              {l.iconUrl ? <img src={l.iconUrl} alt="" loading="lazy" className="aspect-square w-full object-contain" /> : <span className="grid aspect-square w-full place-items-center rounded-lg bg-cream-deep"><Icon name="grid" /></span>}
              <span data-no-i18n className="w-full truncate text-center text-[0.72rem] font-bold text-ink">{l.name}</span>
            </button>
          ))}
        </div>
      )}
      {visibleIcons && (
        <div className="mt-2">
          {!catalogue && <button type="button" data-focusable disabled={busy} onClick={() => setPics(null)} className="ibox-focusable mb-1.5 text-[0.8rem] font-bold text-accent-text">← Résultats</button>}
          {visibleIcons.length === 0 ? <p className="text-[0.85rem] text-ink-soft">{catalogue ? "Aucun résultat." : "Aucune icône pour cette licence."}</p> : (
            <div className="grid max-h-52 grid-cols-5 gap-2 overflow-y-auto">
              {visibleIcons.map((p) => (
                <button key={p.url} type="button" data-focusable disabled={busy} onClick={() => void pick(p)}
                  aria-label="Utiliser cette icône"
                  className="ibox-focusable aspect-square [--ring-radius:0.75rem]">
                  <img src={p.thumb} alt="" loading="lazy" className="h-full w-full object-contain" />
                </button>
              ))}
            </div>
          )}
          {nextOffset != null && (
            <div className="mt-2">
              <Button type="button" disabled={busy} onClick={() => void browse(nextOffset)}>Afficher plus d’icônes</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OrderEditor({ collection, games, onClose }: { collection: Collection; games: Game[]; onClose: () => void }) {
  const [ordered, setOrdered] = useState(games);
  const setStyle = useCollectionStyles((s) => s.setStyle);
  const move = (index: number, delta: number) => setOrdered((old) => {
    const next = [...old];
    const target = index + delta;
    if (target < 0 || target >= next.length) return old;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  return <Modal title="Ordre des jeux" onClose={onClose} width="38rem">
    <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
      {ordered.map((game, index) => <div key={game.id} className="flex items-center gap-2 rounded-xl bg-cream-deep p-2">
        <span data-no-i18n className="min-w-0 flex-1 truncate font-bold">{game.title}</span>
        <button type="button" data-focusable disabled={index === 0} aria-label={`Monter ${game.title}`} onClick={() => move(index, -1)} className="ibox-focusable rounded-full bg-white px-3 py-1 disabled:opacity-30">↑</button>
        <button type="button" data-focusable disabled={index === ordered.length - 1} aria-label={`Descendre ${game.title}`} onClick={() => move(index, 1)} className="ibox-focusable rounded-full bg-white px-3 py-1 disabled:opacity-30">↓</button>
      </div>)}
    </div>
    <div className="mt-4 flex justify-end"><Button variant="primary" icon="check" onClick={() => { setStyle(collection.id, { ...useCollectionStyles.getState().styles[collection.id], gameOrder: ordered.map((g) => g.dbId!).filter((id) => id !== undefined) }); onClose(); }}>Enregistrer</Button></div>
  </Modal>;
}

/** Ajouter ou retirer des jeux, directement depuis la collection ouverte. */
function GamesEditor({ collection, onClose }: { collection: Collection; onClose: () => void }) {
  const all = useLibrary((s) => s.realGames);
  const setGame = useCollections((s) => s.setGame);
  const [q, setQ] = useState("");
  const [onlyIn, setOnlyIn] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const members = new Set(collection.gameIds);
  const needle = q.trim().toLowerCase();
  const shown = all
    .filter((g) => g.dbId !== undefined && (!onlyIn || members.has(g.dbId)) && (!needle || g.title.toLowerCase().includes(needle)))
    .sort((a, b) => Number(members.has(b.dbId!)) - Number(members.has(a.dbId!)) || a.title.localeCompare(b.title))
    .slice(0, 300);
  const toggle = async (g: Game) => {
    const id = g.dbId!;
    setBusy(id);
    try {
      await setGame(collection.id, id, !members.has(id));
      sound.play(members.has(id) ? "back" : "select");
    } finally { setBusy(null); }
  };
  return (
    <Modal title={`Jeux de « ${collection.name} »`} onClose={onClose} width="44rem">
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            data-focusable
            data-autofocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Chercher un jeu"
            aria-label="Chercher un jeu"
            className="ibox-focusable h-11 min-w-0 flex-1 rounded-full bg-cream-deep px-5 font-bold text-ink [--ring-radius:999px]"
          />
          <Button type="button" icon={onlyIn ? "check" : "grid"} onClick={() => setOnlyIn((v) => !v)}>{onlyIn ? "Dans la collection" : "Tous les jeux"}</Button>
        </div>
        <p className="text-[0.82rem] font-bold text-ink-soft">{`${members.size} jeu${members.size > 1 ? "x" : ""} dans la collection · cliquez pour ajouter ou retirer`}</p>
        <div className="grid max-h-[55vh] grid-cols-[repeat(auto-fill,minmax(6.2rem,1fr))] gap-3 overflow-y-auto p-1">
          {shown.map((g) => {
            const inside = members.has(g.dbId!);
            return (
              <button
                key={g.id}
                type="button"
                data-focusable
                aria-pressed={inside}
                disabled={busy === g.dbId}
                onClick={() => void toggle(g)}
                title={g.title}
                className={`ibox-focusable relative flex flex-col gap-1 rounded-xl p-1 text-left [--ring-radius:0.75rem] ${inside ? "bg-[var(--accent-soft)] ring-2 ring-[var(--accent)]" : "bg-cream-deep/60 opacity-75 hover:opacity-100"}`}
              >
                <span className="flex aspect-[3/4] items-end justify-center"><CoverImage game={g} rounded="rounded-lg" className="w-full shadow-sm" /></span>
                <span data-no-i18n className="truncate text-[0.72rem] font-bold text-ink">{g.title}</span>
                <span className={`absolute top-2 right-2 grid size-6 place-items-center rounded-full shadow-sm ${inside ? "bg-[var(--accent)] text-white" : "bg-white/90 text-ink-soft"}`}>
                  <Icon name={inside ? "check" : "plus"} size="0.8em" />
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end">
          <Button variant="primary" icon="check" onClick={onClose}>Terminé</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Décoration de l'accueil : une image ou un GIF seul, détouré, sans cadre. */
/** Place occupée par l'image dans sa case : une incrustation discrète, jamais envahissante. */
const DECOR_SCALE = { s: 0.5, m: 0.68, l: 0.86 } as const;
type DecorSize = keyof typeof DECOR_SCALE;

function DecorCard({ collection: c, onEdit, preview, fill, size }: { collection: Collection; onEdit?: () => void; preview?: string | null; fill?: boolean; size?: DecorSize }) {
  const stamp = useCollectionStyles((st) => st.styles[c.id]?.iconStamp);
  const savedSize = useCollectionStyles((st) => st.styles[c.id]?.decorSize);
  const scale = `${DECOR_SCALE[size ?? savedSize ?? "m"] * 100}%`;
  const saved = useCollectionArt(c.id, "icon", preview === undefined ? stamp : undefined);
  const url = preview === undefined ? saved : preview;
  const [pixel, setPixel] = useState(false);
  const live = !!onEdit;
  return (
    <>
      <motion.button
        type="button"
        data-focusable={live ? true : undefined}
        tabIndex={live ? undefined : -1}
        aria-label={c.name}
        title={live ? c.name : undefined}
        whileTap={{ scale: 0.9, rotate: -4 }}
        onClick={() => live && sound.play("select")}
        onContextMenu={(e) => { e.preventDefault(); onEdit?.(); }}
        className={`group ibox-focusable relative flex ${fill ? "size-full" : "size-[12.5rem]"} items-center justify-center [--ring-radius:1.6rem]`}
      >
        {url ? (
          <img
            src={url}
            alt=""
            draggable={false}
            // petit sprite (pixel art) : agrandi net, sans flou
            onLoad={(e) => setPixel(Math.max(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight) <= 160)}
            style={{ width: scale, height: scale, imageRendering: pixel ? "pixelated" : undefined }}
            className="object-contain drop-shadow-[0_8px_12px_rgba(10,20,40,0.28)] transition-[scale] duration-300 group-hover:scale-105"
          />
        ) : (
          <span className="grid size-full place-items-center rounded-[1.6rem] border-2 border-dashed border-ink/20 text-ink-soft"><Icon name="sparkle" size="2.4rem" /></span>
        )}
      </motion.button>
      {onEdit && (
        <button
          data-focusable
          aria-label={`Modifier ${c.name}`}
          onClick={onEdit}
          className={`${editReveal} ibox-focusable absolute top-2.5 left-2.5 z-10 grid size-8 place-items-center rounded-full bg-white text-ink shadow-sm ring-2 ring-white/70 [--ring-radius:999px]`}
        >
          <Icon name="gear" size={15} />
        </button>
      )}
    </>
  );
}

const pokemonId = (name: string) => {
  const raw = name.trim().toLowerCase();
  const known = POKEMON.find(([fr, en]) => fr.toLowerCase() === raw || en === raw);
  return known ? known[1] : raw.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\s.'’:]/g, "");
};

function PokemonPicker({ onPicked }: { onPicked: (url: string) => void }) {
  const [q, setQ] = useState("");
  const [id, setId] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const choose = (value: string) => { setMissing([]); setId(pokemonId(value)); };
  const variants = id ? pokemonImages(id, POKEMON.find((p) => p[1] === id)?.[2]) : [];
  const visible = variants.filter((v) => !missing.includes(v.url));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          data-focusable
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) { e.preventDefault(); choose(q); } }}
          placeholder="Pokémon (ex. Pikachu, Évoli, Lucario)"
          aria-label="Chercher un Pokémon"
          className="ibox-focusable h-10 min-w-0 flex-1 rounded-full bg-white px-4 font-bold text-ink [--ring-radius:999px]"
        />
        <Button type="button" icon="search" disabled={!q.trim()} onClick={() => choose(q)}>Chercher</Button>
      </div>
      {id ? (
        <div>
          <button type="button" data-focusable onClick={() => setId(null)} className="ibox-focusable mb-1.5 text-[0.8rem] font-bold text-accent-text">← Populaires</button>
          {visible.length === 0 ? <p className="text-[0.85rem] text-ink-soft">{`Aucune image pour « ${q || id} ». Essayez son nom anglais.`}</p> : (
            <div className="grid max-h-60 grid-cols-4 gap-2 overflow-y-auto p-0.5">
              {visible.map((v) => (
                <button key={v.url} type="button" data-focusable title={v.label} aria-label={v.label} onClick={() => { sound.play("select"); onPicked(v.url); }}
                  className="ibox-focusable grid aspect-square place-items-center overflow-hidden rounded-xl bg-white p-2 [--ring-radius:0.75rem]">
                  <img src={v.url} alt="" loading="lazy" onError={() => setMissing((m) => [...m, v.url])} className={`max-h-24 max-w-full object-contain ${v.pixel ? "[image-rendering:pixelated]" : ""}`} />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid max-h-52 grid-cols-5 gap-2 overflow-y-auto p-0.5">
          {POKEMON.map(([fr, en]) => (
            <button key={en} type="button" data-focusable title={fr} onClick={() => { setQ(fr); choose(en); }}
              className="ibox-focusable flex flex-col items-center gap-0.5 rounded-xl bg-white p-1.5 [--ring-radius:0.75rem]">
              <span className="grid h-14 w-full place-items-center overflow-hidden"><img src={`${SHOWDOWN}/gen5ani/${en}.gif`} alt="" loading="lazy" className="max-h-14 max-w-full object-contain [image-rendering:pixelated]" /></span>
              <span data-no-i18n className="w-full truncate text-center text-[0.7rem] font-bold text-ink">{fr}</span>
            </button>
          ))}
        </div>
      )}
      <p className="text-[0.75rem] text-ink-soft">Sprites animés (Pokémon Showdown), rendus 3D de Pokémon HOME et illustrations officielles, tous transparents.</p>
    </div>
  );
}

/** Recherches proposées : des personnages de jeux qui rendent bien en sticker. */
const GIPHY_IDEAS = ["Kirby", "Mario", "Yoshi", "Sonic", "Pac-Man", "Link Zelda", "Pikachu", "Donkey Kong", "Mega Man", "Minecraft", "Among Us", "Pixel art"];

/** Stickers GIPHY : GIF animés détourés, tout public, avec la clé gratuite du joueur. */
function GiphyPicker({ onPicked }: { onPicked: (url: string) => void }) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ url: string; thumb: string }[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const asked = useRef("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { invoke<boolean>("giphy_key_status").then(setHasKey, () => setHasKey(false)); }, []);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await f(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  type GiphyPage = { stickers: { url: string; thumb: string }[]; next: number | null };
  const search = (text: string) => {
    if (busy || !text.trim()) return;
    setQ(text);
    asked.current = text;
    void run(async () => {
      const page = await invoke<GiphyPage>("decor_giphy_search", { q: text, offset: 0 });
      setFound(page.stickers);
      setNext(page.next);
    });
  };
  /** Page suivante quand on approche du bas de la grille. */
  const loadMore = async () => {
    if (more || busy || next === null || !found) return;
    const text = asked.current;
    setMore(true);
    try {
      const page = await invoke<GiphyPage>("decor_giphy_search", { q: text, offset: next });
      if (asked.current !== text) return;
      setFound((cur) => {
        const seen = new Set(cur?.map((st) => st.url));
        return [...(cur ?? []), ...page.stickers.filter((st) => !seen.has(st.url))];
      });
      setNext(page.next);
    } catch { setNext(null); } finally { setMore(false); }
  };
  const saveKey = () => run(async () => {
    await invoke("provider_key_set", { provider: "giphy", key });
    setKey("");
    setHasKey(true);
    sound.play("select");
  });
  if (hasKey === null) return <p role="status" className="text-[0.8rem] text-ink-soft">Chargement…</p>;
  if (!hasKey) return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.85rem] font-semibold text-ink">Une clé GIPHY gratuite suffit, une seule fois.</p>
      <p className="text-[0.8rem] text-ink-soft">Sur developers.giphy.com : connectez-vous, « Create an API Key », choisissez « API », puis collez la clé ici.</p>
      <div className="flex gap-2">
        <input
          data-focusable
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveKey(); } }}
          placeholder="Clé API GIPHY"
          aria-label="Clé API GIPHY"
          className="ibox-focusable h-10 min-w-0 flex-1 rounded-full bg-white px-4 font-bold text-ink [--ring-radius:999px]"
        />
        <Button type="button" icon="key" disabled={busy || key.trim().length < 16} onClick={() => void saveKey()}>Enregistrer</Button>
      </div>
      {error && <p role="alert" className="text-[0.8rem] font-bold text-peach-deep">{error}</p>}
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          data-focusable
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            // champ vidé : on retrouve les suggestions
            if (!e.target.value.trim()) { asked.current = ""; setFound(null); setNext(null); }
          }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(q); } }}
          placeholder="Personnage ou jeu (ex. Kirby, Sonic, Pac-Man)"
          aria-label="Chercher un sticker"
          className="ibox-focusable h-10 min-w-0 flex-1 rounded-full bg-white px-4 font-bold text-ink [--ring-radius:999px]"
        />
        <Button type="button" icon="search" disabled={busy || !q.trim()} onClick={() => search(q)}>Chercher</Button>
      </div>
      {!found && <div className="flex flex-wrap gap-1.5">
        {GIPHY_IDEAS.map((idea) => <Chip key={idea} active={q === idea} onClick={() => search(idea)}><span data-no-i18n>{idea}</span></Chip>)}
      </div>}
      {busy && <p role="status" className="text-[0.8rem] text-ink-soft">Chargement…</p>}
      {error && <p role="alert" className="text-[0.8rem] font-bold text-peach-deep">{error}</p>}
      {found && (found.length === 0 ? <p className="text-[0.85rem] text-ink-soft">Aucun sticker trouvé.</p> : (
        <div
          className="grid max-h-[22rem] grid-cols-6 content-start gap-2 overflow-y-auto p-0.5"
          onScroll={(e) => { const el = e.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) void loadMore(); }}
        >
          {found.map((st) => (
            <button key={st.url} type="button" data-focusable aria-label="Utiliser ce sticker" onClick={() => { sound.play("select"); onPicked(st.url); }}
              className="ibox-focusable h-20 overflow-hidden rounded-xl bg-[#2b3445] p-1.5 [--ring-radius:0.75rem]">
              <img src={st.thumb} alt="" loading="lazy" className="size-full object-contain" />
            </button>
          ))}
          {more && <p role="status" className="col-span-full py-2 text-center text-[0.8rem] text-ink-soft">Chargement…</p>}
        </div>
      ))}
    </div>
  );
}

type DecorPick = { kind: "url"; url: string; thumb: string } | { kind: "file"; file: File; thumb: string };

/** Ajouter ou modifier une décoration : icône iiDB, Pokémon animé ou image / GIF du PC. */
function DecorEditor({ decor, onClose }: { decor: Collection | null; onClose: () => void }) {
  const { create, remove, list } = useCollections();
  const setStyle = useCollectionStyles((s) => s.setStyle);
  const [source, setSource] = useState<"pokemon" | "giphy" | "iidb" | "file">("pokemon");
  const [size, setSize] = useState<DecorSize>((decor && useCollectionStyles.getState().styles[decor.id]?.decorSize) || "m");
  const [pick, setPick] = useState<DecorPick | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (pick?.kind === "file") URL.revokeObjectURL(pick.thumb); }, [pick]);
  const preview = pick?.thumb ?? (decor ? undefined : null);
  const save = async () => {
    if (!pick && decor) {
      setStyle(decor.id, { ...useCollectionStyles.getState().styles[decor.id], decorSize: size });
      sound.play("select");
      return onClose();
    }
    if (!pick) return;
    setSaving(true);
    setError(null);
    let created: number | undefined;
    try {
      const id = decor?.id ?? (created = await create("Décoration", COLLECTION_COLORS[list.length % COLLECTION_COLORS.length]));
      if (pick.kind === "url") await invoke("collection_art_set", { id, kind: "icon", url: pick.url });
      else await invoke("collection_art_import", new Uint8Array(await pick.file.arrayBuffer()), { headers: { "x-id": String(id), "x-kind": "icon" } });
      setStyle(id, { ...useCollectionStyles.getState().styles[id], decor: true, iconStamp: Date.now(), decorSize: size });
      sound.play("select");
      onClose();
    } catch (err) {
      if (created !== undefined) await remove(created).catch(() => undefined);
      setError(err instanceof Error ? err.message : String(err));
      sound.play("error");
    } finally { setSaving(false); }
  };
  return (
    <Modal title={decor ? "Modifier la décoration" : "Ajouter une décoration"} subtitle="Une image ou un GIF pour embellir vos collections" onClose={() => { if (!saving) onClose(); }} width="38rem">
      <div className="flex flex-col gap-4">
        <div className="grid justify-items-center rounded-2xl bg-cream-deep p-3">
          <div inert className="group/collection relative">
            <DecorCard collection={decor ?? { id: 0, name: "Décoration", color: COLLECTION_COLORS[0], gameIds: [] }} preview={preview} size={size} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[0.72rem] font-bold tracking-[0.12em] text-ink-soft uppercase">Taille</span>
          {(["s", "m", "l"] as const).map((k) => (
            <Chip key={k} active={size === k} onClick={() => setSize(k)}>{k === "s" ? "Petite" : k === "m" ? "Moyenne" : "Grande"}</Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Source de l'image">
          {([["pokemon", "Pokémon"], ["giphy", "Stickers de jeux (GIPHY)"], ["iidb", "Icônes iiDB"], ["file", "Depuis le PC"]] as const).map(([k, label]) => (
            <Chip key={k} active={source === k} onClick={() => setSource(k)}>{label}</Chip>
          ))}
        </div>
        {source === "iidb" && <IconSearch onPicked={(p) => setPick({ kind: "url", url: p.url, thumb: p.thumb })} />}
        {source === "pokemon" && <div className="rounded-2xl bg-cream-deep/60 p-3"><PokemonPicker onPicked={(url) => setPick({ kind: "url", url, thumb: url })} /></div>}
        {source === "giphy" && <div className="rounded-2xl bg-cream-deep/60 p-3"><GiphyPicker onPicked={(url) => setPick({ kind: "url", url, thumb: url })} /></div>}
        {source === "file" && (
          <div className="flex flex-col items-start gap-2 rounded-2xl bg-cream-deep/60 p-3">
            <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) setPick({ kind: "file", file, thumb: URL.createObjectURL(file) });
            }} />
            <Button type="button" icon="folder" onClick={() => fileInput.current?.click()}>Choisir une image ou un GIF…</Button>
            <p className="text-[0.8rem] text-ink-soft">PNG ou WebP transparents et GIF animés rendent le mieux.</p>
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-2">
          {decor ? (
            confirm ? (
              <Button type="button" icon="trash" cue="back" disabled={saving} onClick={async () => {
                setSaving(true);
                try { await remove(decor.id); onClose(); } catch (err) { setError(String(err)); setSaving(false); }
              }}>Confirmer la suppression</Button>
            ) : <Button type="button" icon="trash" cue="back" onClick={() => setConfirm(true)}>Retirer</Button>
          ) : <span />}
          <Button variant="primary" type="button" icon="check" disabled={saving || (!pick && !decor)} onClick={() => void save()}>
            {decor ? "Enregistrer" : "Ajouter"}
          </Button>
        </div>
        {error && <p role="alert" className="text-[0.85rem] font-bold text-peach-deep">{error}</p>}
      </div>
    </Modal>
  );
}
