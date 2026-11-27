import { useEffect, useState } from "react";
import { usePlatform } from "@/services/platform";
import type { Platform } from "@/domain/types";
import { PLATFORMS } from "@/domain/platforms";
import { isTauri } from "@/services/native";
import { sound } from "@/services/sound";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { PlatformGlyph } from "@/components/platform/PlatformGlyph";
import { themeVars } from "@/theme/platformTheme";
import {
  artApi,
  IIDB_CREDIT,
  PLATFORM_SLOTS,
  SLOT_LABEL,
  usePlatformArt,
  usePlatformArtStore,
  type AssetsStatus,
  type IidbAccess,
  type PlatformSlot,
} from "@/services/platformArt";
import { ArtworkPicker } from "./ArtworkPicker";
import { GamesArtPanel } from "./GamesArtPanel";
import { platformOnDevice } from "@/services/capabilities";

const mb = (b: number) => (b === 0 ? "vide" : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} Ko` : `${(b / 1024 / 1024).toFixed(1)} Mo`);

/**
 * Paramètres › Sources graphiques › iiDB. La clé de l'utilisateur est vérifiée
 * (GET /me/access) puis rangée dans le coffre Windows ; elle n'est jamais
 * réaffichée ni écrite dans un journal.
 */
export function IidbPanel() {
  const native = isTauri();
  const android = usePlatform((p) => !!p.android);
  const [status, setStatus] = useState<AssetsStatus | null>(null);
  const [access, setAccess] = useState<IidbAccess | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const sync = usePlatformArtStore((s) => s.sync);
  const runSync = usePlatformArtStore((s) => s.runSync);
  const [picking, setPicking] = useState<{ platform: Platform; slot: PlatformSlot } | null>(null);
  const [linking, setLinking] = useState<Platform | null>(null);

  const reload = async () => {
    if (!native) return;
    const s = await artApi.status().catch(() => null);
    setStatus(s);
    if (s?.connected) setAccess(await artApi.access().catch(() => null));
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!sync.running && sync.report) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.running]);

  const connect = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const a = await artApi.connect(key);
      setKey("");
      setAccess(a);
      sound.play("select");
      setMsg({ tone: "ok", text: "Connecté à iiDB. Récupération des illustrations des consoles…" });
      await reload();
      void runSync();
    } catch (e) {
      sound.play("error");
      setMsg({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  };

  if (!native) {
    return <p className="text-[0.9rem] font-semibold text-ink-soft">iiDB est disponible dans l'application Windows.</p>;
  }

  const r = sync.report;
  const pct = sync.progress && sync.progress.total > 0 ? Math.round((sync.progress.done / sync.progress.total) * 100) : 0;

  return (
    <div>
      <p className="mb-4 max-w-[58rem] text-[0.9rem] font-semibold text-ink-soft">
        {android
          ? "iiDB (projet iiSU) fournit icônes, logos et illustrations de consoles. Chaque personne utilise sa propre clé, à copier depuis son profil iiSU Accounts. Les images sont téléchargées sur cet appareil, jamais intégrées au projet ; sans connexion, iBox garde celles déjà reçues et son propre habillage."
          : "iiDB (projet iiSU) fournit icônes, logos et illustrations de consoles. Chaque personne utilise sa propre clé, à copier depuis son profil iiSU Accounts. Les images sont téléchargées sur cet ordinateur, jamais intégrées au projet ; sans connexion, iBox garde celles déjà reçues et son propre habillage."}
      </p>

      {status?.connected ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-mint-soft px-3 py-1 text-[0.82rem] font-bold whitespace-nowrap text-mint-deep">
            <Icon name="key" size="1em" /> Connecté{access?.tier ? ` · palier ${access.tier}` : ""}
          </span>
          {access && (
            <span className={`text-[0.82rem] font-bold ${access.limitExceeded ? "text-peach-deep" : "text-ink-soft"}`}>
              {access.monthlyUsage} / {access.monthlySoftLimit || "∞"} requêtes ce mois
              {access.requestsPerSecond ? ` · ${access.requestsPerSecond}/s` : ""}
              {access.limitExceeded ? " · limite atteinte" : ""}
            </span>
          )}
          <Button variant="primary" icon="reset" disabled={sync.running} onClick={() => void runSync()}>
            {sync.running ? "Synchronisation…" : "Synchroniser les consoles"}
          </Button>
          <Button
            cue="back"
            disabled={sync.running}
            onClick={() =>
              void artApi.disconnect().then(async () => {
                setAccess(null);
                setMsg({ tone: "ok", text: "Clé supprimée. Les illustrations déjà téléchargées restent disponibles." });
                await reload();
              })
            }
          >
            Déconnecter
          </Button>
        </div>
      ) : (
        <div className="flex max-w-[40rem] flex-wrap items-center gap-2">
          <input
            data-focusable
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && key.trim() && void connect()}
            placeholder="Clé API iiDB"
            aria-label="Clé API iiDB"
            className="h-10 min-w-[16rem] flex-1 rounded-full bg-white px-4 font-mono text-[0.85rem] text-ink outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          <Button variant="primary" icon="key" disabled={!key.trim() || busy} onClick={() => void connect()}>
            {busy ? "Vérification…" : "Connecter iiDB"}
          </Button>
        </div>
      )}
      {msg && <p className={`mt-2 text-[0.82rem] font-bold ${msg.tone === "ok" ? "text-[var(--accent-deep)]" : "text-peach-deep"}`}>{msg.text}</p>}

      {(sync.running || r || sync.error) && (
        <div className="mt-4 max-w-[40rem] rounded-lg bg-cream-deep/70 px-4 py-3">
          {sync.running && (
            <>
              <div className="flex justify-between text-[0.8rem] font-bold text-ink-soft">
                <span>{sync.progress?.total ? `Téléchargement ${sync.progress.done} / ${sync.progress.total}` : "Recherche des consoles…"}</span>
                <span>{sync.progress?.current}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300" style={{ width: `${pct}%` }} />
              </div>
            </>
          )}
          {!sync.running && r && (
            <p className="text-[0.82rem] font-bold text-ink">
              <span>{`${r.matched} console${r.matched > 1 ? "s" : ""} reconnue${r.matched > 1 ? "s" : ""}`}</span>
              {r.needsChoice ? ` · ${r.needsChoice} à choisir` : ""}
              {r.notFound ? ` · ${r.notFound} introuvable${r.notFound > 1 ? "s" : ""}` : ""}{" · "}
              <span>{`${r.downloaded} image${r.downloaded > 1 ? "s" : ""} téléchargée${r.downloaded > 1 ? "s" : ""}`}</span>
              {r.upToDate ? ` · ${r.upToDate} à jour` : ""}
              {r.keptManual ? ` · ${r.keptManual} choix conservé${r.keptManual > 1 ? "s" : ""}` : ""}
              {r.failed ? ` · ${r.failed} échec${r.failed > 1 ? "s" : ""}` : ""}
            </p>
          )}
          {!sync.running && r?.errors.map((e) => (
            <p key={e} data-no-i18n className="mt-1 text-[0.76rem] font-semibold text-peach-deep">
              {e}
            </p>
          ))}
          {sync.error && <p className="text-[0.82rem] font-bold text-peach-deep">{sync.error}</p>}
        </div>
      )}

      {status && (
        <p className="mt-3 text-[0.8rem] font-bold text-ink-soft">
          <span>{`${status.linked} console${status.linked > 1 ? "s" : ""} associée${status.linked > 1 ? "s" : ""}`}</span>
          {" · "}
          <span>{`${status.assets} illustration${status.assets > 1 ? "s" : ""}`}</span>
          {` · cache ${mb(status.cacheBytes)}`}
        </p>
      )}

      {status?.connected && <GamesArtPanel />}

      <h3 className="mt-6 text-[1rem] font-bold text-ink">Consoles</h3>
      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(27rem,1fr))] gap-3" data-nav-group="iidb-platforms">
        {PLATFORMS.filter((p) => platformOnDevice(p.id)).map((p) => (
          <PlatformArtRow key={p.id} platform={p} onPick={(slot) => setPicking({ platform: p, slot })} onLink={() => setLinking(p)} connected={!!status?.connected} />
        ))}
      </div>

      <p className="mt-4 text-[0.72rem] font-semibold text-ink-faint">{IIDB_CREDIT} Données de catalogue iiDB sous licence CC BY-SA 4.0.</p>

      {picking && <ArtworkPicker platform={picking.platform} slot={picking.slot} onClose={() => setPicking(null)} />}
      {linking && <LinkModal platform={linking} onClose={() => setLinking(null)} />}
    </div>
  );
}

function PlatformArtRow({ platform, onPick, onLink, connected }: { platform: Platform; onPick: (s: PlatformSlot) => void; onLink: () => void; connected: boolean }) {
  const link = usePlatformArtStore((s) => s.links.find((l) => l.platformId === platform.id));
  const state = !link
    ? { text: "Pas encore synchronisée", tone: "text-ink-faint" }
    : link.status === "matched" || link.status === "manual"
      ? { text: `${link.status === "manual" ? "Associée à la main" : "Reconnue"} : ${link.remoteName ?? "—"}`, tone: "text-[var(--accent-deep)]" }
      : link.status === "needs_choice"
        ? { text: "Plusieurs correspondances : à choisir", tone: "text-peach-deep" }
        : { text: "Introuvable dans iiDB", tone: "text-ink-soft" };
  return (
    <div className="rounded-lg bg-cream-deep/70 px-4 py-3" style={themeVars(platform)}>
      <div className="flex items-center gap-2">
        <PlatformGlyph glyph={platform.glyph} size={20} />
        <span className="text-[0.95rem] font-bold text-ink">{platform.shortName}</span>
        <span className={`ml-auto truncate text-[0.74rem] font-bold ${state.tone}`}>{state.text}</span>
        {connected && link && link.status !== "matched" && (
          <button data-focusable onClick={onLink} className="ibox-focusable rounded-full bg-white px-2.5 py-0.5 text-[0.72rem] font-extrabold text-accent-text [--ring-radius:999px]">
            Associer…
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-[3.2rem_3.2rem_1fr_1fr] gap-2">
        {PLATFORM_SLOTS.map((slot) => (
          <SlotThumb key={slot} platform={platform} slot={slot} onClick={() => onPick(slot)} />
        ))}
      </div>
    </div>
  );
}

function SlotThumb({ platform, slot, onClick }: { platform: Platform; slot: PlatformSlot; onClick: () => void }) {
  const url = usePlatformArt(platform.id, slot);
  const wide = slot === "platform_hero" || slot === "platform_border";
  return (
    <button
      data-focusable
      onClick={onClick}
      title={`${SLOT_LABEL[slot]} — changer`}
      aria-label={`${SLOT_LABEL[slot]} de ${platform.shortName}`}
      className={`ibox-focusable relative grid h-[3.2rem] place-items-center overflow-hidden rounded-md shadow-xs [--ring-radius:var(--radius-md)] ${slot === "platform_logo" && url ? "bg-[#8691a3]" : "bg-white"}`}
    >
      {url ? (
        <img src={url} alt="" className={`h-full w-full ${wide ? "object-cover" : "object-contain p-1"}`} />
      ) : (
        <span className="text-[0.62rem] font-extrabold tracking-wide text-ink-faint uppercase">{SLOT_LABEL[slot]}</span>
      )}
    </button>
  );
}

/** Association manuelle d'une console à une plateforme iiDB (choix ou recherche). */
function LinkModal({ platform, onClose }: { platform: Platform; onClose: () => void }) {
  const link = usePlatformArtStore((s) => s.links.find((l) => l.platformId === platform.id));
  const refresh = usePlatformArtStore((s) => s.refresh);
  const runSync = usePlatformArtStore((s) => s.runSync);
  const [q, setQ] = useState(platform.name);
  const [results, setResults] = useState<[number, string][]>(link?.candidates ?? []);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setError(null);
    try {
      setResults(await artApi.search(q));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const choose = async (id: number, name: string) => {
    await artApi.link(platform.id, id, name);
    await refresh();
    sound.play("select");
    onClose();
    void runSync();
  };

  return (
    <Modal title={`Associer ${platform.shortName}`} subtitle="Plateforme iiDB correspondante" onClose={onClose} width="36rem">
      <div className="flex gap-2">
        <input
          data-focusable
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search()}
          aria-label="Rechercher une plateforme"
          className="h-10 flex-1 rounded-full bg-white px-4 text-[0.9rem] text-ink outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
        <Button icon="search" onClick={() => void search()}>
          Rechercher
        </Button>
      </div>
      {error && <p className="mt-2 text-[0.82rem] font-bold text-peach-deep">{error}</p>}
      <div className="mt-3 flex flex-col gap-2">
        {results.map(([id, name]) => (
          <button
            key={id}
            data-focusable
            onClick={() => void choose(id, name)}
            className="ibox-focusable rounded-lg bg-cream-deep px-4 py-2.5 text-left text-[0.92rem] font-bold text-ink [--ring-radius:var(--radius-lg)]"
          >
            {name}
          </button>
        ))}
        {results.length === 0 && <p className="text-[0.85rem] font-semibold text-ink-soft">Lancez une recherche pour voir les plateformes iiDB.</p>}
      </div>
    </Modal>
  );
}
