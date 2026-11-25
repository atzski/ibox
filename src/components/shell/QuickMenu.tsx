import { useNav, useRoute, type Route } from "@/app/navigation";
import { useCommands } from "@/input/commands";
import { requestDraw } from "@/app/draw";
import { useGamepad, type ConfirmSide, type PadFamily } from "@/input/gamepad";
import { Modal } from "@/components/ui/Modal";
import { Icon, type IconName } from "@/components/ui/Icon";
import { QuickSearch } from "@/components/extras/QuickSearch";
import { useLibrary } from "@/services/library";
import { useSettings } from "@/services/settings";
import { normalizeBlocks } from "@/services/homeLayout";
import { sound } from "@/services/sound";
import { PadGlyph, type PadKey } from "./PadGlyph";
import { PadKeyboard } from "./PadKeyboard";

/** Toutes les commandes d'iBox : bouton(s) de manette, touche(s) clavier, effet. */
export const CONTROLS: { pad: PadKey[]; keys: string; label: string }[] = [
  { pad: ["dpad", "ls"], keys: "Flèches", label: "Naviguer (maintenir : défilement accéléré)" },
  { pad: ["confirm"], keys: "Entrée", label: "Valider, ouvrir" },
  { pad: ["back"], keys: "Échap", label: "Retour" },
  { pad: ["lb", "rb"], keys: "Q / E", label: "Onglet, vue, catégorie ou jeu précédent / suivant" },
  { pad: ["lt", "rt"], keys: "Pg↑ / Pg↓", label: "Défilement rapide, page par page" },
  { pad: ["l3", "r3"], keys: "Début / Fin", label: "Début / fin de la liste" },
  { pad: ["west"], keys: "X", label: "Action rapide : jouer, rechercher" },
  { pad: ["north"], keys: "F", label: "Option : retourner le boîtier, favori" },
  { pad: ["rs"], keys: "Molette", label: "Défiler la page, tourner le boîtier" },
  { pad: ["rsH"], keys: "− / +", label: "Jaquettes : reculer / avancer" },
  { pad: ["start"], keys: "F1", label: "Menu rapide" },
  { pad: ["select"], keys: "/", label: "Recherche" },
  { pad: ["guide"], keys: "—", label: "Accueil" },
];

/** Aide-mémoire des commandes, avec les boutons de la manette branchée. */
export function ControlsSheet({ family, side, compact = false }: { family: PadFamily; side: ConfirmSide; compact?: boolean }) {
  return (
    <div className={`grid gap-1.5 ${compact ? "" : "sm:grid-cols-2"}`}>
      {CONTROLS.map((c) => (
        <div key={c.label} className="flex items-center gap-3 rounded-xl bg-cream-deep/60 px-3 py-2">
          <span className="flex w-[4.6rem] shrink-0 items-center gap-1">
            {c.pad.map((k) => <PadGlyph key={k} k={k} family={family} side={side} size={compact ? 24 : 28} />)}
          </span>
          <span className="min-w-0 flex-1 text-[0.86rem] font-semibold text-ink">{c.label}</span>
          <kbd className="shrink-0 rounded-md bg-white px-2 py-0.5 font-body text-[0.7rem] font-extrabold text-ink-soft shadow-xs">{c.keys}</kbd>
        </div>
      ))}
    </div>
  );
}

const DESTINATIONS: { label: string; icon: IconName; route?: Route; action?: "search" | "draw" }[] = [
  { label: "Accueil", icon: "home", route: { name: "home" } },
  { label: "Toute la collection", icon: "shelf", route: { name: "library", platformId: "all" } },
  { label: "iBox Platforms", icon: "gamepad", route: { name: "platforms" } },
  { label: "Succès", icon: "trophy", route: { name: "achievements" } },
  { label: "Communauté", icon: "chat", route: { name: "community" } },
  { label: "SmartConfig", icon: "tune", route: { name: "smartconfig" } },
  { label: "Au hasard", icon: "dice", action: "draw" },
  { label: "Recherche", icon: "search", action: "search" },
  { label: "Paramètres", icon: "gear", route: { name: "settings" } },
];

/** Menu rapide (Start / F1) : aller partout en deux appuis, et l'aide des commandes. */
function QuickMenu({ onClose }: { onClose: () => void }) {
  const { family, connected } = useGamepad();
  const side = useSettings((s) => s.gamepadConfirm);
  const route = useRoute();
  const open = (d: (typeof DESTINATIONS)[number]) => {
    // le tirage joue ses propres sons en arrivant sur l'étagère
    if (d.action === "draw") {
      onClose();
      return requestDraw();
    }
    sound.play(d.action === "search" ? "search" : d.route?.name === "home" ? "home" : d.route?.name === "settings" ? "settings" : "enter");
    if (d.action === "search") return useCommands.getState().setSearch(true);
    onClose();
    if (!d.route) return;
    const nav = useNav.getState();
    if (d.route.name === "home") nav.home();
    else if (d.route.name !== route.name) nav.go(d.route);
  };
  return (
    <Modal title="Menu" subtitle={connected ? "Start ou B pour fermer" : "F1 ou Échap pour fermer"} width="58rem" onClose={onClose}>
      <div className="grid grid-cols-[16rem_minmax(0,1fr)] gap-6">
        <nav data-nav-group="quick-menu" aria-label="Aller à" className="flex flex-col gap-1.5">
          {DESTINATIONS.map((d, i) => {
            const here = d.route?.name === route.name;
            return (
              <button key={d.label} data-focusable data-autofocus={i === 0 || undefined} onClick={() => open(d)}
                className={`ibox-focusable flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left font-bold [--ring-radius:1rem] ${here ? "bg-cream-deep text-ink" : "text-ink-soft hover:bg-cream-deep/60"}`}>
                <span className="grid size-9 place-items-center rounded-xl bg-white text-ink shadow-xs"><Icon name={d.icon} size="1.1em" /></span>
                <span className="flex-1">{d.label}</span>
                {here && <span className="text-[0.72rem] font-extrabold text-ink-faint">ici</span>}
              </button>
            );
          })}
        </nav>
        <section aria-label="Commandes">
          <h3 className="mb-2 text-[0.75rem] font-extrabold tracking-[0.14em] text-ink-soft uppercase">Commandes</h3>
          <ControlsSheet family={family} side={side} compact />
        </section>
      </div>
    </Modal>
  );
}

/** Fenêtres globales : menu rapide, recherche, clavier virtuel de la manette. */
export function CommandsHost() {
  const { menu, search, setMenu, setSearch } = useCommands();
  const games = useLibrary((s) => s.games);
  return (
    <>
      {menu && <QuickMenu onClose={() => setMenu(false)} />}
      {search && (
        <QuickSearch
          games={games}
          onClose={() => setSearch(false)}
          onCollection={(id) => {
            setSearch(false);
            const s = useSettings.getState();
            s.set("homeBlocks", normalizeBlocks(s.homeBlocks).map((b) => (b.id === "collections" ? { ...b, visible: true } : b)));
            const nav = useNav.getState();
            const away = nav.stack.length > 1;
            if (away) nav.home();
            window.setTimeout(() => window.dispatchEvent(new CustomEvent("ibox:open-collection", { detail: id })), away ? 650 : 16);
          }}
        />
      )}
      <PadKeyboard />
    </>
  );
}
