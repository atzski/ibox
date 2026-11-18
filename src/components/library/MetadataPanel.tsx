import { useCallback, useEffect, useState, type ReactNode } from "react";
import { isLinux } from "@/services/platform";
import { useLibrary } from "@/services/library";
import { useSettings } from "@/services/settings";
import { formatBytes, metadataApi, type MetadataStatus, type ProviderId } from "@/services/metadata";
import { relativeDay } from "@/domain/text";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { sound } from "@/services/sound";

const SOURCES: { id: ProviderId; name: string; provides: string; credit: string }[] = [
  {
    id: "libretro",
    name: "libretro-thumbnails",
    provides: "Jaquettes, écrans-titres, captures et logos — toutes les consoles sauf la Switch.",
    credit: "Sans compte. Illustrations © leurs éditeurs respectifs.",
  },
  {
    id: "gametdb",
    name: "GameTDB",
    provides: "Titres, synopsis, éditeur, année, genre — GameCube, Wii, DS, 3DS. Jaquettes complètes (dos, tranche, face) — GameCube, Wii, 3DS, Switch.",
    credit: "Sans compte. Base collaborative de gametdb.com.",
  },
  {
    id: "launchbox",
    name: "LaunchBox Games Database",
    provides: "Vraies jaquettes : dos, tranche et face de la boîte — Switch 2, Switch, PS1, PS2, PSP, GameCube, Wii, DS, 3DS, rétro.",
    credit: "Sans compte. Base publique gamesdb.launchbox-app.com (≈ 110 Mo, téléchargée une fois par mois).",
  },
  {
    id: "libretro-db",
    name: "libretro-database",
    provides: "Éditeur, développeur, genre, année, joueurs — consoles à cartouche, DS, PSP.",
    credit: "Sans compte. Licence CC BY-SA 4.0.",
  },
  {
    id: "steamgriddb",
    name: "SteamGridDB",
    provides: "Jaquettes et logos de la communauté, y compris pour la Switch.",
    credit: "Clé API personnelle gratuite (steamgriddb.com › Préférences › API).",
  },
];

/** Libellés des bases de référence téléchargées. */
function sourceLabel(id: string): string {
  const [kind, a, b] = id.split(":");
  if (kind === "launchbox") return "LaunchBox Games Database";
  if (kind === "gametdb") return `GameTDB ${a === "wii" ? "GameCube / Wii" : a === "switch" ? "Switch" : a.toUpperCase()}`;
  if (kind === "libretro-db") return `libretro-database ${a}`;
  if (kind === "libretro-thumbs") return `Index libretro ${a} (${b})`;
  return id;
}

/**
 * Sources de métadonnées : activation, clé SteamGridDB (coffre Windows),
 * récupération automatique, bases téléchargées et cache des images.
 */
export function MetadataPanel() {
  const native = useLibrary((s) => s.native);
  const meta = useLibrary((s) => s.meta);
  const fetchMetadata = useLibrary((s) => s.fetchMetadata);
  const reload = useLibrary((s) => s.reload);
  const cancelMetadata = useLibrary((s) => s.cancelMetadata);
  const providers = useSettings((s) => s.metadataProviders);
  const autoFetch = useSettings((s) => s.autoFetchMetadata);
  const set = useSettings((s) => s.set);
  const [status, setStatus] = useState<MetadataStatus | null>(null);
  const [key, setKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const refreshStatus = useCallback(() => {
    if (native) void metadataApi.status().then(setStatus).catch(() => undefined);
  }, [native]);

  useEffect(refreshStatus, [refreshStatus, meta.running]);

  useEffect(() => {
    if (!confirmClear) return;
    const id = window.setTimeout(() => setConfirmClear(false), 4000);
    return () => window.clearTimeout(id);
  }, [confirmClear]);

  if (!native) {
    return (
      <p className="rounded-lg bg-cream-deep px-4 py-3 text-[0.9rem] font-semibold text-ink-soft">
        <Icon name="lock" className="mr-1.5 inline" />
        La récupération des jaquettes est disponible dans l'application Windows (pas dans l'aperçu navigateur).
      </p>
    );
  }

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setMessage(null);
    try {
      await fn();
      if (ok) setMessage({ tone: "ok", text: ok });
      refreshStatus();
    } catch (e) {
      sound.play("error");
      setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };

  const saveKey = async () => {
    setSavingKey(true);
    await run(async () => {
      await metadataApi.setKey("steamgriddb", key);
      setKey("");
    }, isLinux() ? "Clé vérifiée et enregistrée sur cet appareil." : "Clé vérifiée et enregistrée dans le Gestionnaire d'identifiants Windows.");
    setSavingKey(false);
    // les jeux encore sans jaquette sont relancés aussitôt (jaquette, fond, logo)
    const missing = useLibrary
      .getState()
      .games.filter((g) => g.dbId !== undefined && !(g.media ?? []).some((m) => m.kind === "front" || m.kind === "full"))
      .map((g) => g.dbId!);
    if (missing.length) void fetchMetadata(missing);
  };

  const refs = (status?.sources ?? []).filter((s) => !s.id.startsWith("libretro-thumbs"));
  const thumbIndexes = (status?.sources ?? []).filter((s) => s.id.startsWith("libretro-thumbs"));

  return (
    <div>
      <p className="mb-4 text-[0.9rem] font-semibold text-ink-soft">
        Les correspondances sûres (identifiant interne, nom identique, même jeu dans une autre région) sont appliquées
        automatiquement. Les autres vous sont proposées sur la fiche du jeu, jamais appliquées sans vous. Tout est conservé
        sur cet ordinateur et reste disponible hors connexion.
      </p>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(24rem,1fr))] gap-3" data-nav-group="meta-sources">
        {SOURCES.map((s) => (
          <SourceRow
            key={s.id}
            name={s.name}
            provides={s.provides}
            credit={s.credit}
            enabled={providers[s.id] ?? s.id === "launchbox"}
            onToggle={(v) => set("metadataProviders", { ...providers, [s.id]: v })}
          >
            {s.id === "steamgriddb" && (
              <div className="mt-3">
                {status?.steamgriddbKey ? (
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-mint-soft px-3 py-1 text-[0.8rem] font-bold text-mint-deep">
                      <Icon name="key" size="1em" /> {isLinux() ? "Clé enregistrée sur cet appareil" : "Clé enregistrée (coffre Windows)"}
                    </span>
                    <Button cue="back" onClick={() => void run(() => metadataApi.deleteKey("steamgriddb"), "Clé supprimée.")}>
                      Supprimer
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      data-focusable
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      placeholder="Clé API SteamGridDB"
                      aria-label="Clé API SteamGridDB"
                      className="h-10 min-w-0 flex-1 rounded-full bg-white px-4 font-mono text-[0.85rem] text-ink outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    />
                    <Button variant="primary" icon="key" disabled={!key.trim() || savingKey} onClick={() => void saveKey()}>
                      {savingKey ? "Vérification…" : "Enregistrer"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </SourceRow>
        ))}
      </div>

      {message && (
        <div
          role="status"
          className={`mt-4 rounded-lg px-4 py-3 text-[0.88rem] font-bold ${
            message.tone === "ok" ? "bg-mint-soft text-mint-deep" : "bg-peach-soft text-peach-deep"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="primary" icon="sparkle" disabled={meta.running} onClick={() => void fetchMetadata(null)}>
          {meta.running ? "Récupération…" : "Compléter les jeux non traités"}
        </Button>
        <Button icon="reset" disabled={meta.running} onClick={() => void fetchMetadata([], { refreshRefs: true })}>
          Mettre à jour les bases
        </Button>
        {meta.running && (
          <Button cue="back" onClick={() => void cancelMetadata()}>
            Annuler la récupération
          </Button>
        )}
        <label className="ml-auto flex items-center gap-3 text-[0.9rem] font-bold text-ink">
          Après chaque actualisation
          <Switch checked={autoFetch} onChange={(v) => set("autoFetchMetadata", v)} label="Récupérer automatiquement après chaque actualisation" />
        </label>
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 rounded-lg bg-cream-deep px-5 py-4">
        <div className="min-w-0 text-[0.82rem] font-semibold text-ink-soft">
          <div className="font-bold text-ink">
            Cache : {status ? `${status.mediaCount} image${status.mediaCount > 1 ? "s" : ""} · ${formatBytes(status.cacheBytes)}` : "…"}
          </div>
          {refs.length > 0 ? (
            <ul className="mt-1">
              {refs.map((r) => (
                <li key={r.id}>
                  {sourceLabel(r.id)} : {r.items.toLocaleString("fr-FR")} entrées, mise à jour {relativeDay(r.fetchedAt)}
                </li>
              ))}
              {thumbIndexes.length > 0 && <li>{thumbIndexes.length} index d'images libretro en cache</li>}
            </ul>
          ) : (
            <div className="mt-1">Aucune base téléchargée pour l'instant : elles le seront à la première récupération.</div>
          )}
        </div>
        <Button
          cue={confirmClear ? "back" : "toggle"}
          disabled={meta.running || !status || status.mediaCount === 0}
          onClick={() => {
            if (!confirmClear) {
              setConfirmClear(true);
              return;
            }
            setConfirmClear(false);
            void run(async () => {
              const n = await metadataApi.clearCache();
              await reload();
              return n;
            }, "Images téléchargées supprimées. Vos images importées sont conservées.");
          }}
          className={confirmClear ? "!bg-[#B8573A] !text-on-accent" : ""}
          title="Supprime les images téléchargées. Les images que vous avez importées sont conservées."
        >
          {confirmClear ? "Confirmer" : "Vider le cache des images"}
        </Button>
      </div>
    </div>
  );
}

function SourceRow({
  name,
  provides,
  credit,
  enabled,
  onToggle,
  children,
}: {
  name: string;
  provides: string;
  credit: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className={`rounded-lg bg-cream-deep px-4 py-3 transition-opacity ${enabled ? "" : "opacity-65"}`}>
      <div className="flex items-center gap-3">
        <span className="font-display text-[1rem] font-semibold text-ink">{name}</span>
        <span className="ml-auto">
          <Switch checked={enabled} onChange={onToggle} label={`Utiliser ${name}`} />
        </span>
      </div>
      <p className="mt-1 text-[0.85rem] font-semibold text-ink">{provides}</p>
      <p className="mt-0.5 text-[0.78rem] font-semibold text-ink-soft">{credit}</p>
      {enabled && children}
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      data-focusable
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => {
        sound.play("toggle");
        onChange(!checked);
      }}
      className={`ibox-focusable relative h-8 w-14 shrink-0 rounded-full transition-colors [--ring-radius:999px] ${checked ? "bg-mint-deep" : "bg-ink/15"}`}
    >
      <span
        className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-300 ease-[var(--ease-bounce)] ${checked ? "translate-x-6" : ""}`}
      />
    </button>
  );
}
