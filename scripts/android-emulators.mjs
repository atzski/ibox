// Table des émulateurs Android d'iBox, tirée de la table publique d'ES-DE pour Android (licence MIT) :
// `resources/systems/android/es_find_rules.xml` (paquets et activités) et `es_systems.xml`
// (commande de lancement de chaque émulateur, par système), dépôt
// https://gitlab.com/es-de/emulationstation-de. On ne devine aucun nom d'activité.
//
//   node scripts/android-emulators.mjs <dossier contenant les deux fichiers XML>
//
// Écrit `src-tauri/src/launcher/android-emulators.json`, lu par `launcher/android_table.rs`.
// Seules les consoles d'iBox (`shared/platform-formats.json`) et les commandes dont iBox sait
// remplir toutes les variables sont gardées, dans l'ordre d'ES-DE (la première est son choix par défaut).
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2];
if (!dir) {
  console.error("usage : node scripts/android-emulators.mjs <dossier des XML d'ES-DE>");
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rules = readFileSync(join(dir, "es_find_rules.xml"), "utf8");
const systems = readFileSync(join(dir, "es_systems.xml"), "utf8");

/** Console iBox → système ES-DE. */
const PLATFORMS = {
  gamecube: "gc", wii: "wii", wiiu: "wiiu", ds: "nds", "3ds": "n3ds", n64: "n64", gb: "gb", gbc: "gbc",
  gba: "gba", snes: "snes", switch: "switch", ps1: "psx", ps2: "ps2", psp: "psp", nes: "nes",
  mastersystem: "mastersystem", megadrive: "megadrive", gamegear: "gamegear", saturn: "saturn",
  dreamcast: "dreamcast", atari2600: "atari2600", jaguar: "atarijaguar", xbox: "xbox", xbox360: "xbox360", ps3: "ps3",
};
const known = Object.keys(JSON.parse(readFileSync(join(root, "shared/platform-formats.json"), "utf8")).platforms);
for (const id of Object.keys(PLATFORMS)) if (!known.includes(id)) throw new Error(`console inconnue d'iBox : ${id}`);

/** Variables qu'iBox sait remplir (launcher/android_table.rs). */
const SUPPORTED = new Set(["ROM", "ROMRAW", "ROMSAF", "ROMPROVIDER", "EXTERNALDATA", "INTERNALDATA", "ANDROIDPACKAGE", "BASENAME", "GAMEDIRRAW",
  "ACTION", "CATEGORY", "DATA", "MIMETYPE", "ACTIVITY_CLEAR_TASK", "ACTIVITY_CLEAR_TOP", "ACTIVITY_NO_HISTORY"]);
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// paquets/activités de chaque émulateur (règles « androidpackage » seulement)
const emulators = {};
for (const m of rules.matchAll(/<emulator name="([^"]+)">([\s\S]*?)<\/emulator>/g)) {
  const entries = [];
  for (const r of m[2].matchAll(/<rule type="androidpackage">([\s\S]*?)<\/rule>/g)) {
    for (const e of r[1].matchAll(/<entry>([^<]+)<\/entry>/g)) entries.push(e[1].trim());
  }
  if (entries.length) emulators[m[1]] = entries;
}

const platforms = {};
const used = new Set();
let dropped = 0;
for (const [ibox, esde] of Object.entries(PLATFORMS)) {
  const block = systems.match(new RegExp(`<system>\\s*<name>${esde}</name>([\\s\\S]*?)</system>`));
  if (!block) throw new Error(`système ES-DE introuvable : ${esde}`);
  const commands = [];
  for (const c of block[1].matchAll(/<command label="([^"]+)">([^<]+)<\/command>/g)) {
    const command = decode(c[2].trim());
    const emulator = command.match(/^%EMULATOR_([^%]+)%/)?.[1];
    const vars = [...command.matchAll(/%[^%\s]+%/g)].map((v) => v[0].slice(1, -1));
    const unsupported = vars.filter((v) => !v.startsWith("EMULATOR_") && !/^EXTRA(BOOL|INTEGER|ARRAY)?_/.test(v) && !SUPPORTED.has(v));
    if (!emulator || !emulators[emulator] || unsupported.length) {
      dropped++;
      continue;
    }
    used.add(emulator);
    commands.push({ label: decode(c[1]), command });
  }
  platforms[ibox] = commands;
}

const out = {
  source: "ES-DE pour Android (licence MIT) : resources/systems/android/es_find_rules.xml et es_systems.xml, https://gitlab.com/es-de/emulationstation-de",
  generated: new Date().toISOString().slice(0, 10),
  emulators: Object.fromEntries(Object.entries(emulators).filter(([k]) => used.has(k)).sort(([a], [b]) => a.localeCompare(b))),
  platforms,
};
const file = join(root, "src-tauri/src/launcher/android-emulators.json");
writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
const total = Object.values(platforms).reduce((n, c) => n + c.length, 0);
console.log(`${file} : ${Object.keys(out.emulators).length} émulateurs, ${total} commandes (${dropped} écartées)`);
