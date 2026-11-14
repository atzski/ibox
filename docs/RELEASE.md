# Compilation et publication d’iBox

Le workflow Windows lance les tests TypeScript et Rust puis construit un installateur NSIS de test. L’installateur et son empreinte SHA-256 sont joints à l’exécution GitHub Actions.

Le canal public est https://github.com/atzski/inbox-releases/releases. Les artefacts de CI ne publient aucune mise à jour sur ce canal. La clé privée Tauri reste chez le mainteneur.

Pour une publication officielle, le script `scripts/release.ps1` produit l’installateur et son manifeste Tauri. Une signature Authenticode destinée à Windows est une opération distincte. Si elle est ajoutée, elle doit précéder le calcul de la signature du fichier pour les mises à jour Tauri.
