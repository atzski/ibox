import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { closeDeviceDiagnostic, useDeviceDiagnostic } from "@/services/deviceDiagnostic";

/**
 * Déroulé du diagnostic de l'appareil (`services/deviceDiagnostic.ts`) : bandeau pendant la mesure
 * de l'étagère, carte de l'essai de la manette, puis le rapport à copier ou à récupérer.
 */
export function DeviceDiagnosticHost() {
  const { phase, padSource, remaining, pads, keys, report, paths, error } = useDeviceDiagnostic();
  const [copied, setCopied] = useState(false);
  if (phase === "idle") return null;

  if (phase === "prepare" || phase === "shelf") {
    return (
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[90] flex justify-center">
        <div className="rounded-full bg-ink/85 px-5 py-2 text-[0.9rem] font-bold text-white shadow-lg">
          {phase === "prepare" ? "Diagnostic : préparation…" : `Diagnostic : mesure de l’étagère, ${remaining} s`}
        </div>
      </div>
    );
  }

  if (phase === "pad") {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55">
        <div className="w-[min(34rem,92vw)] rounded-2xl bg-cream p-6 text-ink shadow-2xl">
          <p className="text-[1.15rem] font-extrabold">Appuyez sur tous les boutons de la manette</p>
          <p className="mt-1 text-[0.9rem] font-semibold text-ink-soft">
            {padSource === "relay" ? "Deuxième essai, relais natif d’Android. " : ""}Croix, A B X Y, gâchettes, sticks, Start, Select… Encore {remaining} s.
          </p>
          <div className="mt-4 space-y-2 text-[0.85rem] font-semibold">
            {pads.length === 0 && <p>{padSource === "relay" ? "Aucune manette vue par le relais natif pour l’instant." : "Aucune manette vue par la Gamepad API pour l’instant."}</p>}
            {pads.map((p) => (
              <p key={p.index} className="break-words">
                {p.id} : boutons {p.pressed.join(", ") || "aucun"} · axes {p.moved.join(", ") || "aucun"}
              </p>
            ))}
            {keys.length > 0 && <p className="break-words">Touches reçues : {keys.join(" · ")}</p>}
          </div>
        </div>
      </div>
    );
  }

  const copy = () => {
    void navigator.clipboard?.writeText(report).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <Modal title="Diagnostic de l’appareil" subtitle={error ? `Interrompu : ${error}` : "Rapport prêt à renvoyer"} onClose={closeDeviceDiagnostic} width="44rem">
      <div className="space-y-3">
        {paths.length > 0 ? (
          <div className="text-[0.85rem] font-semibold text-ink-soft">
            <p>Fichier enregistré ici :</p>
            {paths.map((p) => <p key={p} className="break-all font-mono text-[0.78rem]">{p}</p>)}
          </div>
        ) : (
          <p className="text-[0.85rem] font-semibold text-ink-soft">Aucun fichier écrit : copiez le rapport.</p>
        )}
        <pre className="max-h-[45vh] overflow-auto rounded-xl bg-cream-deep p-3 text-[0.72rem] leading-snug whitespace-pre-wrap">{report}</pre>
        <div className="flex justify-end gap-2">
          <Button icon="copy" onClick={copy}>{copied ? "Copié" : "Copier le rapport"}</Button>
          <Button variant="primary" onClick={closeDeviceDiagnostic}>Fermer</Button>
        </div>
      </div>
    </Modal>
  );
}
