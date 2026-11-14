# iBox 1.0 — feuille de route

Objectif : une application publiable, fiable sur un PC « vierge », agréable au
quotidien, avec un vrai réseau d'amis. Quatre phases, chacune livrable seule.

## Phase 1 — Prête à publier

| Ajout | Détail | État |
|---|---|---|
| Démarrage avec Windows | Option (désactivée par défaut) : iBox démarre discrètement dans la zone de notification. | Fait |
| Rapport de problème | Paramètres › Système : un fichier de diagnostic (version, Windows, bibliothèque, émulateurs, erreurs récentes) créé localement, jamais envoyé tout seul ; aucune clé ni mot de passe dedans. | Fait |
| Mises à jour | Vérification au démarrage et à la demande, téléchargement et installation signés (clé de signature hors du projet). Activées dès qu'une adresse de publication existe. | Fait (en attente de l'adresse) |
| Stabilité | Bibliothèque vide, hors connexion, gros volumes, PC sans émulateurs ni Steam. | En cours |
| Signature du programme | Certificat de signature de code (SmartScreen « éditeur inconnu »). | **Décision : achat d'un certificat** |
| Hébergement des mises à jour | GitHub Releases (gratuit) ou serveur iBox. | **Décision : où publier** |

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
Reste : traduction anglaise complète (chantier dédié : toute l'interface, puis choix de langue) ;
hébergement du site (GitHub Pages, par exemple).

- Page de téléchargement (captures, consoles prises en charge).
- Anglais en plus du français.
- « Quoi de neuf » après chaque mise à jour.
- Mentions légales : licences des sources (GameTDB, LaunchBox, SteamGridDB, libretro, iiDB), confidentialité (iNetbox).
