import { motion } from "motion/react";
import { useMemo } from "react";
import { PLATFORMS } from "@/domain/platforms";
import { useLibrary, countByPlatform } from "@/services/library";
import { useNav } from "@/app/navigation";
import { useScreenChrome } from "@/app/shellState";
import { PlatformCard } from "@/components/platform/PlatformCard";

/** Toutes les consoles, regroupées par constructeur. */
export function PlatformsScreen() {
  const games = useLibrary((s) => s.games);
  const go = useNav((s) => s.go);
  const counts = useMemo(() => countByPlatform(games), [games]);

  useScreenChrome({
    title: "Consoles",
    hints: [
      { keys: ["Entrée"], label: "Ouvrir la bibliothèque" },
      { keys: ["Échap"], label: "Retour" },
    ],
  });

  const groups = useMemo(() => {
    const m = new Map<string, typeof PLATFORMS>();
    for (const p of PLATFORMS) m.set(p.manufacturer, [...(m.get(p.manufacturer) ?? []), p]);
    return [...m.entries()];
  }, []);

  let first = true;

  return (
    <div className="h-full overflow-y-auto px-[3rem] pt-2 pb-10">
      <h1 className="text-[2.4rem] font-semibold text-ink">Choisissez une console</h1>
      <p className="mt-1 text-[1rem] font-semibold text-ink-soft">
        Chaque plateforme possède sa couleur, son boîtier et sa disposition de bibliothèque.
      </p>

      {groups.map(([maker, list]) => (
        <section key={maker} className="mt-8">
          <h2 className="mb-4 text-[1.15rem] font-semibold text-ink-soft">{maker}</h2>
          <motion.div
            data-nav-group={`platforms-${maker}`}
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.035 } } }}
            className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-5"
          >
            {list.map((p) => {
              const auto = first;
              first = false;
              return (
                <PlatformCard
                  key={p.id}
                  platform={p}
                  size="grid"
                  autoFocus={auto}
                  count={counts.get(p.id) ?? 0}
                  onOpen={() => go({ name: "library", platformId: p.id })}
                />
              );
            })}
          </motion.div>
        </section>
      ))}
    </div>
  );
}
