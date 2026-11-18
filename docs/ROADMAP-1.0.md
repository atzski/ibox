# iBox 1.0 — feuille de route

Objectif : une application publiable, fiable sur un PC « vierge », agréable au
quotidien, avec un vrai réseau d'amis. Quatre phases, chacune livrable seule.

## Phase 1 — Prête à publier

| Ajout | Détail | État |
|---|---|---|
| Démarrage avec Windows | Option (désactivée par défaut) : iBox démarre discrètement dans la zone de notification. | Fait |
| Rapport de problème | Paramètres › Système : un fichier de diagnostic (version, Windows, bibliothèque, émulateurs, erreurs récentes) créé localement, jamais envoyé tout seul ; aucune clé ni mot de passe dedans. | Fait |
| Mises à jour | Vérification au démarrage et à la demande, téléchargement et installation signés (clé de signature hors du projet). Activées dès qu'une adresse de publication existe. | Fait (GitHub Releases, atzski/ibox) |
| Stabilité | Bibliothèque vide, hors connexion, gros volumes, PC sans émulateurs ni Steam. | Fait (18/11/2026, voir « Audit avant 1.0 ») |
| Signature du programme | Certificat de signature de code (SmartScreen « éditeur inconnu »). | **Décision : achat d'un certificat** |
| Hébergement des mises à jour | GitHub Releases (gratuit) ou serveur iBox. | Fait : GitHub Releases, relais `latest.json` sur atzski/inbox-releases |

## Phase 2 — Le quotidien (faite)

Fait : statistiques (Paramètres › Profil), collections (accueil, fiche, étagère 3D), sauvegardes
(fiche › Sauvegardes : repérage + copies de sécurité), mode TV (Paramètres › Apparence).
Réglages par console : Paramètres › Consoles (émulateur, plein écran, lancement, sauvegardes).

- Statistiques de jeu : temps par console, jeux du moment, séries (les données existent déjà).
- Collections personnelles : rangées créées par l'utilisateur (« À finir », « Coop »…), aussi sur l'étagère 3D.
- Sauvegardes de jeu : emplacement des sauvegardes par émulateur, copie de sécurité à la demande.
- Réglages par console : émulateur, plein écran, arguments, dans un seul écran clair.
- Mode TV / canapé : interface agrandie, tout à la manette.

## Phase 3 — iNetbox en ligne (en cours)

Serveur hébergé sur Render (offre gratuite, mise en veille après inactivité) avec base Neon :
https://inetbox-server.onrender.com — iBox s'y connecte par défaut depuis le 13/11/2026.
Activité des amis en direct (notifications de connexion et de jeu) : faite. Invitations à jouer :
déployées (serveur 0.2 en ligne le 13/11/2026).

- Hébergement du serveur iNetbox (aujourd'hui local) : **décision d'hébergement**.
- Activité des amis en direct, notifications de connexion.
- Invitations à jouer.

## Phase 4 — Finition et lancement

Fait : mentions légales et confidentialité (Paramètres › Système › À propos, et `site/confidentialite.html`
généré par `node scripts/build-site-legal.mjs`), « Quoi de neuf » (`src/content/changelog.ts`, à compléter
à chaque version), page de téléchargement `site/` (lien à renseigner à la publication).
Fait aussi : traduction anglaise complète (0.1.92) ; site refait le 18/11/2026 (`site/` : français `index.html`, anglais
`en.html`, captures réelles, bouton vers le dernier installeur, `confidentialite.html` / `privacy.html` générés depuis
`src/content/legal.ts`, mentions légales mises à jour : iNetbox, Remote Play, manuels, SmartConfig, Platforms).
Site en ligne depuis le 18/11/2026 : https://atzski.github.io/ibox/ (GitHub Pages, branche `gh-pages` de atzski/ibox,
qui ne contient que `site/`).

- Page de téléchargement (captures, consoles prises en charge).
- Anglais en plus du français.
- « Quoi de neuf » après chaque mise à jour.
- Mentions légales : licences des sources (GameTDB, LaunchBox, SteamGridDB, libretro, iiDB), confidentialité (iNetbox).

## Audit avant 1.0 (18/11/2026)

Fait dans ce passage :
- Journal des plantages `logs/crash.log` (paniques Rust et erreurs de l'interface), repris dans le rapport de problème.
- `panic = "unwind"` : une panique dans un fil de fond n'arrête plus toute l'application ; la base de la bibliothèque survit à une panique (verrou empoisonné récupéré).
- Filet d'erreur par écran (« Cet écran a rencontré un problème », Réessayer / Accueil) et filet global (« Recharger iBox ») : plus d'écran vide.
- Écrans secondaires (Paramètres, Communauté, SmartConfig, Plateformes, Succès) chargés à la demande puis préchargés : paquet de démarrage 879 → 504 Ko.
- Code chaud compilé en `opt-level = 3` (Opus, str0m, 7z/zip, empreintes, PNG/JPEG, SHA-256) ; le reste reste compact.
- CSP : `object-src`, `base-uri`, `form-action`, `frame-ancestors` fermés. Outils Windows (explorer, cmd, PowerShell) appelés par leur chemin complet.

Reste avant la 1.0, par priorité :
1. Certificat de signature de code (SmartScreen) : principal frein à l'installation chez un nouvel utilisateur.
2. E-mails sur Render (`RESEND_API_KEY`, `MAIL_FROM`) : sans eux, « mot de passe oublié » ne marche pas.
3. Serveur iNetbox en veille (offre gratuite Render) : premier appel lent après inactivité ; offre payante ou réveil planifié.
4. Installateur en français seulement (`nsis.languages`) : ajouter l'anglais avec la traduction complète.
5. Images de la Communauté en `bytea` sur Neon : passer à un stockage objet (R2) avant d'avoir du monde.
6. Pas d'intégration continue : lancer `tsc`, `vitest` et `cargo test` à chaque publication (au moins dans `release.ps1`).
7. Entretien : `SettingsScreen.tsx` (~1 400 lignes) à découper par catégorie ; fenêtres toast/overlay qui chargent tout le paquet commun.

Stabilité (phase 1), 18/11/2026 :
- Windows « N » (Europe) : Media Foundation chargé à la demande (`/DELAYLOAD`, build.rs) ; iBox démarre sans le Media Feature Pack, clips et Remote Play l'expliquent.
- Aucune dépendance au runtime Visual C++ (vérifié dans les imports de l'exécutable).
- Hors connexion : tous les clients HTTP ont un délai ; un téléchargement d'émulateur figé échoue après 60 s sans données au lieu de bloquer.
- 10 000 jeux : liste lue en ~0,1 s (test `volume_10000_jeux`), désormais hors du fil principal ; grille : cartes mémorisées et plus de retour à 36 cartes quand les données sont relues.
- Sans Steam ni émulateurs : veille Steam silencieuse et légère, jeux de démonstration et proposition d'émulateur déjà en place.
