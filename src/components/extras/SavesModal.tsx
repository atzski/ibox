import { useCallback, useEffect, useState } from "react";
import type { Game } from "@/domain/types";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { relativeDay } from "@/domain/text";
import { savesApi, type SaveItem } from "@/services/extras";
import { sound } from "@/services/sound";

function size(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}

/**
 * Sauvegardes d'un jeu : où l'émulateur les range, et copies de sécurité
 * dans le dossier d'iBox. Les fichiers d'origine ne sont jamais modifiés.
 */
export function SavesModal({ game, onClose }: { game: Game; onClose: () => void }) {
  const [data, setData] = useState<{ items: SaveItem[]; backups: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dbId = game.dbId!;
  const refresh = useCallback(() => {
    savesApi.list(dbId).then(setData, (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }));
  }, [dbId]);
  useEffect(refresh, [refresh]);

  return (
    <Modal title="Sauvegardes" subtitle={game.title} onClose={onClose} width="40rem">
      {!data ? (
        <div className="ibox-shimmer h-24 rounded-2xl" />
      ) : data.items.length === 0 ? (
        <p className="rounded-2xl bg-cream-deep/60 px-5 py-4 text-[0.92rem] font-semibold text-ink-soft">
          Aucune sauvegarde trouvée pour l'instant. Elle apparaîtra ici après votre première partie (à côté du jeu, ou dans le dossier de l'émulateur pour
          Dolphin, PPSSPP, DuckStation et RetroArch).
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-nav-group="saves">
          {data.items.map((s) => (
            <li key={s.path} className="flex items-center gap-3 rounded-2xl bg-cream-deep/60 px-4 py-3">
              <Icon name={s.folder ? "folder" : "disc"} className="shrink-0 text-accent-text" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-ink" title={s.path}>
                  {s.path.split(/[\\/]/).pop()}
                </p>
                <p className="text-[0.8rem] font-semibold text-ink-soft">
                  {s.source} · {size(s.size)}
                  {s.modified ? ` · modifiée ${relativeDay(s.modified)}` : ""}
                </p>
              </div>
              <Button icon="folder" onClick={() => void savesApi.reveal(dbId, s.path)}>
                Afficher
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-ink/8 pt-4">
        <p className="text-[0.85rem] font-semibold text-ink-soft">
          {data?.backups.length ? `${data.backups.length} copie${data.backups.length > 1 ? "s" : ""} de sécurité` : "Aucune copie de sécurité"}
        </p>
        <div className="flex gap-2">
          {!!data?.backups.length && (
            <Button icon="folder" onClick={() => void savesApi.reveal(dbId)}>
              Voir les copies
            </Button>
          )}
          <Button
            variant="primary"
            icon="download"
            disabled={busy || !data?.items.length}
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              try {
                const n = await savesApi.backup(dbId);
                setMsg({ ok: true, text: `Copie faite (${n} élément${n > 1 ? "s" : ""}).` });
                sound.play("select");
                refresh();
              } catch (e) {
                setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
              } finally {
                setBusy(false);
              }
            }}
          >
            Copie de sécurité
          </Button>
        </div>
      </div>
      {msg && <p className={`mt-2 text-[0.85rem] font-bold ${msg.ok ? "text-[#1F8A57]" : "text-peach-deep"}`}>{msg.text}</p>}
    </Modal>
  );
}
