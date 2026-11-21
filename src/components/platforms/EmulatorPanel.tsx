import { EASE, SPRING } from "@/motion/tokens";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { ConsoleInfo } from "@/domain/platformCatalog";
import { EMULATOR_TEXT, MATURITY_LABEL, REQUIREMENT_TEXT } from "@/domain/emulatorTexts";
import { emulatorsApi, formatBytes, installedOf, packageOf, useEmulators, type EmulatorPackage, type Progress, type Requirement } from "@/services/emulators";
import { launcherApi, useLauncher, type Emulator, type Suggestion } from "@/services/launcher";
import { useNav } from "@/app/navigation";
import { useReducedMotion } from "@/app/shellState";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { isActive } from "./status";

const STAGE_LABEL: Record<string, string> = {
  resolving: "Recherche de la dernière version officielle…",
  downloading: "Téléchargement",
  verifying: "Vérification du fichier…",
  extracting: "Extraction",
  installing: "Installation…",
};

/** Section « Y jouer aujourd'hui » : émulateur recommandé, installation, prérequis, alternatives. */
export function EmulatorPanel({ info, requirements, onRequirementsChange }: { info: ConsoleInfo; requirements: Requirement[]; onRequirementsChange: () => void }) {
  const overview = useEmulators((s) => s.overview);
  const { platformMap, emulators } = useLauncher();
  const go = useNav((s) => s.go);
  const current = platformMap[info.id] !== undefined ? emulators.find((e) => e.id === platformMap[info.id]) : undefined;
  const rec = packageOf(overview, info.recommended);
  const alternatives = info.alternatives.map((id) => packageOf(overview, id)).filter(Boolean) as EmulatorPackage[];

  if (!overview) {
    return <p className="text-[0.95rem] font-semibold text-ink-soft">Les émulateurs se gèrent dans l'application Windows d'iBox.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {current && current.packageId !== rec?.id && (
        <CurrentEmulator emu={current} />
      )}
      {rec ? (
        <PackageCard pkg={rec} info={info} recommended current={current} />
      ) : (
        <div className="rounded-xl bg-white/70 p-5 ring-1 ring-ink/6">
          <p className="text-[0.95rem] leading-relaxed font-semibold text-ink-soft">
            iBox n'installe pas d'émulateur pour cette console. Ajoutez celui que vous utilisez déjà : iBox le reconnaîtra et l'associera.
          </p>
          <div className="mt-4">
            <Button icon="gear" onClick={() => go({ name: "settings", category: "pc" })}>
              Ajouter un émulateur
            </Button>
          </div>
        </div>
      )}

      {requirements.length > 0 && <Requirements info={info} items={requirements} onChange={onRequirementsChange} />}

      {alternatives.length > 0 && (
        <section aria-label="Autres émulateurs" className="flex flex-col gap-3">
          <div className="flex items-center gap-3 pt-1">
            <span aria-hidden className="tone-purple grid size-9 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--tone)_16%,var(--ibox-white))] text-[var(--tone-ink)]">
              <Icon name="grid" size="1em" />
            </span>
            <div className="min-w-0">
              <h3 className="font-display text-[1.15rem] font-semibold text-ink">
                {alternatives.length > 1 ? `Ou choisissez parmi ${alternatives.length} autres émulateurs` : "Ou choisissez un autre émulateur"}
              </h3>
              <p className="text-[0.86rem] font-semibold text-ink-soft">
                {alternatives.every((p) => p.automatic) ? "Installation en un clic, comme le recommandé. " : ""}Vous pouvez en garder plusieurs et changer quand vous voulez.
              </p>
            </div>
          </div>
          <div className={`grid gap-3 ${alternatives.length > 1 ? "xl:grid-cols-2" : ""}`}>
            {alternatives.map((p) => (
              <PackageCard key={p.id} pkg={p} info={info} current={current} alternative />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CurrentEmulator({ emu }: { emu: Emulator }) {
  const origin = emu.origin === "managed" ? "installé par iBox" : emu.origin === "detected" ? "trouvé sur ce PC" : "ajouté par vous";
  return (
    <div className="flex items-center gap-3 rounded-xl bg-mint-soft/70 px-4 py-3 text-[0.92rem] font-semibold text-ink">
      <Icon name="check" className="text-mint-deep" />
      <span>
        Cette console utilise <span className="font-bold">{emu.name}</span> ({origin}). iBox ne remplace jamais votre choix.
      </span>
    </div>
  );
}

function Monogram({ name, tone }: { name: string; tone: string }) {
  const letters = name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || name.slice(0, 2);
  return (
    <span
      aria-hidden
      className="grid size-14 shrink-0 place-items-center rounded-2xl font-display text-[1.25rem] font-semibold text-white shadow-sm"
      style={{ background: `linear-gradient(145deg, color-mix(in oklab, ${tone} 85%, white), color-mix(in oklab, ${tone} 80%, #101522))` }}
    >
      {letters}
    </span>
  );
}

function PackageCard({ pkg, info, recommended, current, alternative }: { pkg: EmulatorPackage; info: ConsoleInfo; recommended?: boolean; current?: Emulator; alternative?: boolean }) {
  const overview = useEmulators((s) => s.overview);
  // Linux : émulateur installé depuis Flathub (boutique du Steam Deck), mis à jour par Discover
  const flathub = !!overview?.flathub?.includes(pkg.id);
  const progress = useEmulators((s) => s.progress[pkg.id]);
  const parentProgress = useEmulators((s) => (pkg.requires ? s.progress[pkg.requires] : undefined));
  const latest = useEmulators((s) => s.latest[pkg.id]);
  const { install, cancel, checkLatest, clearProgress, load } = useEmulators();
  const { emulators, load: loadLauncher } = useLauncher();
  const installed = installedOf(overview, pkg.id);
  const parentInstalled = pkg.requires ? installedOf(overview, pkg.requires) : undefined;
  const backup = overview?.backups.find((b) => b.packageId === pkg.id);
  const registered = emulators.find((e) => (pkg.requires ? e.packageId === pkg.requires : e.packageId === pkg.id) && e.origin === "managed");
  const usedHere = !!current && !!registered && current.id === registered.id && (!pkg.requires || current.cores[info.id] !== undefined);
  // installation existante de cet émulateur (même profil), hors iBox
  const external = emulators.find((e) => e.profileId === pkg.profileId && e.origin !== "managed" && e.available);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [detected, setDetected] = useState<Suggestion[] | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const text = EMULATOR_TEXT[pkg.id];
  const shown = progress && progress.stage !== "done" ? progress : parentProgress && isActive(parentProgress) ? parentProgress : progress;
  const working = isActive(shown);
  const updateAvailable = !!installed && !!latest?.version && latest.version !== installed.version;

  // vérification de version à l'ouverture (cache d'une heure côté store)
  useEffect(() => {
    if (installed && pkg.automatic && !pkg.requires) void checkLatest(pkg.id);
  }, [installed, pkg, checkLatest]);

  const run = async (label: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(label);
    setMessage(null);
    try {
      await fn();
      if (ok) setMessage({ tone: "ok", text: ok });
      await Promise.all([load(), loadLauncher()]);
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const tone = info.ambience.glow;
  const done = progress?.stage === "done";

  return (
    <div className={`relative overflow-hidden rounded-xl bg-white/75 p-5 ring-1 shadow-xs ${usedHere ? "ring-2 ring-[var(--tone-green)]/60" : "ring-ink/6"}`}>
      <div className="flex items-start gap-4">
        <Monogram name={pkg.name} tone={tone} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span data-no-i18n className="font-display text-[1.3rem] font-semibold text-ink">{pkg.name}</span>
            {recommended && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[0.72rem] font-bold text-accent-text">Recommandé</span>}
            {alternative && <span className="tone-purple rounded-full bg-[color-mix(in_srgb,var(--tone)_14%,var(--ibox-white))] px-2 py-0.5 text-[0.72rem] font-bold text-[var(--tone-ink)]">Autre choix</span>}
            {usedHere && <span className="tone-green rounded-full bg-[color-mix(in_srgb,var(--tone)_16%,var(--ibox-white))] px-2 py-0.5 text-[0.72rem] font-bold text-[var(--tone-ink)]">Utilisé pour cette console</span>}
            <span className={`rounded-full px-2 py-0.5 text-[0.72rem] font-bold ${pkg.maturity === "experimental" ? "bg-peach-soft text-peach-deep" : "bg-cream-deep text-ink-soft"}`}>
              {MATURITY_LABEL[pkg.maturity]}
            </span>
          </div>
          {text && (
            <>
              <p className="mt-1 text-[0.92rem] font-semibold text-ink-soft">{text.about}</p>
              <p className="mt-1 text-[0.92rem] font-semibold text-ink">{text.why}</p>
            </>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8rem] font-bold text-ink-faint">
            {installed ? (
              <span>
                Version <span data-no-i18n>{installed.version}</span> ·{" "}
                {flathub ? "installé depuis Flathub, mis à jour par Discover" : installed.verified ? "empreinte officielle vérifiée" : "téléchargée depuis la source officielle"}
              </span>
            ) : (
              <span>{flathub ? "Flathub, la boutique du Steam Deck" : pkg.automatic ? "Source officielle" : "Site officiel uniquement"}</span>
            )}
            <span data-no-i18n>{pkg.license}</span>
            {pkg.requires && <span>avec RetroArch</span>}
          </div>
        </div>
      </div>

      {/* action principale selon l'état */}
      <div className="mt-4">
        <AnimatePresence mode="wait" initial={false}>
          {working && shown ? (
            <InstallProgress key="progress" progress={shown} parentName={shown.packageId !== pkg.id ? "RetroArch" : null} onCancel={() => void cancel(shown.packageId)} />
          ) : done ? (
            <Success key="done" name={pkg.name} onDismiss={() => clearProgress(pkg.id)} />
          ) : (
            <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-wrap items-center gap-2.5">
              {!pkg.automatic ? (
                <>
                  <Button variant="primary" icon="globe" onClick={() => void emulatorsApi.openUrl(pkg.homepage)}>
                    Site officiel de {pkg.name}
                  </Button>
                  <Button
                    icon="folder"
                    disabled={!!busy}
                    onClick={() =>
                      void run("add", async () => {
                        const exe = await launcherApi.pickExe();
                        if (!exe) return;
                        const emu = await launcherApi.add(exe);
                        await emulatorsApi.setOrigin(emu.id, "manual");
                        if (current === undefined) await launcherApi.setPlatform(info.id, emu.id);
                      }, "Émulateur ajouté et associé à la console.")
                    }
                  >
                    J'ai installé {pkg.name}
                  </Button>
                </>
              ) : !installed ? (
                <>
                  {external ? (
                    <Button
                      variant="primary"
                      icon="check"
                      data-panel-action
                      disabled={!!busy}
                      onClick={() => void run("use", () => launcherApi.setPlatform(info.id, external.id), `${external.name} est maintenant utilisé pour cette console.`)}
                    >
                      Utiliser mon {external.name}
                    </Button>
                  ) : null}
                  <Button
                    variant={external ? "soft" : "primary"}
                    size={alternative ? "md" : "lg"}
                    icon="download"
                   
                    disabled={!!busy}
                    onClick={() => void install(pkg.id)}
                  >
                    {pkg.requires && !parentInstalled ? `Installer RetroArch et ${pkg.name}` : `Installer ${pkg.name}`}
                  </Button>
                  {!external && (
                    <Button
                      variant="ghost"
                      icon="search"
                      disabled={!!busy}
                      onClick={() =>
                        void run("detect", async () => {
                          const all = await launcherApi.detect();
                          setDetected(all.filter((s) => s.profileId === pkg.profileId));
                        })
                      }
                    >
                      {busy === "detect" ? "Recherche…" : "Déjà installé ? Rechercher sur ce PC"}
                    </Button>
                  )}
                </>
              ) : (
                <>
                  {!usedHere && (
                    <Button
                      variant="primary"
                      icon="check"
                     
                      disabled={!!busy || !registered}
                      onClick={() => registered && void run("use", () => launcherApi.setPlatform(info.id, registered.id), `${pkg.name} est maintenant utilisé pour cette console.`)}
                    >
                      Utiliser pour {info.name}
                    </Button>
                  )}
                  {registered && !pkg.requires && (
                    <Button variant={usedHere ? "primary" : "soft"} icon="open" disabled={!!busy} onClick={() => void run("open", () => emulatorsApi.openEmulator(registered.id))}>
                      Ouvrir {pkg.name}
                    </Button>
                  )}
                  {updateAvailable ? (
                    <Button icon="download" disabled={!!busy} onClick={() => void install(pkg.id)}>
                      Mettre à jour (<span data-no-i18n>{latest?.version}</span>)
                    </Button>
                  ) : (
                    !pkg.requires && (
                      <Button variant="ghost" icon="reset" disabled={!!busy} onClick={() => void run("latest", () => checkLatest(pkg.id, true))}>
                        {latest?.version && latest.version === installed.version ? "À jour" : latest?.error ? "Vérification impossible" : "Rechercher une mise à jour"}
                      </Button>
                    )
                  )}
                  <Button variant="ghost" icon="folder" disabled={!!busy} onClick={() => void run("folder", () => emulatorsApi.openFolder(pkg.id))}>
                    Dossier
                  </Button>
                  {backup && !pkg.requires && (
                    <Button variant="ghost" icon="reset" disabled={!!busy} onClick={() => void run("restore", () => emulatorsApi.restore(pkg.id), `Version ${backup.version} restaurée.`)}>
                      Revenir à la version <span data-no-i18n>{backup.version}</span>
                    </Button>
                  )}
                  {confirmUninstall ? (
                    <span className="flex items-center gap-2 rounded-full bg-peach-soft py-1 pr-1 pl-3 text-[0.85rem] font-bold text-peach-deep">
                      Désinstaller ? Le dossier ira dans les sauvegardes d'iBox.
                      <Button
                        variant="primary"
                        disabled={!!busy}
                        onClick={() =>
                          void run("uninstall", async () => {
                            await emulatorsApi.uninstall(pkg.id);
                            setConfirmUninstall(false);
                          }, `${pkg.name} est désinstallé. Ses fichiers restent récupérables dans les sauvegardes.`)
                        }
                      >
                        Confirmer
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirmUninstall(false)}>
                        Annuler
                      </Button>
                    </span>
                  ) : (
                    <Button variant="ghost" icon="x" disabled={!!busy} onClick={() => setConfirmUninstall(true)}>
                      Désinstaller
                    </Button>
                  )}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {progress?.stage === "error" && !working && (
          <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-peach-soft px-3 py-2 text-[0.88rem] font-semibold text-peach-deep">
            <Icon name="lock" size="1em" className="mt-0.5 shrink-0" />
            <span>
              Installation interrompue : <span>{progress.message}</span>. Rien n'a été modifié dans vos émulateurs.
            </span>
          </div>
        )}
        {progress?.stage === "cancelled" && !working && <p className="mt-3 text-[0.88rem] font-semibold text-ink-soft">Installation annulée. Les fichiers temporaires ont été supprimés.</p>}
        {message && (
          <p role="status" className={`mt-3 text-[0.88rem] font-semibold ${message.tone === "ok" ? "text-mint-deep" : "text-peach-deep"}`}>
            {message.text}
          </p>
        )}
        {detected && (
          <div className="mt-3 flex flex-col gap-2">
            {detected.length === 0 ? (
              <p className="text-[0.88rem] font-semibold text-ink-soft">Aucune installation de {pkg.name} trouvée dans les dossiers habituels.</p>
            ) : (
              detected.map((s) => (
                <div key={s.exePath} className="flex items-center gap-3 rounded-lg bg-cream-deep/70 px-3 py-2">
                  <span data-no-i18n className="min-w-0 flex-1 truncate text-[0.85rem] font-semibold text-ink-soft">{s.exePath}</span>
                  <Button
                    icon="check"
                    onClick={() =>
                      void run("adopt", async () => {
                        const emu = await launcherApi.add(s.exePath);
                        await emulatorsApi.setOrigin(emu.id, "detected");
                        await launcherApi.setPlatform(info.id, emu.id);
                        setDetected(null);
                      }, `Votre installation de ${pkg.name} est maintenant utilisée.`)
                    }
                  >
                    Utiliser celle-ci
                  </Button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-ink/6 pt-3">
        <LinkButton url={pkg.homepage}>Site officiel</LinkButton>
        <LinkButton url={pkg.docs}>Documentation</LinkButton>
        {pkg.compatibility && <LinkButton url={pkg.compatibility}>Jeux compatibles</LinkButton>}
      </div>
    </div>
  );
}

function LinkButton({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <button
      data-focusable
      onClick={() => void emulatorsApi.openUrl(url).catch(() => undefined)}
      className="ibox-focusable inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.84rem] font-bold text-accent-text [--ring-radius:999px] hover:underline"
    >
      {children}
      <Icon name="open" size="0.85em" />
    </button>
  );
}

/** Progression réelle : étape, octets, vitesse ; annulable. */
function InstallProgress({ progress, parentName, onCancel }: { progress: Progress; parentName: string | null; onCancel: () => void }) {
  const reduced = useReducedMotion();
  const pct = progress.stage === "downloading" && progress.total ? Math.min(100, (progress.received / progress.total) * 100) : null;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-2.5" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-[0.9rem] font-bold text-ink">
        <span>
          {parentName && <>{parentName} · </>}
          {STAGE_LABEL[progress.stage] ?? "…"}
          {progress.version && (
            <span className="text-ink-faint">
              {" "}
              · <span data-no-i18n>{progress.version}</span>
            </span>
          )}
        </span>
        <Button variant="ghost" icon="x" onClick={onCancel}>
          Annuler
        </Button>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-ink/8">
        {pct !== null ? (
          <motion.div className="absolute inset-y-0 left-0 rounded-full bg-accent" animate={{ width: `${pct}%` }} transition={{ ease: "linear", duration: 0.25 }} />
        ) : (
          <motion.div
            className="absolute inset-y-0 w-1/3 rounded-full bg-accent/70"
            animate={reduced ? { left: "33%" } : { left: ["-35%", "100%"] }}
            transition={reduced ? undefined : { duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </div>
      <div data-no-i18n className="flex justify-between text-[0.8rem] font-bold text-ink-soft tabular-nums">
        <span>
          {progress.received > 0 && formatBytes(progress.received)}
          {progress.total ? ` / ${formatBytes(progress.total)}` : ""}
        </span>
        <span>{progress.stage === "downloading" && progress.speed > 0 ? `${formatBytes(progress.speed)}/s` : ""}</span>
      </div>
    </motion.div>
  );
}

/** Réussite : petite éclosion de pastilles, puis retour aux actions. */
function Success({ name, onDismiss }: { name: string; onDismiss: () => void }) {
  const reduced = useReducedMotion();
  useEffect(() => {
    const id = window.setTimeout(onDismiss, 4200);
    return () => window.clearTimeout(id);
  }, [onDismiss]);
  const dots = useMemo(() => Array.from({ length: reduced ? 0 : 10 }, (_, i) => ({ a: (i / 10) * Math.PI * 2, d: 34 + (i % 3) * 10 })), [reduced]);
  return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-4 rounded-xl bg-mint-soft px-4 py-3" role="status">
      <span className="relative grid size-11 place-items-center rounded-full bg-mint-deep text-white">
        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={SPRING.pop}>
          <Icon name="check" size="1.3em" />
        </motion.span>
        {dots.map((d, i) => (
          <motion.span
            key={i}
            className="absolute size-1.5 rounded-full bg-mint-deep"
            initial={{ x: 0, y: 0, opacity: 1 }}
            animate={{ x: Math.cos(d.a) * d.d, y: Math.sin(d.a) * d.d, opacity: 0 }}
            transition={{ duration: 0.9, ease: EASE.out }}
          />
        ))}
      </span>
      <div>
        <div className="font-display text-[1.1rem] font-semibold text-ink">{name} est installé</div>
        <div className="text-[0.86rem] font-semibold text-ink-soft">Chemin, profil de lancement et association enregistrés.</div>
      </div>
    </motion.div>
  );
}

function Requirements({ info, items, onChange }: { info: ConsoleInfo; items: Requirement[]; onChange: () => void }) {
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  return (
    <div className="rounded-xl bg-white/60 p-4 ring-1 ring-ink/6">
      <div className="mb-2 text-[0.8rem] font-bold tracking-[0.12em] text-ink-soft uppercase">Avant de jouer</div>
      <ul className="flex flex-col divide-y divide-ink/6">
        {items.map((r) => {
          const t = REQUIREMENT_TEXT[r.id];
          const optional = !r.required && r.state === "missing";
          const icon = r.state === "ok" ? "check" : optional ? "sparkle" : r.state === "missing" ? "lock" : "sparkle";
          const color = r.state === "ok" ? "bg-mint-soft text-mint-deep" : optional ? "bg-sky-soft text-sky-deep" : r.state === "missing" ? "bg-peach-soft text-peach-deep" : "bg-sky-soft text-sky-deep";
          return (
            <li key={r.id} className="flex items-start gap-3 py-3 first:pt-1 last:pb-1">
              <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${color}`}>
                <Icon name={icon} size="0.95em" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-ink">{t?.title ?? r.id}</span>
                  <span className="text-[0.76rem] font-bold text-ink-faint">{r.state === "ok" ? "Présent" : optional ? "Facultatif" : r.state === "missing" ? "Manquant" : "À faire dans l'émulateur"}</span>
                </div>
                {t && <p className="mt-0.5 text-[0.87rem] leading-relaxed font-semibold text-ink-soft">{t.body}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.importable && r.state !== "ok" && (
                    <Button
                      icon="plus"
                      onClick={async () => {
                        const file = await emulatorsApi.pickFile("Choisir le fichier du BIOS");
                        if (!file) return;
                        try {
                          await emulatorsApi.importBios(r.id, file);
                          setMsg((m) => ({ ...m, [r.id]: { ok: true, text: "Fichier importé." } }));
                          onChange();
                        } catch (e) {
                          setMsg((m) => ({ ...m, [r.id]: { ok: false, text: e instanceof Error ? e.message : String(e) } }));
                        }
                      }}
                    >
                      Importer mon fichier
                    </Button>
                  )}
                  {r.folder && (
                    <Button variant="ghost" icon="folder" onClick={() => void emulatorsApi.requirementFolder(info.id, r.id).catch(() => undefined)}>
                      Ouvrir le dossier
                    </Button>
                  )}
                  {r.link && (
                    <Button variant="ghost" icon="open" onClick={() => void emulatorsApi.openUrl(r.link!).catch(() => undefined)}>
                      Guide officiel
                    </Button>
                  )}
                </div>
                {msg[r.id] && <p className={`mt-1.5 text-[0.84rem] font-semibold ${msg[r.id].ok ? "text-mint-deep" : "text-peach-deep"}`}>{msg[r.id].text}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[0.78rem] font-semibold text-ink-faint">iBox ne télécharge jamais de BIOS, de micrologiciel ni de clés : ces fichiers doivent provenir de votre propre console.</p>
    </div>
  );
}
