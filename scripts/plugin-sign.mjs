#!/usr/bin/env node
// Signature des paquets de plugins iBox (`.iboxplugin`), voir docs/PLUGINS.md §3.
//
//   node scripts/plugin-sign.mjs keygen <fichier.key>
//       crée une clé ed25519 d'éditeur (PEM PKCS#8) et affiche la clé publique à intégrer
//       dans src-tauri/src/plugins/trust.rs. La clé privée reste hors du dépôt et du coffre.
//   node scripts/plugin-sign.mjs sign <paquet.iboxplugin> --key <fichier.key> --id <id> --version <x.y.z>
//        [--publisher atzski] [--url <adresse du paquet>]
//       affiche l'entrée de catalogue (sha256, signature) à publier.
//
// Message signé : "ibox-plugin-v1\n<id>\n<version>\n<sha256 hex>" (identique à trust.rs).
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";

const [cmd, file, ...rest] = process.argv.slice(2);
const opt = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const rawPublic = (key) => createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

if (cmd === "keygen" && file) {
  if (existsSync(file)) throw new Error(`Le fichier existe déjà : ${file}`);
  const { privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(file, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  console.log(`Clé publique (base64) : ${rawPublic(privateKey)}`);
} else if (cmd === "sign" && file) {
  const keyFile = opt("key");
  const id = opt("id");
  const version = opt("version");
  if (!keyFile || !id || !version) throw new Error("--key, --id et --version sont requis.");
  const key = createPrivateKey(readFileSync(keyFile));
  const bytes = readFileSync(file);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const message = `ibox-plugin-v1\n${id}\n${version}\n${sha256}`;
  const signature = sign(null, Buffer.from(message), key).toString("base64");
  const entry = { id, version, publisher: opt("publisher") ?? "atzski", url: opt("url") ?? file, size: statSync(file).size, sha256, signature };
  console.log(JSON.stringify(entry, null, 2));
  console.error(`Clé publique : ${rawPublic(key)}`);
} else {
  console.error("Usage : plugin-sign.mjs keygen <fichier.key> | sign <paquet> --key <fichier.key> --id <id> --version <x.y.z> [--url <url>]");
  process.exit(1);
}
