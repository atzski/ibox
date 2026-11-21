import { useEffect, useState, type FormEvent } from "react";
import type { Game } from "@/domain/types";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { COLLECTION_COLORS, matchesSmartRule, useCollections, useCollectionStyles } from "@/services/extras";
import { sound } from "@/services/sound";

/** Ranger un jeu dans ses collections (cases à cocher) ou en créer une. */
export function CollectionsModal({ game, onClose }: { game: Game; onClose: () => void }) {
  const { list, load, create, setGame } = useCollections();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void load().catch(() => undefined), [load]);
  const dbId = game.dbId!;
  const styles = useCollectionStyles((state) => state.styles);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      sound.play("error");
    }
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    void run(async () => {
      const id = await create(name, COLLECTION_COLORS[list.length % COLLECTION_COLORS.length]);
      await setGame(id, dbId, true);
      setName("");
      sound.play("select");
    });
  };

  return (
    <Modal title="Collections" subtitle={game.title} onClose={onClose} width="30rem">
      <div className="flex flex-col gap-2" data-nav-group="collections">
        {list.filter((c) => !styles[c.id]?.decor).map((c) => {
          const rule = styles[c.id]?.rule;
          const member = rule ? !!matchesSmartRule(rule, game) : c.gameIds.includes(dbId);
          return (
            <button
              key={c.id}
              data-focusable
              role="checkbox"
              aria-checked={member}
              disabled={!!rule}
              onClick={() => {
                sound.play(member ? "off" : "on");
                void run(() => setGame(c.id, dbId, !member));
              }}
              className="ibox-focusable flex items-center gap-3 rounded-2xl bg-cream-deep/60 px-4 py-3 text-left [--ring-radius:1rem]"
            >
              <span className="size-4 shrink-0 rounded-full" style={{ background: c.color }} />
              <span className="min-w-0 flex-1 truncate font-bold text-ink">{c.name}</span>
              <span className="text-[0.8rem] font-bold text-ink-soft">{rule ? "Automatique" : c.gameIds.length}</span>
              <span className={`grid size-7 place-items-center rounded-full ${member ? "bg-[var(--accent)] text-white" : "bg-white/70 text-transparent"}`}>
                <Icon name="check" size={16} />
              </span>
            </button>
          );
        })}
        {list.every((c) => styles[c.id]?.decor) && <p className="text-[0.9rem] font-semibold text-ink-soft">Créez votre première collection : « À finir », « Coop », « Jeux d'enfance »…</p>}
      </div>
      <form onSubmit={add} className="mt-4 flex gap-2">
        <input
          data-focusable
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nouvelle collection"
          aria-label="Nom de la nouvelle collection"
          className="ibox-focusable h-11 min-w-0 flex-1 rounded-full bg-cream-deep px-4 font-bold text-ink [--ring-radius:999px]"
        />
        <Button variant="primary" icon="plus" type="submit" disabled={!name.trim()}>
          Créer
        </Button>
      </form>
      {error && <p className="mt-2 text-[0.85rem] font-bold text-peach-deep">{error}</p>}
    </Modal>
  );
}
