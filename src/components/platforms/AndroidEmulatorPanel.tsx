import { useCallback, useEffect, useMemo, useState } from "react";
import type { ConsoleInfo } from "@/domain/platformCatalog";
import { getPlatform } from "@/domain/platforms";
import {
  SOURCE_LABEL,
  androidEmulatorsApi,
  onAndroidResumed,
  useAndroidEmulators,
  type AndroidOptionDetail,
  type AndroidPlatformDetail,
} from "@/services/androidEmulators";
import { sound } from "@/services/sound";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { AndroidBiosPanel, RetroArchCoreHint } from "@/components/android/AndroidBiosPanel";

/**
 * « Y jouer aujourd'hui » sur Android : émulateurs de la table d'ES-DE pour la console, celui
 * utilisé par défaut, où installer les autres (Play Store, versions GitHub, Obtainium : Android
 * demande toujours la confirmation), et les BIOS attendus avec ce qu'iBox en trouve.
 */
export function useAndroidPlatform(platformId: string) {
  const [detail, setDetail] = useState<AndroidPlatformDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    androidEmulatorsApi
      .platform(platformId)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
    void useAndroidEmulators.getState().load();
  }, [platformId]);
  useEffect(() => {
    reload();
    // retour du Play Store ou d'un émulateur : ce qui est installé a pu changer
    let off: (() => void) | null = null;
    let stopped = false;
    void onAndroidResumed(reload).then((f) => (stopped ? f() : (off = f)));
    return () => {
      stopped = true;
      off?.();
    };
  }, [reload]);
  return { detail, error, reload };
}

export function AndroidEmulatorPanel({ info, detail, error, reload }: { info: ConsoleInfo; detail: AndroidPlatformDetail | null; error: string | null; reload: () => void }) {
  const [note, setNote] = useState<string | null>(null);

  const { installed, missing, current } = useMemo(() => {
    const opts = detail?.options ?? [];
    const installed = opts.filter((o) => o.component);
    // un émulateur à installer apparaît une fois, même s'il lance la console de plusieurs façons
    const seen = new Set<string>(installed.map((o) => o.emulator));
    const missing: AndroidOptionDetail[] = [];
    for (const o of opts) {
      if (o.component || seen.has(o.emulator)) continue;
      seen.add(o.emulator);
      missing.push(o);
    }
    return { installed, missing, current: opts.find((o) => o.label === detail?.effective) ?? null };
  }, [detail]);

  if (error) return <p className="text-[0.95rem] font-semibold text-peach-deep">{error}</p>;
  if (!detail) return <p className="text-[0.95rem] font-semibold text-ink-soft">Recherche des émulateurs installés…</p>;
  if (detail.options.length === 0) {
    return <p className="max-w-[36rem] text-[0.95rem] font-semibold text-ink-soft">Aucun émulateur Android connu pour cette console.</p>;
  }

  const choose = async (label: string | null) => {
    try {
      await androidEmulatorsApi.choose(info.id, label);
      sound.play("select");
      reload();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };
  const open = async (url: string) => {
    try {
      await androidEmulatorsApi.open(url);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* émulateur utilisé */}
      <div className="rounded-xl bg-white/70 p-5 ring-1 ring-ink/6">
        {current ? (
          <>
            <div className="text-[0.78rem] font-bold tracking-[0.1em] text-ink-faint uppercase">Émulateur utilisé</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <span data-no-i18n className="font-display text-[1.35rem] font-semibold text-ink">
                {current.name}
              </span>
              <span className="text-[0.85rem] font-bold text-ink-soft">{detail.preferred ? "choisi par vous" : "choisi par iBox"}</span>
            </div>
            {current.note && <p className="mt-2 max-w-[36rem] text-[0.9rem] leading-relaxed font-semibold text-ink-soft">{current.note}</p>}
            {current.core && <RetroArchCoreHint core={current.core} label={current.label} />}
          </>
        ) : (
          <p className="max-w-[36rem] text-[0.95rem] leading-relaxed font-semibold text-ink-soft">
            Aucun émulateur installé pour cette console. Installez-en un ci-dessous : Android vous demandera de confirmer, puis iBox le trouvera tout seul.
          </p>
        )}
      </div>

      {/* installés : choix par défaut */}
      {installed.length > 0 && (
        <section aria-label="Émulateurs installés" className="flex flex-col gap-2">
          <h3 className="text-[0.78rem] font-bold tracking-[0.1em] text-ink-faint uppercase">Installés sur cet appareil</h3>
          <div data-nav-group={`android-installed-${info.id}`} className="flex flex-col gap-2">
            {installed.map((o) => {
              const active = o.label === detail.effective;
              return (
                <div key={o.label} className="flex items-center gap-3 rounded-xl bg-white/60 px-4 py-2.5 ring-1 ring-ink/6">
                  <Icon name={active ? "check" : "gamepad"} className={active ? "text-mint-deep" : "text-ink-faint"} />
                  <span data-no-i18n className="min-w-0 flex-1 truncate text-[0.98rem] font-semibold text-ink">
                    {o.name}
                  </span>
                  {active ? (
                    <span className="text-[0.82rem] font-bold text-mint-deep">Par défaut</span>
                  ) : (
                    <Button variant="ghost" onClick={() => void choose(o.label)}>
                      Utiliser par défaut
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          {detail.preferred && (
            <div>
              <Button variant="ghost" icon="reset" onClick={() => void choose(null)}>
                Laisser iBox choisir
              </Button>
            </div>
          )}
        </section>
      )}

      {/* à installer */}
      {missing.length > 0 && (
        <section aria-label="Autres émulateurs" className="flex flex-col gap-2">
          <h3 className="text-[0.78rem] font-bold tracking-[0.1em] text-ink-faint uppercase">{installed.length ? "Autres émulateurs" : "À installer"}</h3>
          <div className="flex flex-col gap-2">
            {missing.slice(0, 6).map((o) => (
              <div key={o.emulator} className="rounded-xl bg-white/60 px-4 py-3 ring-1 ring-ink/6">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span data-no-i18n className="min-w-0 flex-1 text-[0.98rem] font-semibold text-ink">
                    {o.emulator === "RETROARCH" ? "RetroArch" : o.name}
                  </span>
                  <div data-nav-group={`android-sources-${o.emulator}`} className="flex flex-wrap gap-2">
                    {o.sources.map((s) => (
                      <Button key={s.kind} variant={s.kind === "play" || s.kind === "obtainium" ? "soft" : "ghost"} icon="download" onClick={() => void open(s.url)}>
                        {SOURCE_LABEL[s.kind]}
                      </Button>
                    ))}
                  </div>
                </div>
                {o.note && <p className="mt-1.5 text-[0.85rem] leading-relaxed font-semibold text-ink-soft">{o.note}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      <AndroidBiosPanel detail={detail} consoleName={getPlatform(info.id)?.shortName ?? info.name} onChanged={reload} />

      {note && <p className="text-[0.86rem] font-semibold text-peach-deep">{note}</p>}
    </div>
  );
}
