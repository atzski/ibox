import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "@/components/ui/Icon";
import { isTauri } from "@/services/native";
import { previewJingle } from "@/services/jingles";
import { notify } from "@/services/notifications";
import { sound } from "@/services/sound";

/** Fiche d'un jeu : importer son propre jingle (fichier audio), l'écouter, le retirer. */
export function JinglePicker({ dbId, title }: { dbId?: number; title: string }) {
  const [info, setInfo] = useState<[boolean, boolean]>([false, false]);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    if (dbId !== undefined) void invoke<[boolean, boolean]>("game_sound_info", { gameId: dbId }).then(setInfo, () => undefined);
  };
  useEffect(refresh, [dbId]);
  if (!isTauri() || dbId === undefined) return null;
  const [custom, available] = info;

  const pick = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ multiple: false, directory: false, title: `Jingle pour ${title}`, filters: [{ name: "Audio", extensions: ["mp3", "ogg", "wav", "m4a", "opus", "webm"] }] });
    if (typeof path !== "string") return;
    setBusy(true);
    try {
      await invoke("game_sound_import", { gameId: dbId, path });
      sound.play("select");
      notify({ icon: "sound", tone: "ok", title: "Jingle personnalisé", body: title, link: { kind: "game", gameId: `lib-${dbId}` } });
      refresh();
      previewJingle(dbId);
    } catch (e) {
      notify({ icon: "sound", tone: "warn", title: "Jingle refusé", body: String(e), link: { kind: "game", gameId: `lib-${dbId}` } });
    } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await invoke("game_sound_remove_custom", { gameId: dbId }); refresh(); } finally { setBusy(false); }
  };

  const pill = "ibox-focusable flex h-9 items-center gap-1.5 rounded-full bg-white/70 px-3.5 text-[0.82rem] font-bold text-ink shadow-xs [--ring-radius:999px] disabled:opacity-50";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button data-focusable disabled={busy} onClick={() => void pick()} className={pill} title="Choisir un fichier audio pour ce jeu">
        <Icon name="sound" size="1em" />
        {custom ? "Changer le jingle" : "Mon jingle"}
      </button>
      {available && (
        <button data-focusable onClick={() => previewJingle(dbId)} className={pill} aria-label="Écouter le jingle">
          <Icon name="play" size="0.9em" filled />
          Écouter
        </button>
      )}
      {custom && (
        <button data-focusable disabled={busy} onClick={() => void remove()} className={pill} aria-label="Retirer mon jingle">
          <Icon name="x" size="0.9em" />
          Retirer
        </button>
      )}
    </div>
  );
}
