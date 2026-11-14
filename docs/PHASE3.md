# Phase 3 — Métadonnées et jaquettes (livrée)

Sources, vérifications et licences : voir [PROVIDERS.md](PROVIDERS.md).

## Ce qui fonctionne

| Brique | Fichier | État |
| --- | --- | --- |
| Client HTTP poli (identification générique, délais, taille max, intervalle par hôte) | `src-tauri/src/metadata/http.rs` | ✅ |
| Cache d'images validé (format réel, dimensions, 25 Mo max, nettoyage) | `metadata/media.rs` | ✅ |
| Correspondances : sûres = appliquées, incertaines = proposées | `metadata/matching.rs` | ✅ |
| libretro-thumbnails (jaquette, écran-titre, capture, logo) | `metadata/libretro_thumbs.rs` | ✅ |
| GameTDB (titres, synopsis FR/EN, éditeur, année, genre, joueurs) | `metadata/gametdb.rs` | ✅ |
| libretro-database (CRC32 / nom) | `metadata/libretro_meta.rs` | ✅ |
| SteamGridDB (clé vérifiée, coffre Windows) | `metadata/steamgriddb.rs`, `keys.rs` | ✅ |
| Récupération en arrière-plan, annulable, après chaque actualisation | `metadata/job.rs`, `MetaStatus.tsx` | ✅ |
| Habillage 3D/2D : vraie jaquette, faces générées autour (couleurs, vraies captures, vrai synopsis) | `src/art/assets.ts`, `covers.ts` | ✅ |
| Import d'images personnelles (avant, dos, tranche, scan complet, disque…) | `MediaModal.tsx` | ✅ |
| Paramètres : sources, clé, bases, cache | `MetadataPanel.tsx` | ✅ |

Migration SQLite v2 : tables `media`, `ref_gametdb`, `ref_libretro_meta`,
`ref_libretro_thumbs`, `ref_sources` ; colonnes `media_status`, `meta_source`, `crc32`.

## Règles respectées

- **Jamais de faux scan** : dos, tranche et disque restent des habillages générés tant
  que l'utilisateur n'importe pas les siens.
- **Jamais d'attribution douteuse** : titre approchant → « Jaquette à choisir ».
- **Jamais d'écrasement** d'une image importée ni d'un titre corrigé à la main.
- **Hors connexion** : bases et images en cache ; en cas d'échec réseau, message clair
  et poursuite avec les données locales.
- **Clés API** : uniquement dans le Gestionnaire d'identifiants Windows, vérifiées avant
  enregistrement, jamais relues par l'interface.
- **Téléchargements** limités aux hôtes des sources (aucune URL arbitraire).

## Vérification

- 76 tests Rust, 27 tests interface.
- Tests réseau réels (manuels) : `cargo test --test live_sources -- --ignored --nocapture`.
- Application Windows : 5 jeux de test → 4 jaquettes et fiches trouvées automatiquement,
  15 images, 1 « à choisir » (titre approximatif) résolu par l'utilisateur.

## Limites connues

- Pas de source libre et fiable pour dos / tranche / disque / manuels (GameTDB bloque
  les téléchargements automatisés ; ScreenScraper exige des identifiants développeur).
- Synopsis : français quand GameTDB l'a, sinon anglais ; consoles hors GameTDB sans synopsis.
- Première récupération plus lente (téléchargement des index et bases), ensuite rapide.
- La Switch n'a pas de dossier libretro : seule SteamGridDB (avec clé) fournit ses jaquettes.
