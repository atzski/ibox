import { useEffect, useState } from "react";
import { remotePlayApi, type HostStats } from "@/services/remotePlay";
import { attachRemotePlayOnline, onlineApi, pathLabel, useRemotePlayOnline } from "@/services/remotePlayOnline";

/**
 * Fenêtre « remote-play-indicator » : bandeau toujours au premier plan tant que ce PC partage son
 * écran (hôte). Arrêt d'urgence (coupure immédiate) et fin de session à portée de clic.
 */
export function RemotePlayIndicator() {
  const status = useRemotePlayOnline((s) => s.status);
  const [stats, setStats] = useState<HostStats | null>(null);
  const [hotkey, setHotkey] = useState("Ctrl+Alt+Shift+F12");

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const off = attachRemotePlayOnline();
    remotePlayApi.config().then((c) => setHotkey(c.stopHotkey), () => undefined);
    const timer = window.setInterval(() => void remotePlayApi.hostStats().then(setStats, () => setStats(null)), 1000);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, []);

  const live = !!stats?.connected;
  const text = status?.stage === "inviting" ? "En attente de" : live ? "Partage en cours avec" : "Connexion avec";

  return (
    <div className="flex h-screen w-screen items-center justify-center p-1">
      <div className="flex w-full items-center gap-2 rounded-full bg-[#1E2233]/95 py-1.5 pr-1.5 pl-4 text-white shadow-lg ring-1 ring-white/10">
        <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${live ? "animate-pulse bg-[#FF4D5E]" : "bg-[#FFC94D]"}`} />
        <span className="min-w-0 flex-1 truncate text-[0.82rem] font-bold">
          {text} <span data-no-i18n>{status?.peerName ?? ""}</span>
          <span className="ml-2 font-semibold opacity-70">{live ? pathLabel(stats?.path) : ""} · {hotkey}</span>
        </span>
        <button
          className="ibox-focusable shrink-0 rounded-full bg-[#FF4D5E] px-3 py-1.5 text-[0.78rem] font-extrabold"
          onClick={() => void onlineApi.emergencyStop().catch(() => undefined)}
        >
          Arrêt d'urgence
        </button>
        <button className="ibox-focusable shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-[0.78rem] font-extrabold" onClick={() => void onlineApi.stop().catch(() => undefined)}>
          Terminer
        </button>
      </div>
    </div>
  );
}
