import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useScreenChrome } from "@/app/shellState";
import { Avatar } from "@/components/profile/Avatar";
import { Button, Segmented } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { getPlatform } from "@/domain/platforms";
import { relativeDay } from "@/domain/text";
import { captures, community, formatBytes, useCaptureUrl, type LocalCapture, type SharedCapture } from "@/services/community";
import { useInetbox } from "@/services/inetbox";
import { isTauri } from "@/services/native";
import { sound } from "@/services/sound";

type Tab = "feed" | "mine";

/**
 * Hub de la communauté : le fil des captures et clips partagés par vos amis
 * (et les profils publics), et vos propres captures prises en jeu avec Alt+E.
 */
export function CommunityScreen() {
  const [tab, setTab] = useState<Tab>("feed");
  useScreenChrome({
    title: "Communauté",
    hints: [
      { keys: ["↑", "↓", "←", "→"], label: "Naviguer" },
      { keys: ["Entrée"], label: "Ouvrir" },
      { keys: ["Échap"], label: "Retour" },
    ],
  });
  return (
    <div className="h-full overflow-y-auto px-[3rem] pb-10">
      <div className="relative mt-2 overflow-hidden rounded-[2rem] p-7 text-white shadow-[0_22px_48px_-26px_rgba(30,40,70,0.6)]" style={{ background: "linear-gradient(120deg, #4A5BEA 0%, #8A4FE0 55%, #E8509A 100%)" }}>
        <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(rgba(255,255,255,0.9)_1.5px,transparent_2px)] [background-size:26px_26px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="text-[0.75rem] font-extrabold tracking-[0.18em] text-white/75 uppercase">Hub de la communauté</div>
            <h1 className="mt-1 font-display text-[2.3rem] leading-tight font-semibold">Vos meilleurs moments</h1>
            <p className="mt-1 max-w-[36rem] text-[0.95rem] font-semibold text-white/85">
              En pleine partie, appuyez sur <kbd className="rounded-md bg-white/20 px-1.5 py-0.5 font-extrabold">Alt</kbd> + <kbd className="rounded-md bg-white/20 px-1.5 py-0.5 font-extrabold">E</kbd> : l’overlay iBox fige l’image et garde les 12 dernières secondes en clip.
            </p>
          </div>
          <Segmented<Tab>
            label="Communauté"
            value={tab}
            onChange={(v) => { sound.play("tab"); setTab(v); }}
            options={[
              { value: "feed", label: "Fil des amis", icon: "globe" },
              { value: "mine", label: "Mes captures", icon: "front" },
            ]}
          />
        </div>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
          {tab === "feed" ? <Feed onMine={() => setTab("mine")} /> : <Mine />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Feed({ onMine }: { onMine: () => void }) {
  const user = useInetbox((s) => s.user);
  const [items, setItems] = useState<SharedCapture[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<SharedCapture | null>(null);
  const load = useCallback(() => {
    if (!user) return;
    setError(null);
    community.feed().then(setItems).catch((e) => setError((e as { message?: string }).message ?? "Fil indisponible."));
  }, [user]);
  useEffect(load, [load]);

  if (!user) {
    return (
      <Empty icon="globe" title="Connectez-vous à iNetbox" body="Le fil montre les captures partagées par vos amis et les profils publics.">
        <Button variant="primary" icon="user" onClick={() => useInetbox.getState().show()}>Se connecter</Button>
      </Empty>
    );
  }
  if (error) return <Empty icon="reset" title="Fil indisponible" body={error}><Button icon="reset" onClick={load}>Réessayer</Button></Empty>;
  if (!items) return <p className="mt-8 text-center font-bold text-ink-soft">Chargement du fil…</p>;
  if (items.length === 0) {
    return (
      <Empty icon="sparkle" title="Le fil est encore vide" body="Partagez votre première capture, ou invitez vos amis à partager les leurs.">
        <Button variant="primary" icon="front" onClick={onMine}>Mes captures</Button>
      </Empty>
    );
  }
  return (
    <>
      <div className="mt-6 flex items-center justify-between">
        <h2 className="font-display text-[1.3rem] font-semibold text-ink">Partagé récemment</h2>
        <Button icon="reset" onClick={load}>Actualiser</Button>
      </div>
      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-5" data-nav-group="community-feed">
        {items.map((it, i) => <SharedCard key={it.id} item={it} index={i} onOpen={() => setOpen(it)} />)}
      </div>
      {open && (
        <Viewer source={{ shared: open.id }} title={open.game ?? "Capture"} subtitle={`${open.authorName} · ${relativeDay(new Date(open.createdAt).toISOString())}`} caption={open.caption} onClose={() => setOpen(null)}>
          {open.mine && (
            <Button icon="x" onClick={async () => {
              await community.remove(open.id).catch(() => undefined);
              setOpen(null);
              load();
            }}>Retirer le partage</Button>
          )}
        </Viewer>
      )}
    </>
  );
}

function SharedCard({ item, index, onOpen }: { item: SharedCapture; index: number; onOpen: () => void }) {
  // miniature légère quand le partage en a une (sinon l'image entière, une seule fois grâce au cache)
  const url = useCaptureUrl({ shared: item.id, thumb: !!item.hasThumb });
  const platform = item.platformId ? getPlatform(item.platformId) : undefined;
  return (
    <motion.button
      data-focusable
      onClick={() => { sound.play("open"); onOpen(); }}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.04 }}
      className="ibox-focusable ibox-lift group overflow-hidden rounded-[1.4rem] bg-white text-left shadow-[0_14px_30px_-20px_rgba(30,40,70,0.55)] [--ring-radius:1.4rem]"
    >
      <div className="relative aspect-video bg-ink/10">
        {url && <img src={url} alt="" className="size-full object-cover" />}
        {item.kind === "clip" && <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[0.7rem] font-extrabold text-white"><Icon name="play" size="0.8em" /> Clip</span>}
      </div>
      <div className="flex items-center gap-3 p-3">
        <Avatar size={34} choice={item.avatar} name={item.authorName} />
        <div className="min-w-0 flex-1">
          <div data-no-i18n className="truncate text-[0.9rem] font-bold text-ink">{item.authorName}</div>
          <div className="truncate text-[0.78rem] font-semibold text-ink-soft">
            <span data-no-i18n>{item.game ?? "iBox"}</span>{platform ? ` · ${platform.shortName}` : ""}
          </div>
        </div>
        <span className="shrink-0 text-[0.72rem] font-bold text-ink-soft">{relativeDay(new Date(item.createdAt).toISOString())}</span>
      </div>
      {item.caption && <p data-no-i18n className="-mt-1 line-clamp-2 px-3 pb-3 text-[0.82rem] font-semibold text-ink">{item.caption}</p>}
    </motion.button>
  );
}

function Mine() {
  const user = useInetbox((s) => s.user);
  const [items, setItems] = useState<LocalCapture[] | null>(null);
  const [open, setOpen] = useState<LocalCapture | null>(null);
  const [caption, setCaption] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => void captures.list().then(setItems).catch(() => setItems([])), []);
  useEffect(load, [load]);

  if (!isTauri()) return <Empty icon="lock" title="Disponible dans l’application Windows" body="Les captures en jeu passent par l’overlay d’iBox." />;
  if (!items) return <p className="mt-8 text-center font-bold text-ink-soft">Chargement…</p>;
  return (
    <>
      <div className="mt-6 flex items-center justify-between">
        <h2 className="font-display text-[1.3rem] font-semibold text-ink">Sur ce PC <span className="text-[1rem] text-ink-soft">({items.length})</span></h2>
        <Button icon="folder" onClick={() => void captures.folder()}>Ouvrir le dossier</Button>
      </div>
      {items.length === 0 ? (
        <Empty icon="front" title="Aucune capture pour l’instant" body="Lancez un jeu depuis iBox, puis appuyez sur Alt+E au bon moment." />
      ) : (
        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4" data-nav-group="community-mine">
          {items.map((it, i) => <LocalCard key={it.name} item={it} index={i} onOpen={() => { setOpen(it); setCaption(""); setStatus(null); }} />)}
        </div>
      )}
      {open && (
        <Viewer source={{ local: open.name }} title={open.game ?? "Capture"} subtitle={`${open.kind === "clip" ? "Clip" : "Capture d’écran"} · ${formatBytes(open.size)}`} onClose={() => setOpen(null)}>
          {user ? (
            <form className="flex flex-1 items-center gap-2" onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setStatus(null);
              try {
                await captures.share(open.name, caption);
                sound.play("select");
                setStatus("Partagé avec vos amis !");
              } catch (err) {
                setStatus((err as { message?: string }).message ?? "Le partage a échoué.");
              } finally {
                setBusy(false);
              }
            }}>
              <input data-focusable value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={200} placeholder="Un mot sur ce moment… (facultatif)" aria-label="Légende"
                className="ibox-focusable h-11 min-w-0 flex-1 rounded-full bg-cream-deep px-4 font-semibold text-ink [--ring-radius:999px]" />
              <Button type="submit" variant="primary" icon="globe" disabled={busy}>{busy ? "Envoi…" : "Partager"}</Button>
            </form>
          ) : (
            <Button icon="user" onClick={() => useInetbox.getState().show()}>Se connecter pour partager</Button>
          )}
          <Button icon="x" onClick={async () => {
            await captures.remove(open.name).catch(() => undefined);
            setOpen(null);
            load();
          }}>Supprimer</Button>
          {status && <p className="w-full text-[0.85rem] font-bold text-ink-soft">{status}</p>}
        </Viewer>
      )}
    </>
  );
}

function LocalCard({ item, index, onOpen }: { item: LocalCapture; index: number; onOpen: () => void }) {
  const url = useCaptureUrl({ local: item.name });
  return (
    <motion.button
      data-focusable
      onClick={() => { sound.play("open"); onOpen(); }}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.03 }}
      className="ibox-focusable ibox-lift overflow-hidden rounded-[1.2rem] bg-white text-left shadow-[0_12px_26px_-20px_rgba(30,40,70,0.55)] [--ring-radius:1.2rem]"
    >
      <div className="relative aspect-video bg-ink/10">
        {url && <img src={url} alt="" loading="lazy" className="size-full object-cover" />}
        {item.kind === "clip" && <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[0.7rem] font-extrabold text-white"><Icon name="play" size="0.8em" /> Clip</span>}
      </div>
      <div className="px-3 py-2">
        <div data-no-i18n className="truncate text-[0.86rem] font-bold text-ink">{item.game ?? "iBox"}</div>
        <div className="text-[0.74rem] font-semibold text-ink-soft">{relativeDay(new Date(item.at).toISOString())}</div>
      </div>
    </motion.button>
  );
}

function Viewer({ source, title, subtitle, caption, onClose, children }: {
  source: { local: string } | { shared: string; thumb?: boolean }; title: string; subtitle: string; caption?: string; onClose: () => void; children?: React.ReactNode;
}) {
  const url = useCaptureUrl(source);
  return (
    <Modal title={title} subtitle={subtitle} width="min(70rem, 94vw)" onClose={onClose}>
      <div className="overflow-hidden rounded-2xl bg-black">
        {url ? <img src={url} alt="" className="mx-auto max-h-[62vh] w-auto object-contain" /> : <div className="grid aspect-video place-items-center text-white/60">Chargement…</div>}
      </div>
      {caption && <p data-no-i18n className="mt-3 text-[0.95rem] font-semibold text-ink">{caption}</p>}
      {children && <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div>}
    </Modal>
  );
}

function Empty({ icon, title, body, children }: { icon: Parameters<typeof Icon>[0]["name"]; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="mt-8 flex flex-col items-center rounded-[1.8rem] bg-white/60 px-6 py-12 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-white shadow-sm text-ink-soft"><Icon name={icon} size="1.8rem" /></span>
      <h3 className="mt-4 font-display text-[1.35rem] font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-[30rem] text-[0.92rem] font-semibold text-ink-soft">{body}</p>
      {children && <div className="mt-5 flex gap-2">{children}</div>}
    </div>
  );
}
