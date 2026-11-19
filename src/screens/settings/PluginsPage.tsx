import { lazy, Suspense, useCallback, useEffect, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { Avatar } from "@/components/profile/Avatar";
import { openPlayer } from "@/components/social/PlayerProfile";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { call } from "@/services/inetbox";
import { formatSize, installPlugin, listPlugins, permissionLabel, setPluginEnabled, uninstallPlugin, type PluginAuthor, type PluginList, type PluginView } from "@/services/plugins";
import type { AvatarChoice } from "@/services/settings";
import { sound } from "@/services/sound";
import { Group, Toggle } from "./ui";

/**
 * Réglages propres à un plugin (raccourci, position, compte…), affichés sous sa fiche.
 * Ils restent dans iBox tant que le socle natif qu'ils pilotent y vit.
 */
const PLUGIN_SETTINGS: Record<string, LazyExoticComponent<ComponentType>> = {
  "music-in-the-box": lazy(() => import("@/components/music/MusicSettings").then((m) => ({ default: m.MusicSettings }))),
};

/**
 * Paramètres › Plugins : extensions publiées à part d'iBox, signées par leur éditeur.
 * Les permissions sont affichées avant l'installation ; le créateur est un profil iBox.
 */
export function PluginsPage() {
  const [list, setList] = useState<PluginList | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // fiche ouverte : confirmation d'installation ou de désinstallation
  const [confirm, setConfirm] = useState<{ id: string; action: "install" | "uninstall" } | null>(null);
  // réglages du plugin ouverts sous la liste
  const [settingsOf, setSettingsOf] = useState<string | null>(null);

  const load = useCallback((refresh: boolean) => {
    setError(null);
    listPlugins(refresh).then(setList).catch((e) => setError(String(e)));
  }, []);
  useEffect(() => load(true), [load]);

  const run = async (id: string, job: () => Promise<PluginList>, done: "toggle" | "select" = "select") => {
    setBusy(id);
    setError(null);
    try {
      setList(await job());
      setConfirm(null);
      sound.play(done);
    } catch (e) {
      setError(String(e));
      sound.play("error");
    } finally {
      setBusy(null);
    }
  };

  const installed = list?.plugins.filter((p) => p.installed) ?? [];
  const available = list?.plugins.filter((p) => !p.installed) ?? [];

  return (
    <>
      {list && !list.platformSupported && (
        <Group><p className="text-[0.92rem] font-semibold text-ink-soft">Les plugins sont disponibles sous Windows pour le moment.</p></Group>
      )}
      {error && (
        <div role="alert" className="mb-5 rounded-2xl bg-[#FFE4E4] px-5 py-3 text-[0.92rem] font-bold text-[#9B2C2C]">{error}</div>
      )}
      <Group title="Installés" icon="check" note="Un plugin désactivé ne réserve aucun raccourci et n'ouvre aucune fenêtre.">
        {!list ? (
          <p className="py-3 text-[0.9rem] font-semibold text-ink-soft">Chargement…</p>
        ) : installed.length === 0 ? (
          <p className="py-3 text-[0.9rem] font-semibold text-ink-soft">Aucun plugin installé.</p>
        ) : (
          installed.map((p) => (
            <PluginCard key={p.id} plugin={p} busy={busy === p.id} confirm={confirm?.id === p.id ? confirm.action : null}>
              <div className="flex flex-wrap items-center gap-2">
                <Toggle label={`Activer ${p.name}`} checked={!!p.installed?.enabled} onChange={(v) => void run(p.id, () => setPluginEnabled(p.id, v), "toggle")} />
                {p.update && p.available && (
                  <Button variant="primary" icon="download" disabled={!!busy} onClick={() => setConfirm({ id: p.id, action: "install" })}>
                    Mettre à jour
                  </Button>
                )}
                {PLUGIN_SETTINGS[p.id] && (
                  <Button icon="tune" aria-expanded={settingsOf === p.id} onClick={() => setSettingsOf((v) => (v === p.id ? null : p.id))}>
                    Paramètres
                  </Button>
                )}
                <Button icon="trash" disabled={!!busy} onClick={() => setConfirm({ id: p.id, action: "uninstall" })}>Désinstaller</Button>
              </div>
              {confirm?.id === p.id && (
                <Confirm
                  plugin={p}
                  action={confirm.action}
                  busy={busy === p.id}
                  onCancel={() => setConfirm(null)}
                  onConfirm={() => void run(p.id, () => (confirm.action === "install" ? installPlugin(p.id) : uninstallPlugin(p.id)))}
                />
              )}
            </PluginCard>
          ))
        )}
      </Group>
      {settingsOf && installed.some((p) => p.id === settingsOf) && PLUGIN_SETTINGS[settingsOf] && (
        <Suspense fallback={null}>
          <PluginSettings id={settingsOf} />
        </Suspense>
      )}
      <Group title="Catalogue" icon="download" note="Plugins signés par leur éditeur ; iBox vérifie chaque paquet avant de l'installer.">
        {list?.catalogError && (
          <div className="flex items-center justify-between gap-3 py-3">
            <p className="text-[0.9rem] font-semibold text-ink-soft">{list.catalogError}</p>
            <Button icon="reset" onClick={() => load(true)}>Réessayer</Button>
          </div>
        )}
        {list && !list.catalogError && available.length === 0 && (
          <p className="py-3 text-[0.9rem] font-semibold text-ink-soft">Tous les plugins du catalogue sont installés.</p>
        )}
        {available.map((p) => (
          <PluginCard key={p.id} plugin={p} busy={busy === p.id} confirm={confirm?.id === p.id ? confirm.action : null}>
            {confirm?.id === p.id ? (
              <Confirm plugin={p} action="install" busy={busy === p.id} onCancel={() => setConfirm(null)} onConfirm={() => void run(p.id, () => installPlugin(p.id))} />
            ) : (
              <Button
                variant="primary"
                icon="download"
                disabled={!!busy || !p.available?.compatible || !list?.platformSupported}
                onClick={() => setConfirm({ id: p.id, action: "install" })}
              >
                {p.available?.compatible ? "Installer" : "Version d'iBox trop ancienne"}
              </Button>
            )}
          </PluginCard>
        ))}
      </Group>
    </>
  );
}

function PluginCard({ plugin: p, busy, children }: { plugin: PluginView; busy: boolean; confirm: string | null; children: ReactNode }) {
  const version = p.installed?.version ?? p.available?.version;
  return (
    <div className={`flex flex-col gap-3 py-4 ${busy ? "opacity-70" : ""}`} aria-busy={busy || undefined}>
      <div className="flex items-start gap-4">
        {p.icon ? (
          <img src={p.icon} alt="" className="size-14 shrink-0 rounded-2xl object-cover shadow-sm" />
        ) : (
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[color-mix(in_srgb,var(--tone,var(--accent))_16%,var(--ibox-white))] text-[var(--tone-ink,var(--accent-text))]">
            <Icon name="sparkle" size="1.6em" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[1.05rem] font-bold text-ink">{p.name}</span>
            {version && <span className="text-[0.8rem] font-bold text-ink-faint">{version}</span>}
            {p.update && p.available && <span className="rounded-full bg-[var(--accent-deep)] px-2 py-0.5 text-[0.7rem] font-extrabold text-white">{p.available.version}</span>}
          </div>
          <Creator author={p.author} />
          {p.description && <p className="mt-1 text-[0.86rem] font-semibold text-ink-soft">{p.description}</p>}
        </div>
      </div>
      {busy && <p className="text-[0.85rem] font-bold text-ink-soft">Vérification et installation…</p>}
      <div className="flex flex-col items-start gap-3 pl-[4.5rem]">{children}</div>
    </div>
  );
}

/** Créateur : son profil iBox (photo, nom), cliquable vers sa fiche. */
function Creator({ author }: { author: PluginAuthor }) {
  const [avatar, setAvatar] = useState<AvatarChoice | null>(null);
  const [name, setName] = useState(author.name);
  useEffect(() => {
    if (!author.inetbox) return;
    let live = true;
    call<{ displayName?: string; avatar?: AvatarChoice | null }>("player", undefined, author.inetbox)
      .then((p) => {
        if (!live) return;
        if (p.avatar) setAvatar(p.avatar);
        if (p.displayName) setName(p.displayName);
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [author.inetbox]);
  const content = (
    <>
      <Avatar size={22} name={name} choice={avatar} />
      <span>par {name}</span>
    </>
  );
  if (!author.inetbox) return <div className="mt-0.5 flex items-center gap-1.5 text-[0.82rem] font-bold text-ink-soft">{content}</div>;
  return (
    <button
      data-focusable
      title="Voir le profil"
      onClick={() => openPlayer({ id: author.inetbox!, name, avatar })}
      className="ibox-focusable mt-0.5 inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2 text-[0.82rem] font-bold text-ink-soft [--ring-radius:999px] hover:text-ink"
    >
      {content}
    </button>
  );
}

function Confirm({ plugin: p, action, busy, onCancel, onConfirm }: { plugin: PluginView; action: "install" | "uninstall"; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const size = formatSize(p.available?.size ?? 0);
  return (
    <div className="rounded-2xl bg-cream/70 p-4 ring-1 ring-ink/6">
      {action === "install" ? (
        <>
          <div className="text-[0.92rem] font-bold text-ink">{p.installed ? `Mettre à jour vers ${p.available?.version}` : "Ce plugin pourra :"}</div>
          {p.permissions.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {p.permissions.map((perm) => (
                <li key={perm} className="flex items-center gap-2 text-[0.86rem] font-semibold text-ink-soft">
                  <Icon name="check" size="0.95em" className="text-[var(--accent-deep)]" />
                  {permissionLabel(perm)}
                </li>
              ))}
            </ul>
          )}
          {p.available?.notes && <p className="mt-3 text-[0.84rem] font-semibold whitespace-pre-line text-ink-soft">{p.available.notes}</p>}
          {size && <p className="mt-2 text-[0.78rem] font-bold text-ink-faint">{size}</p>}
        </>
      ) : (
        <div className="text-[0.92rem] font-bold text-ink">Désinstaller {p.name} ? Ses fichiers sont supprimés de ce PC.</div>
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="primary" icon={action === "install" ? "download" : "trash"} disabled={busy} onClick={onConfirm} autoFocus>
          {action === "install" ? (p.installed ? "Mettre à jour" : "Installer") : "Désinstaller"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>Annuler</Button>
      </div>
    </div>
  );
}

function PluginSettings({ id }: { id: string }) {
  const Panel = PLUGIN_SETTINGS[id];
  return <Panel />;
}
