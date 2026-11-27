import { useLibrary } from "./library";
import { useLauncher } from "./launcher";
import { useSettings } from "./settings";
import { useNotifications } from "./notifications";
import { useInetbox } from "./inetbox";
import { metadataApi } from "./metadata";
import { getAppInfo } from "./native";
import { crashLogTail } from "./crashLog";
import { usePlatform } from "./platform";
import { perfTier } from "./performance";
import { casePaintPath } from "@/art/covers";

/**
 * Rapport de problème : un texte lisible qui décrit l'installation, préparé
 * localement et enregistré sur ce PC. L'utilisateur choisit s'il le partage.
 * Jamais de clé, de mot de passe ni d'identifiant de compte ; le dossier de
 * l'utilisateur Windows est masqué dans les chemins.
 */
export async function buildDiagnostic(): Promise<string> {
  const mask = (p: string) => p.replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/i, "%USERPROFILE%");
  const lib = useLibrary.getState();
  const s = useSettings.getState();
  const info = await getAppInfo().catch(() => null);
  const meta = await metadataApi.status().catch(() => null);
  const lines: string[] = [];
  const h = (t: string) => lines.push("", `== ${t} ==`);

  lines.push(`Rapport de diagnostic iBox — ${new Date().toISOString()}`);
  lines.push(`Version : ${info?.version ?? "?"}`);
  lines.push(`Système : ${navigator.userAgent}`);
  lines.push(`Écran : ${screen.width}×${screen.height} (échelle ${devicePixelRatio})`);
  // console portable reconnue (docs/HANDHELD.md) : fiche, palier de performance, taille du texte
  const p = usePlatform.getState();
  lines.push(`Appareil : ${p.device ? `${p.device.name} (${p.device.id}, GPU ${p.device.gpu})` : p.steamDeck ?? (p.handheld ? "console portable sans fiche" : "PC")} · palier ${perfTier()} · Mode Jeu ${p.gameMode} · texte ${getComputedStyle(document.documentElement).fontSize} · peinture des boîtiers ${casePaintPath()}`);

  h("Réglages");
  lines.push(`Thème ${s.theme} · palette ${s.appTheme} · taille ${s.uiScale} · plein écran ${s.fullscreen} · animations ${s.motion}`);
  lines.push(`Arrière-plan ${s.keepInTray} · effacer en jeu ${s.hideOnLaunch} · « Qui joue ? » ${s.askProfileOnStart} · profils ${s.profiles.length}`);
  lines.push(`Sources : ${Object.entries({ ...({ launchbox: true } as Record<string, boolean>), ...s.metadataProviders }).map(([k, v]) => `${k}=${v}`).join(", ")} · région ${s.preferredRegion}`);
  lines.push(`Clé SteamGridDB enregistrée : ${meta ? (meta.steamgriddbKey ? "oui" : "non") : "?"}`);
  lines.push(`iNetbox : ${useInetbox.getState().status}`);

  h("Bibliothèque");
  const games = lib.realGames;
  const byPlatform = new Map<string, number>();
  for (const g of games) byPlatform.set(g.platformId, (byPlatform.get(g.platformId) ?? 0) + 1);
  lines.push(`${games.length} jeux · introuvables ${games.filter((g) => g.missing).length} · sans jaquette ${games.filter((g) => !(g.media ?? []).some((m) => m.kind === "front" || m.kind === "full")).length}`);
  lines.push([...byPlatform.entries()].map(([p, n]) => `${p} ${n}`).join(" · ") || "(vide)");

  h("Dossiers");
  for (const f of lib.folders) lines.push(`${mask(f.path)} · ${f.platformId ?? "auto"} · ${f.enabled ? "actif" : "désactivé"} · ${f.gameCount} jeux · actualisé ${f.lastScanAt ?? "jamais"}`);
  if (lib.folders.length === 0) lines.push("(aucun)");

  h("Émulateurs");
  for (const e of useLauncher.getState().emulators) lines.push(`${e.name} (${e.profileName}) · ${mask(e.exePath)} · ${e.platforms.join(", ")}`);
  if (useLauncher.getState().emulators.length === 0) lines.push("(aucun)");

  h("Bases de référence");
  for (const src of meta?.sources ?? []) lines.push(`${src.id} · ${src.items} · ${src.fetchedAt}`);

  h("Notifications récentes");
  for (const n of useNotifications.getState().items.slice(0, 40)) lines.push(`${n.at} [${n.tone}] ${n.title}${n.body ? ` — ${mask(n.body)}` : ""}`);

  h("Incidents récents (logs/crash.log)");
  const crashes = await crashLogTail().catch(() => "");
  lines.push(crashes.trim() ? mask(crashes.trim()) : "(aucun)");

  return lines.join("\n") + "\n";
}
