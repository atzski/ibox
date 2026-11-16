import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PLATFORMS, getPlatform } from "@/domain/platforms";
import { launcherApi, useLauncher, type Emulator, type Suggestion } from "@/services/launcher";
import { useSettings } from "@/services/settings";
import { useLibrary } from "@/services/library";
import { themeVars } from "@/theme/platformTheme";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { PlatformGlyph } from "@/components/platform/PlatformGlyph";
import { sound } from "@/services/sound";

/**
 * Émulateurs : iBox n'en télécharge aucun. Vous désignez ceux que vous avez
 * installés ; leur profil de lancement est reconnu d'après le programme.
 */
export function EmulatorsPanel() {
  const native = useLibrary((s) => s.native);
  const { emulators, platformMap, load } = useLauncher();
  const alternatives = useSettings((s) => s.emulatorAlternatives);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [editing, setEditing] = useState<Emulator | null>(null);
  const [choosingFor, setChoosingFor] = useState<string | null>(null);

  if (!native) {
    return (
      <p className="rounded-lg bg-cream-deep px-4 py-3 text-[0.9rem] font-semibold text-ink-soft">
        <Icon name="lock" className="mr-1.5 inline" />
        Le lancement des jeux est disponible dans l'application Windows (pas dans l'aperçu navigateur).
      </p>
    );
  }

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      sound.play("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const add = (path: string) =>
    run(async () => {
      await launcherApi.add(path);
      sound.play("select");
      setSuggestions((s) => s?.filter((x) => x.exePath !== path) ?? null);
    });

  return (
    <div>
      <p className="mb-4 text-[0.9rem] font-semibold text-ink-soft">
        Indiquez les émulateurs installés sur ce PC : iBox n'en télécharge aucun. Le profil de lancement (Dolphin, PCSX2,
        melonDS…) est reconnu automatiquement et reste modifiable. Les jeux sont lancés sans passer par une ligne de
        commande : un nom de fichier ne peut rien déclencher d'autre.
      </p>

      {/* Émulateurs enregistrés */}
      <div className="flex flex-col gap-2" data-nav-group="emulators">
        <AnimatePresence initial={false}>
          {emulators.map((e) => (
            <EmulatorRow key={e.id} emu={e} onEdit={() => setEditing(e)} onChanged={() => void load()} onError={setError} />
          ))}
        </AnimatePresence>
        {emulators.length === 0 && (
          <div className="rounded-lg border-2 border-dashed border-ink/10 px-5 py-6 text-center text-[0.95rem] font-semibold text-ink-soft">
            Aucun émulateur pour l'instant.
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          icon="folder"
          onClick={() =>
            void run(async () => {
              const path = await launcherApi.pickExe();
              if (path) await add(path);
            })
          }
        >
          Ajouter un émulateur…
        </Button>
        <Button
          icon="search"
          disabled={detecting}
          onClick={() => {
            setDetecting(true);
            void launcherApi
              .detect()
              .then(setSuggestions)
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
              .finally(() => setDetecting(false));
          }}
        >
          {detecting ? "Recherche…" : "Rechercher les émulateurs installés"}
        </Button>
      </div>

      {suggestions && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-3 rounded-lg bg-cream-deep p-4">
          {suggestions.length === 0 ? (
            <p className="text-[0.9rem] font-semibold text-ink-soft">
              Aucun nouvel émulateur trouvé dans les dossiers habituels. Utilisez « Ajouter un émulateur… ».
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Trouvés sur ce PC</div>
              {suggestions.map((s) => (
                <div key={s.exePath} className="flex items-center gap-3 rounded-lg bg-white/70 px-3 py-2">
                  <span className="font-display text-[0.98rem] font-semibold text-ink">{s.name}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[0.78rem] text-ink-soft" title={s.exePath}>
                    {s.exePath}
                  </span>
                  <Button icon="plus" onClick={() => void add(s.exePath)}>
                    Ajouter
                  </Button>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {error && (
        <div role="alert" className="mt-3 rounded-lg bg-peach-soft px-4 py-3 text-[0.9rem] font-bold text-peach-deep">
          {error}
        </div>
      )}

      {/* Émulateur par console */}
      <h3 className="mt-7 mb-3 text-[1.05rem] font-semibold text-ink">Émulateurs par console</h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2" data-nav-group="platform-emulators">
        {PLATFORMS.filter((p) => p.id !== "pc").map((p) => {
          const emu = emulators.find((e) => e.id === platformMap[p.id]);
          const missingCore = emu?.needsCore && !emu.cores[p.id];
          return (
            <button
              key={p.id}
              data-focusable
              onClick={() => {
                sound.play("select");
                setChoosingFor(p.id);
              }}
              style={themeVars(p)}
              className="ibox-focusable flex items-center gap-3 rounded-lg bg-cream-deep px-3 py-2.5 text-left [--ring-radius:var(--radius-lg)]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-accent-text">
                <PlatformGlyph glyph={p.glyph} size={22} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.9rem] font-bold text-ink">{p.shortName}</span>
                <span className={`block truncate text-[0.78rem] font-bold ${emu && !missingCore ? "text-ink-soft" : "text-peach-deep"}`}>
                  {emu ? (missingCore ? `${emu.name} — cœur à choisir` : emu.name) : "Aucun émulateur"}
                  {emulators.filter((e) => e.id !== emu?.id && alternatives?.[p.id]?.includes(e.id)).length > 0 && " · Alternatives"}
                </span>
              </span>
              <Icon name="chevronRight" className="text-ink-faint" />
            </button>
          );
        })}
      </div>

      {choosingFor && (
        <ChooseEmulatorModal
          title={`Émulateur ${getPlatform(choosingFor)?.shortName ?? ""}`}
          platform={choosingFor}
          emulators={emulators}
          value={platformMap[choosingFor] ?? null}
          noneLabel="Aucun par défaut"
          alternatives={alternatives?.[choosingFor] ?? []}
          onToggleAlternative={(id) => {
            const settings = useSettings.getState();
            const ids = settings.emulatorAlternatives?.[choosingFor] ?? [];
            settings.set("emulatorAlternatives", {
              ...settings.emulatorAlternatives,
              [choosingFor]: ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
            });
          }}
          onClose={() => setChoosingFor(null)}
          onChoose={(id) => {
            const platform = choosingFor;
            void run(() => launcherApi.setPlatform(platform, id));
          }}
        />
      )}
      {editing && <EmulatorModal emu={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />}
    </div>
  );
}

function EmulatorRow({ emu, onEdit, onChanged, onError }: { emu: Emulator; onEdit: () => void; onChanged: () => void; onError: (m: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const id = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(id);
  }, [confirming]);

  const act = (fn: () => Promise<unknown>) =>
    fn()
      .then(onChanged)
      .catch((e) => onError(e instanceof Error ? e.message : String(e)));

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} className="flex items-center gap-4 rounded-lg bg-cream-deep px-4 py-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-ink-soft">
        <Icon name="gamepad" size="1.3em" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-display text-[1.02rem] font-semibold text-ink">{emu.name}</span>
          {emu.profileId !== "custom" && emu.profileName !== emu.name && (
            <span className="rounded-full bg-white px-2 py-0.5 text-[0.68rem] font-extrabold text-ink-soft uppercase">{emu.profileName}</span>
          )}
          {emu.platforms.map((pid) => {
            const p = getPlatform(pid);
            return p ? (
              <span key={pid} style={themeVars(p)} className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[0.7rem] font-bold text-accent-text">
                {p.shortName}
              </span>
            ) : null;
          })}
        </div>
        <div className="truncate font-mono text-[0.78rem] text-ink-soft" title={emu.exePath}>
          {emu.exePath}
        </div>
        {!emu.available && (
          <div className="text-[0.78rem] font-bold text-peach-deep">Programme introuvable : déplacé ou désinstallé ?</div>
        )}
      </div>
      <label className="flex items-center gap-2 text-[0.82rem] font-bold text-ink-soft">
        Plein écran
        <Switch
          checked={emu.fullscreen}
          label={`Plein écran pour ${emu.name}`}
          onChange={(v) => void act(() => launcherApi.update(emu.id, { name: emu.name, args: emu.args, fullscreen: v, cores: emu.cores }))}
        />
      </label>
      <Button icon="gear" onClick={onEdit}>
        Réglages
      </Button>
      <Button
        cue={confirming ? "back" : "toggle"}
        onClick={() => {
          if (!confirming) return setConfirming(true);
          void act(() => launcherApi.remove(emu.id));
        }}
        className={confirming ? "!bg-[#B8573A] !text-on-accent" : ""}
        title="Retire l'émulateur d'iBox. Il n'est pas désinstallé."
      >
        {confirming ? "Confirmer" : "Retirer"}
      </Button>
    </motion.div>
  );
}

/** Choix d'un émulateur (console ou jeu). Les émulateurs adaptés sont proposés d'abord. */
export function ChooseEmulatorModal({
  title,
  platform,
  emulators,
  value,
  onClose,
  onChoose,
  noneLabel = "Aucun",
  alternatives = [],
  onToggleAlternative,
}: {
  title: string;
  platform: string;
  emulators: Emulator[];
  value: number | null;
  onClose: () => void;
  onChoose: (id: number | null) => void;
  noneLabel?: string;
  alternatives?: number[];
  onToggleAlternative?: (id: number) => void;
}) {
  // choix affichés aussitôt (l'enregistrement se fait en arrière-plan) : la fenêtre reste ouverte
  const [current, setCurrent] = useState<number | null>(value);
  const [alts, setAlts] = useState<number[]>(alternatives);
  const [saved, setSaved] = useState(false);
  useEffect(() => setCurrent(value), [value]);
  const altKey = alternatives.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setAlts(alternatives), [altKey]);
  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(false), 1600);
    return () => window.clearTimeout(t);
  }, [saved]);
  const sorted = [...emulators].sort(
    (a, b) => Number(b.suggestedPlatforms.includes(platform)) - Number(a.suggestedPlatforms.includes(platform)) || a.name.localeCompare(b.name),
  );
  const choose = (id: number | null) => {
    setCurrent(id);
    // le profil par défaut n'est pas aussi une alternative
    if (id !== null && alts.includes(id) && onToggleAlternative) {
      setAlts((list) => list.filter((x) => x !== id));
      onToggleAlternative(id);
    }
    onChoose(id);
    setSaved(true);
  };
  const toggle = (id: number) => {
    if (!onToggleAlternative || id === current) return;
    sound.play("toggle");
    setAlts((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
    onToggleAlternative(id);
    setSaved(true);
  };
  const name = (id: number) => emulators.find((e) => e.id === id)?.name ?? "?";
  return (
    <Modal title={title} subtitle={onToggleAlternative ? "Touchez un émulateur pour en faire le profil par défaut, cochez les alternatives proposées au lancement." : "Touchez un émulateur pour le choisir."} onClose={onClose}>
      <div className="mb-3 flex items-center gap-2 rounded-xl bg-[var(--accent-soft)] px-4 py-3 text-[0.88rem] font-semibold text-ink">
        <Icon name="star" filled size="1em" className="shrink-0 text-[var(--accent-deep)]" />
        <span className="min-w-0 flex-1">
          <b>Par défaut :</b> {current === null ? noneLabel : name(current)}
          {onToggleAlternative && <><br /><b>Alternatives :</b> {alts.filter((a) => a !== current).map(name).join(", ") || "aucune"}</>}
        </span>
        <AnimatePresence>
          {saved && (
            <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[0.75rem] font-extrabold text-[#2F7A57]">
              <Icon name="check" size="0.9em" /> Enregistré
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="flex max-h-[52vh] flex-col gap-2 overflow-y-auto pr-1">
        <ChoiceRow label={noneLabel} detail="" active={current === null} autoFocus={current === null} onClick={() => choose(null)} />
        {sorted.map((e) => {
          const isAlt = alts.includes(e.id) && e.id !== current;
          return (
            <div key={e.id} className="flex items-center gap-2 [&>button:first-child]:flex-1">
              <ChoiceRow
                label={e.name}
                detail={e.suggestedPlatforms.includes(platform) ? "Recommandé pour cette console" : e.profileId === "custom" ? "Profil personnalisé" : "Non prévu pour cette console"}
                active={current === e.id}
                autoFocus={current === e.id}
                onClick={() => choose(e.id)}
              />
              {onToggleAlternative && (
                <button
                  data-focusable
                  aria-pressed={isAlt}
                  disabled={e.id === current}
                  onClick={() => toggle(e.id)}
                  title={e.id === current ? "Profil par défaut" : isAlt ? "Retirer des alternatives" : "Ajouter aux alternatives"}
                  className={`ibox-focusable flex h-14 w-36 shrink-0 items-center justify-center gap-1.5 rounded-lg text-[0.82rem] font-bold [--ring-radius:var(--radius-lg)] disabled:opacity-40 ${
                    isAlt ? "bg-[#DDF6EA] text-[#2F7A57]" : "bg-cream-deep text-ink-soft hover:text-ink"
                  }`}
                >
                  <Icon name={isAlt ? "check" : "plus"} size="1em" />
                  {e.id === current ? "Par défaut" : isAlt ? "Alternative" : "Alternative"}
                </button>
              )}
            </div>
          );
        })}
        {emulators.length === 0 && (
          <p className="rounded-lg bg-cream-deep px-4 py-3 text-[0.9rem] font-semibold text-ink-soft">
            Ajoutez d'abord un émulateur dans les paramètres.
          </p>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="primary" icon="check" onClick={onClose}>Terminé</Button>
      </div>
    </Modal>
  );
}

function ChoiceRow({ label, detail, active, autoFocus, onClick }: { label: string; detail: string; active: boolean; autoFocus?: boolean; onClick: () => void }) {
  return (
    <button
      data-focusable
      data-autofocus={autoFocus || undefined}
      aria-pressed={active}
      onClick={() => {
        sound.play("toggle");
        onClick();
      }}
      className={`ibox-focusable flex h-14 items-center gap-3 rounded-lg px-4 text-left [--ring-radius:var(--radius-lg)] ${
        active ? "bg-[var(--accent-deep)] text-on-accent" : "bg-cream-deep text-ink hover:bg-[var(--accent-soft)]"
      }`}
    >
      <span className="font-bold">{label}</span>
      {detail && <span className={`text-[0.8rem] font-semibold ${active ? "opacity-80" : "text-ink-soft"}`}>{detail}</span>}
    </button>
  );
}

/** Réglages avancés : nom, arguments (avec aperçu), cœurs RetroArch. */
export function EmulatorModal({ emu, onClose, onSaved }: { emu: Emulator; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(emu.name);
  const [argsText, setArgsText] = useState(emu.args.map((a) => (/\s/.test(a) || a === "" ? `"${a}"` : a)).join(" "));
  const [cores, setCores] = useState<Record<string, string>>(emu.cores);
  const [available, setAvailable] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (emu.needsCore) void launcherApi.cores(emu.id).then(setAvailable).catch(() => undefined);
  }, [emu.id, emu.needsCore]);

  const save = async () => {
    setError(null);
    try {
      const args = await launcherApi.splitArgs(argsText);
      await launcherApi.update(emu.id, { name, args, fullscreen: emu.fullscreen, cores });
      sound.play("select");
      onSaved();
      onClose();
    } catch (e) {
      sound.play("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal title={`Réglages — ${emu.name}`} subtitle={emu.exePath} onClose={onClose} width="44rem">
      <label className="block">
        <span className="text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Nom</span>
        <input
          data-focusable
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-2 h-11 w-full rounded-full bg-cream-deep px-5 font-bold text-ink outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </label>
      <label className="mt-5 block">
        <span className="text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Arguments de lancement</span>
        <input
          data-focusable
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          spellCheck={false}
          className="mt-2 h-11 w-full rounded-full bg-cream-deep px-5 font-mono text-[0.88rem] text-ink outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
        <span className="mt-2 block text-[0.8rem] font-semibold text-ink-soft">
          <code className="font-mono">{"{rom}"}</code> : fichier du jeu (obligatoire) · <code className="font-mono">{"{fullscreen}"}</code> : options
          de plein écran du profil · <code className="font-mono">{"{core}"}</code> : cœur RetroArch. Guillemets doubles pour un
          argument contenant des espaces.
        </span>
      </label>

      {emu.needsCore && (
        <div className="mt-5">
          <span className="text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Cœur par console</span>
          {available.length === 0 ? (
            <p className="mt-2 rounded-lg bg-cream-deep px-4 py-3 text-[0.88rem] font-semibold text-ink-soft">
              Aucun cœur trouvé dans le dossier « cores » de RetroArch. Installez-en depuis RetroArch (menu Mise à jour en ligne).
            </p>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {emu.suggestedPlatforms.map((pid) => (
                <label key={pid} className="flex items-center gap-2 rounded-lg bg-cream-deep px-3 py-2 text-[0.85rem] font-bold text-ink">
                  <span className="w-20 shrink-0">{getPlatform(pid)?.shortName}</span>
                  <select
                    data-focusable
                    value={cores[pid] ?? ""}
                    onChange={(e) =>
                      setCores((c) => {
                        const next = { ...c };
                        if (e.target.value) next[pid] = e.target.value;
                        else delete next[pid];
                        return next;
                      })
                    }
                    className="min-w-0 flex-1 rounded-full bg-white px-3 py-1.5 font-mono text-[0.78rem] text-ink outline-none"
                  >
                    <option value="">—</option>
                    {available.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div role="alert" className="mt-4 rounded-lg bg-peach-soft px-4 py-3 text-[0.9rem] font-bold text-peach-deep">
          {error}
        </div>
      )}
      <div className="mt-6 flex justify-end gap-3">
        <Button cue="back" onClick={onClose}>
          Annuler
        </Button>
        <Button variant="primary" icon="sparkle" onClick={() => void save()}>
          Enregistrer
        </Button>
      </div>
    </Modal>
  );
}
