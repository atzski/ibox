import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Segmented } from "@/components/ui/Button";
import { LEGAL, type LegalSection } from "@/content/legal";

/** Mentions légales, confidentialité et licences (Paramètres › Système › À propos). */
export function LegalModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<LegalSection["id"]>("privacy");
  const section = LEGAL.find((s) => s.id === tab)!;
  return (
    <Modal title="Mentions légales" subtitle="Confidentialité, sources et licences" onClose={onClose} width="46rem">
      <div className="no-scrollbar -mx-1 overflow-x-auto px-1 pb-1">
        <Segmented<LegalSection["id"]> label="Rubrique" value={tab} onChange={setTab} options={LEGAL.map((s) => ({ value: s.id, label: s.title }))} />
      </div>
      <div className="mt-4 max-h-[55vh] overflow-y-auto pr-2">
        {section.blocks.map((b, i) => (
          <section key={i} className="mb-5">
            {b.heading && <h3 className="mb-2 font-display text-[1.1rem] font-semibold text-ink">{b.heading}</h3>}
            <ul className="flex flex-col gap-2">
              {b.items.map((t) => (
                <li key={t} className="flex gap-2.5 text-[0.92rem] leading-relaxed font-semibold text-ink-soft">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
