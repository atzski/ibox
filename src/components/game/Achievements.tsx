import { RA_SYSTEM, matchRaProgress, syncRaProgress } from "@/services/achievementProgress";
import { useSettings } from "@/services/settings";
import { Icon } from "@/components/ui/Icon";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useInetbox } from "@/services/inetbox";
import type { Game } from "@/domain/types";
import { RaGameCard } from "@/components/achievements/RaParts";

type Achievement = { title: string; description?: string; earned: boolean; image?: string; unlockedAt?: number | string };

export function Achievements({ game, inline = false }: { game: Game; inline?: boolean }) {
  const steam = game.pcInstalls?.find((install) => install.source === "steam")?.externalId;
  const { act, user, busy: socialBusy } = useInetbox();
  const [shared, setShared] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Achievement[]>();
  const [error, setError] = useState("");
  const [matches, setMatches] = useState<{title:string; id:number; count?:number | null}[]>();
  const [query, setQuery] = useState(game.title);
  const [busy, setBusy] = useState(false);
  const username = useSettings((state) => state.raUsername);
  const key = `ibox.raGame.${game.id}`;
  const [id, setId] = useState(() => localStorage.getItem(key) ?? "");
  useEffect(() => {
    let current = true;
    async function preview() {
      if (!steam) return;
      const linked = steam || id || (username && matchRaProgress(await syncRaProgress(username), game.platformId, game.title)?.id);
      if (!linked || (!steam && !username)) return;
      const rows = await invoke<Achievement[]>("achievements_read", { source: steam ? "steam" : "ra", game: Number(linked), username: username ?? null });
      if (current) {
        setItems(rows);
      }
    }
    void preview().catch(() => undefined);
    return () => { current = false; };
  }, [steam, username, game.platformId, game.title, id]);

  if (!steam && !RA_SYSTEM[game.platformId]) return null;
  // consoles : l'univers RetroAchievements a sa propre page
  if (!steam) return <RaGameCard game={game} inline={inline} />;
  async function search() {
    setBusy(true);
    setError("");
    try { setMatches(await invoke("achievements_ra_search", { platform: game.platformId, title: query })); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  async function load() {
    if (busy || (!steam && !username)) return;
    setBusy(true);
    setError("");
    try {
      const linked = steam || id || (username && matchRaProgress(await syncRaProgress(username), game.platformId, game.title)?.id);
      if (!linked) throw new Error("Associez ce jeu avec la recherche RetroAchievements.");
      const rows = await invoke<Achievement[]>("achievements_read", { source: steam ? "steam" : "ra", game: Number(linked), username: steam ? null : username });
      setItems(rows);
      if (!steam) {
        if (id) localStorage.setItem(key, id);
      }
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  const earned = items?.filter((item) => item.earned).length ?? 0;
  const date = (item: Achievement) => typeof item.unlockedAt === "number" ? item.unlockedAt * 1000 : Date.parse(item.unlockedAt ?? "") || 0;
  const badge = items?.filter((item) => item.earned && item.image).sort((a, b) => date(b) - date(a))[0] ?? items?.find((item) => !item.earned && item.image);
  const percent = items?.length ? Math.round(100 * earned / items.length) : 0;
  return <>
    <button type="button" data-focusable onClick={() => setOpen(true)}
      className={`ibox-focusable z-20 shrink-0 rounded-2xl bg-white px-4 py-3 font-bold text-ink shadow-md ring-1 ring-ink/10 hover:bg-cream-deep ${inline ? "flex items-center gap-3" : "absolute right-[3.6rem] bottom-8 flex flex-col items-center gap-1"}`}
      title={badge?.title ?? "Succès"}>
      <span className="grid size-11 place-items-center overflow-hidden rounded-xl bg-mint-soft text-mint-deep">
        {badge?.image ? <img src={badge.image} alt="" className="size-full object-cover" /> : <Icon name="star" size={24} />}
      </span>
      <span className={inline ? "text-left" : "text-xs"}>
        Succès
        {inline && items && <small className="block text-ink-soft">{earned} / {items.length} débloqués</small>}
      </span>
    </button>
    {open && <Modal title={steam ? "Succès Steam" : "RetroAchievements"} subtitle={game.title} onClose={() => setOpen(false)}>
      {!steam && !username && <p className="mb-3 text-ink-soft">Connectez votre compte dans Paramètres → Système → Clé RetroAchievements.</p>}
      {!steam && <div className="mb-3 flex flex-wrap gap-2">
        <input data-focusable aria-label="Titre RetroAchievements" value={query} maxLength={160}
          onChange={(event) => { setQuery(event.target.value); setMatches(undefined); }}
          className="ibox-focusable w-full rounded-xl bg-cream-deep px-3 py-2 text-ink" />
        <Button icon="search" disabled={busy || !username || !query.trim()} onClick={() => void search()}>Trouver le jeu dans RetroAchievements</Button>
        {matches?.map((match) => <Button key={match.id} disabled={busy} onClick={() => { setId(String(match.id)); setItems(undefined); setMatches(undefined); }}>{match.title}{match.count === 0 ? " · Aucun succès publié" : ""}</Button>)}
        {matches?.length === 0 && <p>Aucun jeu correspondant.</p>}
      </div>}
      <Button disabled={busy || (!steam && !username)} icon="download" onClick={() => void load()}>{busy ? "Chargement…" : "Actualiser les succès"}</Button>
      {error && <p role="alert" className="mt-3 text-peach-deep">{error}</p>}
      {items?.length === 0 && <p className="mt-3 text-ink-soft">Ce jeu est référencé, mais aucun succès n’est publié.</p>}
      {!!items?.length && <div className="mt-4 space-y-2">
        <section className="mb-4 rounded-2xl bg-cream-deep p-4 ring-1 ring-ink/10">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div><div className="text-xs font-bold uppercase tracking-wider text-ink-soft">Progression</div>
              <div className="mt-1 font-display text-2xl text-ink">{earned} <span className="text-sm text-ink-soft">/ {items.length} débloqués</span></div></div>
            <span className="rounded-full bg-mint-soft px-3 py-1 font-bold text-mint-deep">{percent} %</span>
          </div>
          <div role="progressbar" aria-label="Progression des succès" aria-valuenow={percent} className="h-2.5 overflow-hidden rounded-full bg-ink/15">
            <div className="h-full rounded-full bg-gradient-to-r from-sky-deep to-mint-deep motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${percent}%` }} />
          </div>
        </section>
        {user?.achievementHighlight !== undefined && <div className="flex flex-wrap items-center gap-2">
          <Button disabled={socialBusy || !earned} icon="star" onClick={async () => {
            const ok = await act("profile", { achievementHighlight: { source: steam ? "Steam" : "RetroAchievements", title: game.title.slice(0,160), earned, total: items.length } });
            setShared(ok ? "Progression visible par vos amis." : "Partage indisponible. Réessayez dans un instant.");
          }}>Partager sur mon profil</Button>
          {user.achievementHighlight && <Button disabled={socialBusy} onClick={async () => {
            if (await act("profile", { achievementHighlight: null })) setShared("Progression retirée.");
          }}>Retirer du profil</Button>}
          {shared && <p role="status">{shared}</p>}
        </div>}
        {items.map((item, i) => <div key={i} className="flex items-center gap-3 rounded-xl bg-cream-deep p-3">
          {item.image && <img loading="lazy" src={item.image} alt="" className={`size-12 rounded-lg ${item.earned ? "" : "grayscale"}`} />}
          <div className="min-w-0 flex-1"><p data-no-i18n className="font-bold text-ink">{item.title}</p><p data-no-i18n className="text-sm text-ink-soft">{item.description}</p></div>
          <span className={item.earned ? "text-mint-deep" : "text-ink-soft"}>{item.earned ? "Débloqué" : "Verrouillé"}</span>
        </div>)}
      </div>}
    </Modal>}
  </>;
}
