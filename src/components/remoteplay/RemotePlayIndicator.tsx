import { useEffect, useRef, useState } from "react";
import { remotePlayApi, type HostStats, type PadDriver } from "@/services/remotePlay";
import { attachRemotePlayOnline, onlineApi, pathLabel, useRemotePlayOnline } from "@/services/remotePlayOnline";

/**
 * Fenêtre « remote-play-indicator » : bandeau toujours au premier plan tant que ce PC partage son
 * écran (hôte). Arrêt d'urgence (coupure immédiate) et fin de session à portée de clic. Il peut
 * être réduit en pastille, jamais caché tout à fait. Si la manette de l'invité arrive alors que le
 * pilote ViGEmBus manque, son installation est lancée d'elle-même (Windows demande l'accord).
 */
export function RemotePlayIndicator() {
  const status = useRemotePlayOnline((s) => s.status);
  const [stats, setStats] = useState<HostStats | null>(null);
  const [hotkey, setHotkey] = useState("Ctrl+Alt+Shift+F12");
  const [compact, setCompact] = useState(false);
  const [driver, setDriver] = useState<PadDriver | null>(null);
  const [installing, setInstalling] = useState(false);
  const [driverError, setDriverError] = useState<string | null>(null);
  const autoTried = useRef(false);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const off = attachRemotePlayOnline();
    remotePlayApi.config().then((c) => setHotkey(c.stopHotkey), () => undefined);
    const timer = window.setInterval(() => {
      void remotePlayApi.hostStats().then(setStats, () => setStats(null));
      void remotePlayApi.padDriver().then(setDriver, () => undefined);
    }, 1000);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, []);

  const install = () => {
    if (installing) return;
    setInstalling(true);
    setDriverError(null);
    remotePlayApi
      .installPadDriver()
      .then(setDriver, (e) => setDriverError(typeof e === "string" ? e : String((e as { message?: string })?.message ?? e)))
      .finally(() => setInstalling(false));
  };

  // la manette de l'invité est arrivée sans pilote : installation proposée tout de suite (une fois)
  useEffect(() => {
    if (driver && !driver.installed && driver.guestPadWaiting && !autoTried.current) {
      autoTried.current = true;
      if (compact) toggleCompact(false);
      install();
    }
  });

  const toggleCompact = (next: boolean) => {
    setCompact(next);
    void remotePlayApi.indicatorCompact(next).catch(() => undefined);
  };

  const live = !!stats?.connected;
  const text = status?.stage === "inviting" ? "En attente de" : live ? "Partage en cours avec" : "Connexion avec";
  const needsDriver = driver !== null && !driver.installed;

  if (compact) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <button
          title="Afficher le bandeau Remote Play"
          aria-label="Afficher le bandeau Remote Play"
          className="ibox-focusable flex size-10 items-center justify-center rounded-full bg-[#1E2233]/95 shadow-lg ring-1 ring-white/15"
          onClick={() => toggleCompact(false)}
        >
          <span aria-hidden className={`size-3 rounded-full ${live ? "animate-pulse bg-[#FF4D5E]" : "bg-[#FFC94D]"}`} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center p-1">
      <div className="flex w-full items-center gap-2 rounded-full bg-[#1E2233]/95 py-1.5 pr-1.5 pl-4 text-white shadow-lg ring-1 ring-white/10">
        <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${live ? "animate-pulse bg-[#FF4D5E]" : "bg-[#FFC94D]"}`} />
        <span className="min-w-0 flex-1 truncate text-[0.82rem] font-bold" title={driverError ?? undefined}>
          {needsDriver && (installing || driverError) ? (
            installing ? "Installation du pilote manette…" : driverError
          ) : (
            <>
              {text} <span data-no-i18n>{status?.peerName ?? ""}</span>
              <span className="ml-2 font-semibold opacity-70">{live ? pathLabel(stats?.path) : ""} · {hotkey}</span>
            </>
          )}
        </span>
        {needsDriver && !installing && (
          <button className="ibox-focusable shrink-0 rounded-full bg-[#2F8CF0] px-3 py-1.5 text-[0.78rem] font-extrabold" title="Installe le pilote ViGEmBus pour la manette de votre invité" onClick={install}>
            Activer la manette
          </button>
        )}
        <button
          className="ibox-focusable shrink-0 rounded-full bg-[#FF4D5E] px-3 py-1.5 text-[0.78rem] font-extrabold"
          onClick={() => void onlineApi.emergencyStop().catch(() => undefined)}
        >
          Arrêt d'urgence
        </button>
        <button className="ibox-focusable shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-[0.78rem] font-extrabold" onClick={() => void onlineApi.stop().catch(() => undefined)}>
          Terminer
        </button>
        <button
          title="Réduire en pastille"
          aria-label="Réduire en pastille"
          className="ibox-focusable flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[1rem] font-extrabold leading-none"
          onClick={() => toggleCompact(true)}
        >
          –
        </button>
      </div>
    </div>
  );
}
