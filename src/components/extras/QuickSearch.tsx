import { useEffect, useRef, useState } from "react";
import { useNav } from "@/app/navigation";
import { Modal } from "@/components/ui/Modal";
import { Icon, type IconName } from "@/components/ui/Icon";
import { PLATFORMS, requirePlatform } from "@/domain/platforms";
import { matchesQuery } from "@/domain/text";
import type { Game } from "@/domain/types";
import { isDecor, useCollections } from "@/services/extras";

export function QuickSearch({ games, onClose, onCollection }: { games: Game[]; onClose: () => void; onCollection: (id: number) => void }) {
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const go = useNav((s) => s.go);
  const { list, load } = useCollections();
  useEffect(() => void load().catch(() => undefined), [load]);
  const navigate = (route: Parameters<typeof go>[0]) => { onClose(); go(route); };
  const sections: { label: string; icon: IconName; items: { key: string | number; title: string; detail?: string; open: () => void }[] }[] = [
    { label: "Jeux", icon: "gamepad", items: games.filter((g) => matchesQuery(g.title, query)).slice(0, 12).map((game) =>
      ({ key: game.id, title: game.title, detail: requirePlatform(game.platformId).name, open: () => navigate({ name: "game", gameId: game.id }) })) },
    { label: "Consoles", icon: "grid", items: PLATFORMS.filter((p) => matchesQuery(p.name, query)).slice(0, 8).map((platform) =>
      ({ key: platform.id, title: platform.name, open: () => navigate({ name: "library", platformId: platform.id }) })) },
    { label: "Collections", icon: "shelf", items: list.filter((c) => !isDecor(c.id) && matchesQuery(c.name, query)).slice(0, 8).map((collection) =>
      ({ key: collection.id, title: collection.name, open: () => onCollection(collection.id) })) },
  ];
  return (
    <Modal title="Recherche rapide" width="38rem" onClose={onClose}>
      <input ref={field} data-focusable data-autofocus aria-label="Rechercher un jeu, une console ou une collection"
        className="ibox-focusable mb-4 w-full rounded-full bg-cream-deep px-5 py-3 text-ink"
        placeholder="Jeu, console ou collection" value={query} onChange={(event) => setQuery(event.target.value)} />
      {/* le clavier virtuel commun (celui de la manette) écrit directement dans le champ */}
      <button data-focusable onClick={() => field.current && window.dispatchEvent(new CustomEvent("ibox:pad-keyboard", { detail: field.current }))}
        className="ibox-focusable mb-3 rounded-full bg-cream-deep px-4 py-1.5 text-sm font-bold text-ink">Clavier à l’écran</button>
      {/* taille fixe : la fenêtre ne change pas de hauteur pendant la saisie */}
      <div className="h-[48vh] overflow-y-auto pr-1">
      {sections.every(({ items }) => !items.length) && <p className="text-ink-soft">Aucun résultat.</p>}
      {sections.map(({ label, icon, items }) => items.length > 0 && (
        <section key={label} className="mb-4">
          <h3 className="mb-1 text-sm font-bold text-ink-soft">{label}</h3>
          {items.map((item) => <button key={item.key} data-focusable onClick={item.open}
            className="ibox-focusable flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-ink hover:bg-cream-deep focus:bg-cream-deep">
            <Icon name={icon} size={17} /><span data-no-i18n className="flex-1 truncate">{item.title}</span>
            {item.detail && <small className="text-ink-soft">{item.detail}</small>}
          </button>)}
        </section>
      ))}
      </div>
    </Modal>
  );
}
