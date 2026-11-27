import { useEffect, useState } from "react";
import { usePlatform } from "@/services/platform";
import type { Platform } from "@/domain/types";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { sound } from "@/services/sound";
import {
  artApi,
  SLOT_LABEL,
  usePlatformArt,
  usePlatformArtRow,
  usePlatformArtStore,
  type Artwork,
  type PlatformSlot,
} from "@/services/platformArt";

/**
 * Choix d'une illustration de console : galerie iiDB paginée, fichier local,
 * ou retour à la recommandation. Le choix est appliqué et visible aussitôt ;
 * il reste prioritaire sur les synchronisations suivantes.
 */
export function ArtworkPicker({ platform, slot, onClose }: { platform: Platform; slot: PlatformSlot; onClose: () => void }) {
  const current = usePlatformArt(platform.id, slot);
  const android = usePlatform((p) => !!p.android);
  const row = usePlatformArtRow(platform.id, slot);
  const refresh = usePlatformArtStore((s) => s.refresh);
  const linked = usePlatformArtStore((s) => s.links.some((l) => l.platformId === platform.id && (l.status === "matched" || l.status === "manual")));
  const [items, setItems] = useState<Artwork[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | "file" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (next: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const page = await artApi.gallery(platform.id, slot, next);
      // dédoublonnage par identifiant (la galerie peut évoluer pendant la navigation)
      setItems((prev) => {
        const seen = new Set(next ? prev.map((a) => a.id) : []);
        return [...(next ? prev : []), ...page.items.filter((a) => !seen.has(a.id))];
      });
      setCursor(page.nextCursor);
      setTotal(page.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  };

  useEffect(() => {
    if (linked) void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform.id, slot, linked]);

  const act = async (key: number | "file" | "reset", fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await refresh();
      sound.play("select");
    } catch (e) {
      sound.play("error");
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  const wide = slot === "platform_hero" || slot === "platform_border";
  const origin =
    row?.choice === "user" ? "Fichier importé" : row?.choice === "manual" ? "Choisie dans iiDB" : row ? "Recommandée par iiDB" : "Habillage iBox";

  return (
    <Modal title={`${SLOT_LABEL[slot]} — ${platform.shortName}`} subtitle={origin} onClose={onClose} width="64rem">
      <div className="flex flex-wrap items-center gap-4">
        <div className={`grid shrink-0 place-items-center overflow-hidden rounded-lg ${slot === "platform_logo" ? "bg-[#8691a3]" : "bg-cream-deep"} ${wide ? "h-24 w-56" : "h-24 w-24"}`}>
          {current ? <img src={current} alt="" className={`h-full w-full ${wide ? "object-cover" : "object-contain p-2"}`} /> : <Icon name="sparkle" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            icon="folder"
            disabled={busy !== null}
            onClick={() =>
              void act("file", async () => {
                const path = await artApi.pickImage();
                if (path) await artApi.import(platform.id, slot, path);
              })
            }
          >
            Importer un fichier…
          </Button>
          <Button icon="reset" cue="back" disabled={busy !== null || !row} onClick={() => void act("reset", () => artApi.reset(platform.id, slot))} title="Retire ce choix ; la prochaine synchronisation reprend l'image recommandée">
            Restaurer la recommandation
          </Button>
        </div>
      </div>

      {!linked && (
        <p className="mt-4 rounded-lg bg-cream-deep px-4 py-3 text-[0.88rem] font-semibold text-ink-soft">
          Cette console n'est pas encore associée à iiDB : synchronisez, ou associez-la dans la liste des consoles.
        </p>
      )}
      {error && <p className="mt-3 text-[0.85rem] font-bold text-peach-deep">{error}</p>}

      {linked && (
        <>
          <div className="mt-5 mb-2 text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">
            Galerie iiDB {total > 0 && `· ${total} image${total > 1 ? "s" : ""}`}
          </div>
          <div className={`grid gap-3 ${wide ? "grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(8rem,1fr))]"}`}>
            {items.map((a) => {
              const selected = row?.assetId === a.id;
              return (
                <button
                  key={a.id}
                  data-focusable
                  disabled={busy !== null}
                  onClick={() => void act(a.id, () => artApi.choose(platform.id, slot, a))}
                  className={`ibox-focusable group relative overflow-hidden rounded-lg shadow-xs ${slot === "platform_logo" ? "bg-[#8691a3]" : "bg-cream-deep"} [--ring-radius:var(--radius-lg)] ${wide ? "aspect-[3/1]" : "aspect-square"} ${selected ? "outline-3 outline-[var(--accent)]" : ""}`}
                  title={[a.displayName, a.resolution, a.region].filter(Boolean).join(" · ")}
                >
                  <img src={a.thumbnailUrl ?? a.url} alt="" loading="lazy" className={`h-full w-full ${wide ? "object-cover" : "object-contain p-3"}`} />
                  {a.resolution && (
                    <span className="absolute right-1.5 bottom-1.5 rounded-full bg-white/85 px-2 py-0.5 text-[0.62rem] font-extrabold text-ink-soft">{a.resolution}</span>
                  )}
                  {busy === a.id && <span className="absolute inset-0 grid place-items-center bg-white/60 text-[0.8rem] font-bold text-ink">Téléchargement…</span>}
                </button>
              );
            })}
            {!loading && items.length === 0 && !error && (
              <p className="col-span-full text-[0.88rem] font-semibold text-ink-soft">Aucune image de ce type dans iiDB pour cette console.</p>
            )}
          </div>
          <div className="mt-4 flex justify-center">
            {cursor && (
              <Button disabled={loading} onClick={() => void load(cursor)}>
                {loading ? "Chargement…" : "Plus d'images"}
              </Button>
            )}
            {loading && !cursor && <span className="text-[0.85rem] font-bold text-ink-soft">Chargement…</span>}
          </div>
        </>
      )}
      <p className="mt-4 text-[0.72rem] font-semibold text-ink-faint">
        {android
          ? "Images de la communauté iiDB (iisu.network), propriété de leurs auteurs et ayants droit ; téléchargées sur cet appareil uniquement."
          : "Images de la communauté iiDB (iisu.network), propriété de leurs auteurs et ayants droit ; téléchargées sur cet ordinateur uniquement."}
      </p>
    </Modal>
  );
}
