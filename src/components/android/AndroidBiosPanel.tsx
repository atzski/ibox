import { useState } from "react";
import { BIOS_LABEL, androidEmulatorsApi, type AndroidPlatformDetail } from "@/services/androidEmulators";
import { androidApi } from "@/services/android";
import { sound } from "@/services/sound";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

/**
 * BIOS d'une console sur Android (docs/ANDROID.md §17) : les fichiers attendus et ce qu'iBox en
 * trouve, le dossier propre à la console (quand un émulateur attend ses BIOS ailleurs) et le
 * dossier commun à toutes les consoles. iBox ne fournit ni ne copie aucun BIOS.
 */
export function AndroidBiosPanel({ detail, consoleName, onChanged }: { detail: AndroidPlatformDetail; consoleName: string; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  if (detail.bios.length === 0) return null;

  const set = async (platform: string | null, choose: boolean) => {
    setError(null);
    try {
      let path: string | null = null;
      if (choose) {
        const current = platform ? detail.biosFolder : detail.biosFolderAll;
        path = await androidApi.pickBiosFolder(platform ? `Dossier des BIOS ${consoleName}` : "Dossier des BIOS (toutes les consoles)", current ?? detail.biosDirs[0] ?? null);
        if (!path) return;
      }
      await androidEmulatorsApi.setBiosFolder(platform, path);
      sound.play("select");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section aria-label="BIOS" className="rounded-xl bg-white/70 p-5 ring-1 ring-ink/6">
      <h3 className="text-[0.78rem] font-bold tracking-[0.1em] text-ink-faint uppercase">BIOS</h3>
      <p className="mt-1 max-w-[36rem] text-[0.88rem] leading-relaxed font-semibold text-ink-soft">
        iBox ne fournit aucun BIOS : copiez ceux de votre console dans un dossier, iBox vérifie qu'ils y sont. Indiquez ensuite ce dossier à l'émulateur s'il le demande.
      </p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {detail.bios.map((b) => (
          <li key={b.id} className="flex items-start gap-2.5 text-[0.92rem] font-semibold">
            <Icon name={b.found ? "check" : "x"} className={b.found ? "mt-0.5 text-mint-deep" : "mt-0.5 text-peach-deep"} />
            <span className="min-w-0">
              <span className="text-ink">{BIOS_LABEL[b.id] ?? b.id}</span>{" "}
              <span className="text-ink-soft">{b.required ? "(indispensable)" : "(conseillé)"}</span>
              {b.found || b.names.length ? (
                <span data-no-i18n className="block truncate font-mono text-[0.74rem] text-ink-faint">
                  {b.found ?? b.names.join(", ")}
                </span>
              ) : (
                <span className="block font-mono text-[0.74rem] text-ink-faint">fichier .bin</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[0.78rem] font-bold text-ink-soft">Dossiers lus, dans l'ordre :</p>
      <p data-no-i18n className="font-mono text-[0.72rem] break-all text-ink-faint">
        {detail.biosDirs.join(" · ")}
      </p>
      <div data-nav-group={`bios-${detail.platform}`} className="mt-3 flex flex-wrap gap-2.5">
        <Button variant="soft" icon="folder" onClick={() => void set(detail.platform, true)}>
          {detail.biosFolder ? `Changer le dossier ${consoleName}` : `Dossier propre à ${consoleName}`}
        </Button>
        {detail.biosFolder && (
          <Button variant="ghost" icon="reset" onClick={() => void set(detail.platform, false)}>
            {`Dossier commun pour ${consoleName}`}
          </Button>
        )}
        <Button variant="ghost" icon="folder" onClick={() => void set(null, true)}>
          {detail.biosFolderAll ? "Changer le dossier commun" : "Dossier commun à toutes les consoles"}
        </Button>
      </div>
      {error && <p className="mt-2 text-[0.86rem] font-semibold text-peach-deep">{error}</p>}
    </section>
  );
}

/** Cœur RetroArch à installer (iBox ne peut pas le voir dans le dossier privé de RetroArch). */
export function RetroArchCoreHint({ core, label }: { core: string; label: string }) {
  return (
    <p className="mt-2 max-w-[38rem] text-[0.88rem] leading-relaxed font-semibold text-ink-soft">
      <span>Cœur RetroArch nécessaire :</span>{" "}
      <span data-no-i18n className="font-bold text-ink">
        {label}
      </span>{" "}
      <span data-no-i18n className="font-mono text-[0.78rem]">
        ({core})
      </span>
      <span>. Installez-le dans RetroArch : Menu principal › Mise à jour en ligne › Télécharger des cœurs. iBox ne peut pas vérifier sa présence.</span>
    </p>
  );
}
