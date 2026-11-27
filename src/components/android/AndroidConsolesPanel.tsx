import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { getPlatform } from "@/domain/platforms";
import { consoleInfo } from "@/domain/platformCatalog";
import { useNav } from "@/app/navigation";
import { useLibrary } from "@/services/library";
import { androidEmulatorsApi, onAndroidResumed, useAndroidEmulators, type AndroidPlatformDetail } from "@/services/androidEmulators";
import { sound } from "@/services/sound";
import { PlatformGlyph } from "@/components/platform/PlatformGlyph";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { input } from "@/input/InputController";
import { AndroidBiosPanel, RetroArchCoreHint } from "./AndroidBiosPanel";

interface Row {
  platform: string;
  installed: number;
  effective: string | null;
  preferred: boolean;
}

/**
 * Paramètres › Consoles sur Android (docs/ANDROID.md §17) : pour chaque console, l'émulateur
 * utilisé (choisi par vous ou par iBox), à changer à la manette ou au toucher ; ce qui manque
 * renvoie à la fiche de la console dans iBox Platforms (installation, BIOS).
 */
export function AndroidConsolesPanel() {
  const games = useLibrary((s) => s.realGames);
  const go = useNav((s) => s.go);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    androidEmulatorsApi
      .all()
      .then((all) =>
        setRows(
          all
            .filter((p) => p.options.length > 0)
            .map((p) => ({
              platform: p.platform,
              installed: p.options.filter((o) => o.component).length,
              effective: p.options.find((o) => o.label === p.effective)?.name ?? null,
              preferred: !!p.preferred,
            })),
        ),
      )
      .catch((e: Error) => setError(e.message));
    void useAndroidEmulators.getState().load();
  }, []);
  useEffect(() => {
    load();
    let off: (() => void) | null = null;
    let stopped = false;
    void onAndroidResumed(load).then((f) => (stopped ? f() : (off = f)));
    return () => {
      stopped = true;
      off?.();
    };
  }, [load]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of games) m.set(g.platformId, (m.get(g.platformId) ?? 0) + 1);
    return m;
  }, [games]);

  if (error) return <p className="rounded-lg bg-peach-soft px-4 py-3 text-[0.9rem] font-bold text-peach-deep">{error}</p>;
  if (!rows) return <p className="text-[0.92rem] font-semibold text-ink-soft">Recherche des émulateurs installés…</p>;

  const known = rows.filter((r) => getPlatform(r.platform));
  // consoles qui ont des jeux, ou un émulateur choisi par l'utilisateur ; les autres sous « Autres consoles »
  const used = known.filter((r) => (counts.get(r.platform) ?? 0) > 0 || r.preferred);
  const rest = known.filter((r) => !used.includes(r));

  const card = (r: Row, i: number) => {
    const p = getPlatform(r.platform)!;
    const n = counts.get(r.platform) ?? 0;
    return (
      <motion.div
        key={r.platform}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(i, 10) * 0.03 }}
        className="flex flex-col gap-3 rounded-2xl bg-cream-deep/60 p-4"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl text-white" style={{ background: p.theme.primary }}>
            <PlatformGlyph glyph={p.glyph} size={22} strokeWidth={2.6} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[1.1rem] font-semibold text-ink">{p.name}</p>
            <p className="text-[0.8rem] font-bold text-ink-soft">{n > 0 ? `${n} jeu${n > 1 ? "x" : ""}` : "Aucun jeu pour l'instant"}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl bg-white/60 px-3 py-2.5">
          <Icon name="gamepad" className="shrink-0 text-accent-text" />
          <div className="min-w-0 flex-1">
            <p className="text-[0.7rem] font-extrabold tracking-[0.1em] text-ink-soft uppercase">{r.preferred ? "Émulateur, choisi par vous" : "Émulateur, choisi par iBox"}</p>
            {r.effective ? (
              <p data-no-i18n className="truncate font-bold text-ink">
                {r.effective}
              </p>
            ) : (
              <p className="truncate font-bold text-peach-deep">Aucun émulateur installé</p>
            )}
          </div>
          {r.installed > 0 ? (
            <Button onClick={() => setChoosing(r.platform)}>Changer</Button>
          ) : (
            consoleInfo(r.platform) && (
              <Button icon="download" onClick={() => go({ name: "platform", platformId: r.platform })}>
                Installer
              </Button>
            )
          )}
        </div>
      </motion.div>
    );
  };

  return (
    <div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(21rem,1fr))] gap-3" data-nav-group="android-consoles">
        {used.map((r, i) => card(r, i))}
        {showAll && rest.map((r, i) => card(r, used.length + i))}
      </div>
      {rest.length > 0 && (
        <div className="mt-3">
          <Button icon={showAll ? "minus" : "plus"} onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Masquer les autres consoles" : `Autres consoles (${rest.length})`}
          </Button>
        </div>
      )}
      {choosing && (
        <AndroidEmulatorChooser
          platform={choosing}
          onClose={() => setChoosing(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

/** Émulateur par défaut d'une console : installés, choix automatique, BIOS, renvoi vers Platforms. */
export function AndroidEmulatorChooser({ platform, onClose, onChanged }: { platform: string; onClose: () => void; onChanged: () => void }) {
  const go = useNav((s) => s.go);
  const [detail, setDetail] = useState<AndroidPlatformDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const p = getPlatform(platform);
  const name = p?.shortName ?? platform;

  const reload = useCallback(() => {
    androidEmulatorsApi.platform(platform).then(setDetail, (e: Error) => setError(e.message));
  }, [platform]);
  useEffect(reload, [reload]);
  // la liste arrive après l'ouverture : le focus va sur l'option active
  useEffect(() => {
    if (detail) requestAnimationFrame(() => input.focusInitial());
  }, [detail]);

  const choose = async (label: string | null) => {
    try {
      await androidEmulatorsApi.choose(platform, label);
      sound.play("select");
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // émulateurs autonomes d'abord, puis les cœurs de RetroArch (ordre d'ES-DE dans chaque groupe)
  const installed = [...(detail?.options.filter((o) => o.component) ?? [])].sort((a, b) => Number(b.standalone) - Number(a.standalone));
  const missing = new Set(detail?.options.filter((o) => !o.component).map((o) => o.emulator) ?? []);
  const current = detail?.options.find((o) => o.label === detail.effective) ?? null;

  return (
    <Modal title={`Émulateur ${name}`} subtitle={current ? current.name : undefined} onClose={onClose} width="44rem">
      {error && <p className="mb-3 rounded-lg bg-peach-soft px-4 py-2 text-[0.88rem] font-bold text-peach-deep">{error}</p>}
      {!detail ? (
        <p className="text-[0.92rem] font-semibold text-ink-soft">Recherche des émulateurs installés…</p>
      ) : (
        <div className="flex max-h-[62vh] flex-col gap-4 overflow-y-auto pr-1">
          <div data-nav-group={`android-choose-${platform}`} className="flex flex-col gap-2">
            <button
              data-focusable
              data-autofocus={!detail.preferred || undefined}
              onClick={() => void choose(null)}
              className="ibox-focusable flex items-center gap-3 rounded-xl bg-white/70 px-4 py-3 text-left ring-1 ring-ink/6 [--ring-radius:var(--radius-lg)]"
            >
              <Icon name={detail.preferred ? "sparkle" : "check"} className={detail.preferred ? "text-ink-faint" : "text-mint-deep"} />
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-ink">Automatique</span>
                <span className="block text-[0.82rem] font-semibold text-ink-soft">iBox prend l'émulateur autonome installé, RetroArch en dernier.</span>
              </span>
            </button>
            {installed.map((o) => {
              const active = !!detail.preferred && o.label === detail.effective;
              return (
                <button
                  key={o.label}
                  data-focusable
                  data-autofocus={active || undefined}
                  onClick={() => void choose(o.label)}
                  className="ibox-focusable flex flex-col gap-0.5 rounded-xl bg-white/70 px-4 py-3 text-left ring-1 ring-ink/6 [--ring-radius:var(--radius-lg)]"
                >
                  <span className="flex items-center gap-3">
                    <Icon name={active ? "check" : "gamepad"} className={active ? "text-mint-deep" : "text-ink-faint"} />
                    <span data-no-i18n className="min-w-0 flex-1 truncate font-bold text-ink">
                      {o.name}
                    </span>
                    <span className="text-[0.78rem] font-bold text-ink-soft">{o.standalone ? "autonome" : "cœur RetroArch"}</span>
                  </span>
                  {o.core &&
                    (active ? (
                      <RetroArchCoreHint core={o.core} label={o.label} />
                    ) : (
                      <span data-no-i18n className="pl-9 font-mono text-[0.74rem] text-ink-faint">
                        {o.core}
                      </span>
                    ))}
                </button>
              );
            })}
          </div>
          <AndroidBiosPanel detail={detail} consoleName={name} onChanged={reload} />
          {consoleInfo(platform) && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[0.88rem] font-semibold text-ink-soft">{`${missing.size} autre${missing.size > 1 ? "s" : ""} émulateur${missing.size > 1 ? "s" : ""} pour cette console`}</span>
              <Button
                icon="download"
                onClick={() => {
                  onClose();
                  go({ name: "platform", platformId: platform });
                }}
              >
                Installer dans iBox Platforms
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
