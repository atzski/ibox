import { SPRING } from "@/motion/tokens";
import { useMemo } from "react";
import { motion } from "motion/react";
import { useSettings } from "@/services/settings";
import { useNav } from "@/app/navigation";
import { Button, Segmented } from "@/components/ui/Button";
import { sound } from "@/services/sound";
import { BLOCK_INFO, DEFAULT_BLOCKS, normalizeBlocks } from "@/services/homeLayout";
import { Group, RoundButton, Row, Toggle } from "./ui";

// ——— Accueil ———

export function HomePage() {
  const s = useSettings();
  const go = useNav((n) => n.go);
  const blocks = useMemo(() => normalizeBlocks(s.homeBlocks), [s.homeBlocks]);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    sound.play("move");
    s.set("homeBlocks", next);
  };
  return (
    <>
      <Group title="Sections de l'accueil" icon="grid" note="L'ordre ici est celui de l'accueil. Vous pouvez aussi tout réarranger directement depuis l'accueil.">
        <div data-nav-group="settings-home-blocks" className="flex flex-col gap-2 border-none py-1">
          {blocks.map((b, i) => (
            <motion.div
              layout
              key={b.id}
              transition={SPRING.snappy}
              className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ${b.visible ? "bg-cream-deep/70" : "bg-cream-deep/35"}`}
            >
              <span className="grid size-8 place-items-center rounded-full bg-white text-[0.85rem] font-extrabold text-ink-soft">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className={`text-[0.95rem] font-bold ${b.visible ? "text-ink" : "text-ink-soft"}`}>{BLOCK_INFO[b.id].label}</div>
                <div className="text-[0.78rem] font-semibold text-ink-soft">{BLOCK_INFO[b.id].note}</div>
              </div>
              <RoundButton icon="chevronRight" rotate={-90} label={`Monter « ${BLOCK_INFO[b.id].label} »`} disabled={i === 0} onClick={() => move(i, -1)} />
              <RoundButton icon="chevronRight" rotate={90} label={`Descendre « ${BLOCK_INFO[b.id].label} »`} disabled={i === blocks.length - 1} onClick={() => move(i, 1)} />
              <Toggle
                checked={b.visible}
                label={`Afficher « ${BLOCK_INFO[b.id].label} »`}
                onChange={(v) => s.set("homeBlocks", blocks.map((x, k) => (k === i ? { ...x, visible: v } : x)))}
              />
            </motion.div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 pt-4">
          <Button variant="primary" icon="sparkle" onClick={() => go({ name: "home" })}>
            Aller à l'accueil
          </Button>
          <Button icon="reset" onClick={() => s.set("homeBlocks", DEFAULT_BLOCKS)}>
            Ordre d'origine
          </Button>
        </div>
      </Group>
      <Group title="Horloge" icon="clock">
        <Row label="Format de l'heure">
          <Segmented<string>
            label="Format de l'heure"
            value={s.clock12h ? "12" : "24"}
            onChange={(v) => s.set("clock12h", v === "12")}
            options={[
              { value: "24", label: "24 h" },
              { value: "12", label: "12 h" },
            ]}
          />
        </Row>
        <Row label="Date sous l'heure">
          <Toggle checked={s.showDate !== false} onChange={(v) => s.set("showDate", v)} label="Date sous l'heure" />
        </Row>
      </Group>
    </>
  );
}
