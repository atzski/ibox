import { jinglesApi, useJingleSync, DEFAULT_JINGLE_VOLUME } from "@/services/jingles";
import { usePlatform } from "@/services/platform";
import { useEffect, useState } from "react";
import { useSettings } from "@/services/settings";
import { Button } from "@/components/ui/Button";
import { Group, Row, Toggle, VolumeControl } from "./ui";

// ——— Son ———

export function SoundPage() {
  const s = useSettings();
  return (
    <Group title="Son" icon="sound">
      <Row label="Ambiance sonore">
        <Toggle checked={s.ambienceEnabled} onChange={(v) => s.set("ambienceEnabled", v)} label="Ambiance sonore" />
      </Row>
      <Row label="Volume de l'ambiance">
        <VolumeControl value={s.ambienceVolume} disabled={!s.ambienceEnabled} onChange={(v) => s.set("ambienceVolume", v)} label="l'ambiance" />
      </Row>
      <Row label="Effets sonores">
        <Toggle checked={s.soundEnabled} onChange={(v) => s.set("soundEnabled", v)} label="Effets sonores" />
      </Row>
      <Row label="Volume des effets">
        <VolumeControl value={s.soundVolume} disabled={!s.soundEnabled} onChange={(v) => s.set("soundVolume", v)} label="les effets" test />
      </Row>
      <GameJingles />
    </Group>
  );
}

// ——— Commandes communes ———

/** Jingles des jeux : téléchargement accepté par l'utilisateur, retirables à tout moment. */
function GameJingles() {
  const android = usePlatform((p) => !!p.android);
  const on = useSettings((st) => st.gameSounds !== false);
  const volume = useSettings((st) => st.jingleVolume ?? DEFAULT_JINGLE_VOLUME);
  const set = useSettings((st) => st.set);
  const sync = useJingleSync();
  const [status, setStatus] = useState<[number, number] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => void jinglesApi.status().then(setStatus, () => setStatus(null));
  useEffect(refresh, [sync.running]);
  const remove = async () => {
    try { await jinglesApi.clear(); set("gameSounds", false); setMsg("Jingles retirés."); } catch (e) { setMsg(String(e)); }
    finally { refresh(); }
  };
  const count = status?.[0] ?? 0;
  const searching = sync.phase !== "sound-download";
  const pct = sync.total ? Math.round((sync.done / sync.total) * 100) : 0;
  const note = sync.running
    ? `${searching ? "Recherche des jingles" : "Téléchargement des jingles"}${sync.total ? ` · ${sync.done} / ${sync.total}` : "…"}`
    : (sync.error ?? msg ?? (sync.last ? `${sync.last.downloaded} jingle${sync.last.downloaded > 1 ? "s" : ""} ajouté${sync.last.downloaded > 1 ? "s" : ""}${sync.last.missing ? `, ${sync.last.missing} jeu${sync.last.missing > 1 ? "x" : ""} sans son dans iiDB` : ""}.` : undefined));
  return (
    <>
      <Row label="Jingles des jeux" note={android ? "Une petite musique quand vous ouvrez la fiche d'un jeu (sons iiDB, téléchargés sur cet appareil)" : "Une petite musique quand vous ouvrez la fiche d'un jeu (sons iiDB, téléchargés sur ce PC)"}>
        <Toggle checked={on} onChange={(v) => (v && count === 0 ? void sync.start() : set("gameSounds", v))} label="Jingles des jeux" />
      </Row>
      <Row label="Volume des jingles">
        <VolumeControl value={volume} disabled={!on} onChange={(v) => set("jingleVolume", v)} label="les jingles" />
      </Row>
      <Row label={count ? `${count} jingle${count > 1 ? "s" : ""} · ${((status?.[1] ?? 0) / 1048576).toFixed(1)} Mo` : "Aucun jingle téléchargé"} note={note}>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <Button icon="reset" disabled={sync.running} onClick={() => void sync.start()}>{sync.running ? "En cours…" : count ? "Mettre à jour" : "Télécharger"}</Button>
            {count > 0 && <Button icon="x" disabled={sync.running} onClick={() => void remove()}>Retirer les sons</Button>}
          </div>
          {sync.running && (
            <div className="h-1.5 w-56 overflow-hidden rounded-full bg-cream-deep" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-[linear-gradient(90deg,#88CBF5,#B5A0E9)] transition-[width] duration-300" style={{ width: `${sync.total ? Math.max(4, pct) : 12}%` }} />
            </div>
          )}
        </div>
      </Row>
    </>
  );
}
