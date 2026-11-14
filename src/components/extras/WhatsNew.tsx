import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useSettings } from "@/services/settings";
import { useSession } from "@/services/profiles";
import { getAppInfo } from "@/services/native";
import { CHANGELOG, compareVersions, type Release } from "@/content/changelog";

/**
 * « Quoi de neuf » : une fois après chaque mise à jour, les nouveautés des
 * versions pas encore vues. Une nouvelle installation ne le voit pas.
 */
export function WhatsNew() {
  const setupDone = useSettings((s) => s.setupDone);
  const seen = useSettings((s) => s.lastSeenVersion);
  const askProfile = useSettings((s) => s.askProfileOnStart);
  const chosen = useSession((s) => s.chosen);
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    void getAppInfo().then((info) => setCurrent(info.version));
  }, []);

  useEffect(() => {
    if (!current) return;
    // première installation : rien à annoncer, on note simplement la version
    if (!setupDone) {
      if (seen !== current) useSettings.getState().set("lastSeenVersion", current);
      return;
    }
    if (seen && compareVersions(seen, current) >= 0) return;
    const fresh = CHANGELOG.filter((r) => compareVersions(r.version, current) <= 0 && (!seen || compareVersions(r.version, seen) > 0));
    if (fresh.length) setReleases(fresh);
    else useSettings.getState().set("lastSeenVersion", current);
  }, [current, seen, setupDone]);

  // pas par-dessus l'écran « Qui joue ? »
  if (!releases || !current || (askProfile && !chosen)) return null;
  const close = () => {
    useSettings.getState().set("lastSeenVersion", current);
    setReleases(null);
  };
  return (
    <Modal title={`Quoi de neuf dans iBox ${current}`} onClose={close} width="42rem">
      <ReleaseList releases={releases} />
      <div className="mt-5 flex justify-end">
        <Button variant="primary" icon="check" onClick={close} data-autofocus>
          C'est parti
        </Button>
      </div>
    </Modal>
  );
}

/** Versions détaillées en tête ; au-delà, regroupées et dépliables (rattrapage de nombreuses mises à jour). */
const DETAILED = 3;

function ReleaseList({ releases }: { releases: Release[] }) {
  const [all, setAll] = useState(false);
  const recent = releases.slice(0, DETAILED);
  const older = releases.slice(DETAILED);
  return (
    <div className="flex max-h-[62vh] flex-col gap-4 overflow-y-auto pr-1">
      {releases.length > 1 && (
        <p className="rounded-2xl bg-[var(--accent-soft)] px-4 py-2.5 text-[0.9rem] font-bold text-ink">
          {`${releases.length} mises à jour depuis votre dernière visite`}
        </p>
      )}
      {recent.map((r, ri) => (
        <section key={r.version}>
          <VersionHeader release={r} />
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {r.highlights.map((h, i) => (
              <motion.div
                key={h.title}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(0.5, 0.04 + (ri * 3 + i) * 0.04) }}
                className="flex items-start gap-3 rounded-2xl bg-cream-deep/60 p-3"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-accent-text">
                  <Icon name={h.icon} size={20} />
                </span>
                <div className="min-w-0">
                  <p className="font-bold text-ink">{h.title}</p>
                  <p className="text-[0.85rem] font-semibold text-ink-soft">{h.text}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      ))}
      {older.length > 0 && (
        <section className="rounded-2xl bg-cream-deep/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.72rem] font-extrabold tracking-[0.14em] text-ink-soft uppercase">Versions précédentes</p>
            <Button icon={all ? "back" : "plus"} onClick={() => setAll((v) => !v)}>{all ? "Réduire" : "Tout afficher"}</Button>
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {older.map((r) => <OlderRelease key={r.version} release={r} open={all} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function VersionHeader({ release }: { release: Release }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-display text-[1.15rem] text-ink">{release.version}</span>
      <span className="text-[0.78rem] font-semibold text-ink-soft">{new Date(release.date).toLocaleDateString(undefined, { day: "numeric", month: "long" })}</span>
    </div>
  );
}

function OlderRelease({ release, open: forced }: { release: Release; open: boolean }) {
  const [open, setOpen] = useState(false);
  const shown = forced || open;
  return (
    <div className="rounded-xl bg-white/60">
      <button type="button" data-focusable onClick={() => setOpen((v) => !v)} aria-expanded={shown}
        className="ibox-focusable flex w-full items-center gap-2 px-3 py-2 text-left [--ring-radius:0.75rem]">
        <span className="font-display text-[0.98rem] text-ink">{release.version}</span>
        <span className="min-w-0 flex-1 truncate text-[0.82rem] font-semibold text-ink-soft">{release.highlights.map((h) => h.title).join(" · ")}</span>
        <Icon name="chevronRight" size="0.9em" className={`shrink-0 text-ink-faint transition-transform ${shown ? "rotate-90" : ""}`} />
      </button>
      {shown && (
        <ul className="flex flex-col gap-1.5 px-3 pb-3">
          {release.highlights.map((h) => (
            <li key={h.title} className="flex items-start gap-2 text-[0.85rem]">
              <Icon name={h.icon} size={16} className="mt-0.5 shrink-0 text-accent-text" />
              <span><b className="text-ink">{h.title}</b> <span className="font-semibold text-ink-soft">— {h.text}</span></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
