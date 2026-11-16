# Compilation et publication d’iBox

Le workflow Windows lance les tests TypeScript et Rust puis construit un installateur NSIS de test. L’installateur et son empreinte SHA-256 sont joints à l’exécution GitHub Actions. Ces artefacts de CI ne sont pas des versions publiées.

## Versions officielles

Les versions officielles sont publiées sur https://github.com/atzski/ibox/releases, la page de téléchargement d’iBox. Le mainteneur utilise `scripts/release.ps1` :

1. `.\scripts\release.ps1` construit l’installateur, sa signature de mise à jour Tauri, `latest.json`, `SHA256SUMS.txt` et `NOTES.md` dans `release\v<version>\`. Rien n’est publié.
2. `.\scripts\release.ps1 -Publish` crée la release `v<version>` avec ces fichiers.

Le script refuse de continuer si :

- les numéros de version de `package.json`, `Cargo.toml` et `tauri.conf.json` diffèrent ;
- `src/content/changelog.ts` n’a pas d’entrée pour la version. C’est la seule source des notes ;
- un fichier contient des informations du poste de compilation (nom d’utilisateur, dossier personnel, nom du PC, identité git). Les chemins de compilation sont effacés du programme avec `--remap-path-prefix` ;
- la release existe déjà, ou si l’installeur a changé depuis sa construction.

iBox vérifie ses mises à jour à l’adresse `https://github.com/atzski/ibox/releases/latest/download/latest.json`. Les versions 0.1.46 et antérieures lisaient `atzski/inbox-releases`. Le script y dépose aussi ce `latest.json`, seul, pour qu’elles reçoivent la mise à jour.

La clé privée de signature des mises à jour reste chez le mainteneur, hors du dépôt. Une signature Authenticode destinée à Windows est une opération distincte. Si elle est ajoutée, elle doit précéder le calcul de la signature du fichier pour les mises à jour Tauri.
