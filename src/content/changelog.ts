/**
 * Nouveautés de chaque version, affichées une fois après une mise à jour
 * (« Quoi de neuf »). La plus récente en premier.
 */
export interface Release {
  version: string;
  date: string;
  highlights: { icon: "shelf" | "front" | "user" | "power" | "clock" | "grid" | "disc" | "gamepad" | "sparkle" | "globe" | "trophy" | "copy" | "download" | "key"; title: string; text: string }[];
}

export const CHANGELOG: Release[] = [
  {
    version: "0.1.57",
    date: "2026-11-17",
    highlights: [
      { icon: "globe", title: "Bouton « Remote Play » sur chaque jeu", text: "Sur la fiche d’un jeu, « Remote Play » choisit un ami iNetbox, règle ses droits (Joueur par défaut) et lance le jeu, sans passer par les paramètres. Remote Play s’active depuis ce menu." },
      { icon: "gamepad", title: "Manette de l’ami reconnue", text: "La manette de l’invité est bien transmise et apparaît comme une manette de plus sur l’hôte (P2 si l’hôte joue déjà). Session d’essai : droits « Joueur » par défaut." },
      { icon: "sparkle", title: "Lisibilité en mode sombre", text: "Commentaires des captures Communauté et résultats du diagnostic Remote Play bien lisibles en mode sombre ; nombreuses traductions anglaises ajoutées (profil, collections, sauvegardes…)." },
      { icon: "disc", title: "Boîtes de cartouches réparées", text: "L’intérieur de la boîte ouverte est visible et le rabat ne se mélange plus à la jaquette en se refermant." },
    ],
  },
  {
    version: "0.1.56",
    date: "2026-11-17",
    highlights: [
      { icon: "gamepad", title: "Remote Play (expérimental)", text: "Jouez à distance avec un ami iNetbox, directement d’ordinateur à ordinateur : invitez-le depuis Paramètres › Remote Play, il voit votre écran ou votre jeu et peut jouer avec sa manette. À activer vous-même ; désactivé par défaut." },
      { icon: "key", title: "Vous gardez la main", text: "Chaque invité commence sans aucun droit ; vous choisissez Spectateur, Joueur ou Collaborateur. Un témoin reste affiché pendant le partage, avec un arrêt d’urgence au clavier. Le partage s’arrête quand Windows se verrouille." },
      { icon: "globe", title: "Serveur iNetbox allégé", text: "iNetbox relit beaucoup moins de données à chaque mise à jour de la présence de vos amis." },
    ],
  },
  {
    version: "0.1.55",
    date: "2026-11-16",
    highlights: [
      { icon: "globe", title: "Remote Play en préparation", text: "Nouvelle page Paramètres › Remote Play : un diagnostic réel vérifie si ce PC peut héberger ou recevoir un stream (Windows, carte graphique, encodeurs, son, réseau). Le jeu à distance arrive dans une prochaine version ; il reste désactivé d’ici là." },
    ],
  },
  {
    version: "0.1.54",
    date: "2026-11-16",
    highlights: [
      { icon: "disc", title: "Jeux PC en boîtier 3D", text: "Comme sur console, chaque jeu PC a son boîtier DVD en 3D sur sa fiche : faites-le tourner, ouvrez-le, regardez le dos, la tranche et sortez le disque imprimé à son image." },
      { icon: "front", title: "Jaquettes PC soignées", text: "Bandeau « PC DVD-ROM » et boutique sur la face, dos sombre avec la bannière, le résumé et les captures du jeu, disque avec son logo." },
      { icon: "gamepad", title: "Jeu déjà lancé reconnu", text: "Ajoutez un jeu PC pendant qu’il tourne : iBox le considère aussitôt comme lancé (temps de jeu, Alt+E), sans le relancer." },
      { icon: "key", title: "Adresse e-mail lisible", text: "La ligne « Adresse e-mail » du compte iNetbox se lit enfin en mode sombre." },
    ],
  },
  {
    version: "0.1.53",
    date: "2026-11-16",
    highlights: [
      { icon: "sparkle", title: "Réactions et commentaires", text: "Dans la Communauté, réagissez aux partages de vos amis avec un émoji et commentez-les, avec des petits mots tout prêts." },
      { icon: "user", title: "Onglet Amis repensé", text: "Votre carte est plus claire : statut en un geste, trois réglages bien rangés (partie, jeux, ne pas déranger) et de grands boutons ronds ; plus de texte illisible en mode sombre." },
      { icon: "front", title: "Alt+E partout", text: "L’overlay de capture s’ouvre même quand iBox ne détecte aucun jeu : capturez n’importe quoi à l’écran." },
      { icon: "trophy", title: "Salle des trophées ajustée", text: "Votre nom n’est plus caché par le bandeau, et la pastille de niveau est plus discrète." },
    ],
  },
  {
    version: "0.1.52",
    date: "2026-11-16",
    highlights: [
      { icon: "globe", title: "Communauté plus rapide", text: "Le fil affiche des miniatures légères ; l’image entière ne se charge qu’en l’ouvrant. Chaque partage n’est téléchargé qu’une fois, puis gardé sur ce PC." },
    ],
  },
  {
    version: "0.1.51",
    date: "2026-11-16",
    highlights: [
      { icon: "key", title: "Clés API enregistrées partout", text: "Sur certains PC, le coffre Windows refusait les clés API (erreur 8). iBox réessaie autrement, puis les garde dans un coffre chiffré propre à votre session Windows." },
      { icon: "user", title: "Supprimer un joueur", text: "Paramètres › Profil › Joueurs de ce PC : supprimez un profil, ses réglages, fonds et captures. Son compte iNetbox, lui, n’est pas supprimé." },
    ],
  },
  {
    version: "0.1.50",
    date: "2026-11-16",
    highlights: [
      { icon: "globe", title: "Hub de la communauté", text: "En pleine partie, Alt+E ouvre l’overlay iBox : gardez une capture d’écran, un clip des 12 dernières secondes, puis partagez-les avec vos amis dans la Communauté." },
      { icon: "user", title: "Chaque joueur chez soi", text: "Changez d’utilisateur depuis l’accueil. Chaque profil a son compte iNetbox, ses fonds, son thème et ses réglages ; seuls les jeux restent communs." },
      { icon: "key", title: "Compte par e-mail", text: "L’inscription demande une adresse e-mail ; on peut se connecter avec, et réinitialiser un mot de passe oublié grâce à un code reçu par e-mail." },
      { icon: "gamepad", title: "Jusqu’à 8 manettes", text: "De P1 à P8 : à partir de trois manettes, une pastille compacte « P1,2 +N » déplie la liste complète." },
      { icon: "grid", title: "Jaquettes en plein écran", text: "En faisant défiler la grille, tout le haut de l’écran s’efface en douceur ; il revient dès que vous remontez." },
      { icon: "disc", title: "Boîtes qui s’ouvrent", text: "Game Boy et autres boîtes carton : le rabat s’ouvre avant que la cartouche sorte." },
      { icon: "trophy", title: "Succès mieux intégrés", text: "Pastille discrète sur les fiches console, raccourcis Succès et Fond plus petits sur l’accueil, et votre photo de profil iBox dans la salle des trophées." },
    ],
  },
  {
    version: "0.1.49",
    date: "2026-11-16",
    highlights: [
      { icon: "download", title: "Mises à jour réparées", text: "L’installation d’une mise à jour ne reste plus bloquée : iBox se met à jour d’un clic, puis redémarre tout seul." },
      { icon: "sparkle", title: "Notifications plus sûres", text: "La fenêtre de notification en bas à droite ne fige plus iBox quand elle s’ouvre pendant une partie." },
    ],
  },
  {
    version: "0.1.48",
    date: "2026-11-17",
    highlights: [
      { icon: "trophy", title: "Salle des trophées", text: "Succès Steam et RetroAchievements réunis : niveau de joueur, prochains objectifs, médailles avec leur rareté, vitrine et classement entre amis." },
      { icon: "gamepad", title: "Joueur 2", text: "Une deuxième manette pilote aussi iBox, avec son témoin P2 dans la barre du haut." },
      { icon: "user", title: "Messages en direct", text: "Les messages arrivent en quelques secondes ; on voit quand l’ami écrit, et « Vu » sous vos messages." },
      { icon: "disc", title: "Vraies galettes", text: "Les disques GameCube et Wii affichent leur vrai scan (GameTDB, LaunchBox) ; plus de titre imprimé sur un disque illustré." },
      { icon: "shelf", title: "Bibliothèque plus grande", text: "En mode Jaquettes, les barres se replient en défilant ; sur l’étagère, le logo de la console arrive en flottant." },
      { icon: "sparkle", title: "Petits plus", text: "Logos GIF animés, fichiers .bat et .cmd pour les jeux PC, jingles moins forts, 5 copies de sauvegardes par jeu, choix d’émulateur sans fermeture surprise, traduction anglaise complétée." },
    ],
  },
  {
    version: "0.1.47",
    date: "2026-11-16",
    highlights: [
      { icon: "trophy", title: "Univers des succès", text: "Nouvel écran Succès : votre profil RetroAchievements, vos jeux en cours, la vitrine des maîtrises, le classement avec les joueurs que vous suivez, et une page par jeu avec la rareté de chaque succès." },
      { icon: "sparkle", title: "Succès en direct", text: "Chaque succès débloqué pendant une partie s’affiche aussitôt, par-dessus le jeu, avec son badge." },
      { icon: "copy", title: "Doublons regroupés", text: "Réunissez les régions et révisions d’un même jeu sur une seule fiche, puis choisissez la version à lancer." },
      { icon: "front", title: "Fond de l’accueil", text: "Une galerie de fonds rien que pour l’accueil : motifs iBox, illustrations de vos jeux, galerie en ligne ou votre image." },
      { icon: "clock", title: "Notifications utiles", text: "Chaque notification mène au bon endroit d’un clic, s’affiche même en plein jeu, et les tâches en cours se réduisent pour ne plus gêner." },
      { icon: "download", title: "Mises à jour automatiques", text: "iBox vérifie tout seul les nouvelles versions et vous propose de les installer d’un clic." },
    ],
  },
  {
    version: "0.1.46",
    date: "2026-11-16",
    highlights: [
      { icon: "sparkle", title: "RetroAchievements mieux trouvés", text: "Modifiez le titre recherché ; les correspondances sont plus justes et les jeux sans succès publiés sont signalés." },
      { icon: "gamepad", title: "Nouvelle icône", text: "iBox a une nouvelle icône." },
    ],
  },
  {
    version: "0.1.45",
    date: "2026-11-15",
    highlights: [
      { icon: "grid", title: "Collections personnalisées", text: "Masquez le nom sur la carte et choisissez l’ordre des jeux." },
      { icon: "user", title: "Menu Amis corrigé", text: "Le bouton Amis ouvre à nouveau la liste." },
    ],
  },
  {
    version: "0.1.42",
    date: "2026-11-14",
    highlights: [
      { icon: "sparkle", title: "Recherche rapide stable", text: "La fenêtre garde la même taille pendant la saisie." },
    ],
  },
  {
    version: "0.1.41",
    date: "2026-11-14",
    highlights: [
      { icon: "user", title: "Réglages Amis plus clairs", text: "« Partie visible » et « Bibliothèque visible » ne se confondent plus." },
      { icon: "clock", title: "Notifications de téléchargement", text: "Masquez-les dans Paramètres → Notifications." },
      { icon: "disc", title: "Jeux 3DS .cia", text: "Les fichiers .cia sont reconnus." },
    ],
  },
  {
    version: "0.1.40",
    date: "2026-11-14",
    highlights: [
      { icon: "grid", title: "Fonds de collection appliqués", text: "Le fond choisi s'affiche pleinement sur la carte, quel que soit son style, même pour les images très lourdes." },
    ],
  },
  {
    version: "0.1.38",
    date: "2026-11-14",
    highlights: [
      { icon: "front", title: "Boîtes Game Boy au bon format", text: "Game Boy et Game Boy Color : boîtes presque carrées, jaquettes affichées sans être étirées." },
    ],
  },
  {
    version: "0.1.37",
    date: "2026-11-14",
    highlights: [
      { icon: "user", title: "Onglet Amis embelli", text: "Fonds des jeux dans votre carte et chez vos amis en jeu, boutons réorganisés." },
    ],
  },
  {
    version: "0.1.36",
    date: "2026-11-14",
    highlights: [
      { icon: "gamepad", title: "Jeux PC détectés", text: "Un jeu PC lancé par sa boutique (Epic, Steam…) apparaît « En jeu » dans Amis, pour vous et vos amis." },
    ],
  },
  {
    version: "0.1.35",
    date: "2026-11-14",
    highlights: [
      { icon: "sparkle", title: "« Quoi de neuf » plus clair", text: "Après plusieurs mises à jour d'un coup, un résumé, les dernières versions en détail et les plus anciennes regroupées." },
    ],
  },
  {
    version: "0.1.34",
    date: "2026-11-14",
    highlights: [
      { icon: "user", title: "Votre jeu dans Amis", text: "Quand vous jouez, votre carte affiche « En jeu » avec le jeu et son logo." },
    ],
  },
  {
    version: "0.1.33",
    date: "2026-11-14",
    highlights: [
      { icon: "sparkle", title: "Fondu des jingles", text: "En revenant en arrière, le jingle s'éteint en douceur." },
    ],
  },
  {
    version: "0.1.32",
    date: "2026-11-14",
    highlights: [
      { icon: "sparkle", title: "Jingles automatiques", text: "Jingles activés : chaque jeu ajouté reçoit le sien automatiquement." },
    ],
  },
  {
    version: "0.1.31",
    date: "2026-11-14",
    highlights: [
      { icon: "power", title: "Page Son réparée", text: "Paramètres → Son ne s'affiche plus en gris." },
    ],
  },
  {
    version: "0.1.30",
    date: "2026-11-14",
    highlights: [
      { icon: "disc", title: "Nouvelle console : Wii U", text: "Jeux .wux, .wud, .wua, .rpx, lancement avec Cemu, boîtier bleu et jaquettes." },
    ],
  },
  {
    version: "0.1.29",
    date: "2026-11-14",
    highlights: [
      { icon: "front", title: "Fonds de bannière fiables", text: "Les fonds SteamGridDB se téléchargent comme les illustrations des jeux." },
    ],
  },
  {
    version: "0.1.28",
    date: "2026-11-14",
    highlights: [
      { icon: "user", title: "Bannière lisible", text: "La bannière s'affiche dans l'en-tête du profil, pseudo et logo toujours lisibles." },
    ],
  },
  {
    version: "0.1.27",
    date: "2026-11-14",
    highlights: [
      { icon: "sparkle", title: "Votre musique de menu", text: "Paramètres → Son : une musique en boucle ou une playlist, dans l'ordre ou en aléatoire." },
    ],
  },
  {
    version: "0.1.26",
    date: "2026-11-14",
    highlights: [
      { icon: "front", title: "Bannière depuis un jeu", text: "Choisissez la bannière de profil parmi les fonds d'un jeu." },
    ],
  },
  {
    version: "0.1.25",
    date: "2026-11-14",
    highlights: [
      { icon: "user", title: "Profils repensés", text: "Grande bannière, photo avec halo, bio en bulle et jeux favoris en jaquettes." },
    ],
  },
  {
    version: "0.1.24",
    date: "2026-11-14",
    highlights: [
      { icon: "grid", title: "Collections plus nettes", text: "La roue dentée disparaît aussitôt l'éditeur fermé." },
    ],
  },
  {
    version: "0.1.23",
    date: "2026-11-14",
    highlights: [
      { icon: "globe", title: "Moins de requêtes iNetbox", text: "Les clics répétés et les actualisations rapprochées sont limités pour réduire la charge du serveur." },
      { icon: "gamepad", title: "Raccourci de recherche", text: "Le bouton de recherche rapide est indiqué en bas à droite de l’accueil." },
    ],
  },
  {
    version: "0.1.22",
    date: "2026-11-14",
    highlights: [
      { icon: "shelf", title: "Collections intelligentes", text: "Filtrez vos jeux automatiquement et prévisualisez la carte pendant sa personnalisation." },
      { icon: "gamepad", title: "Recherche rapide", text: "Retrouvez les jeux, consoles et collections depuis l’accueil, même à la manette." },
      { icon: "user", title: "À quoi on joue ?", text: "Comparez vos jeux avec ceux d’un ami et personnalisez votre profil avec une bannière et trois jeux favoris." },
      { icon: "disc", title: "Sauvegarde portable", text: "Exportez vos collections, réglages et jingles personnels pour les retrouver sur un autre PC." },
    ],
  },
  {
    version: "0.1.21",
    date: "2026-11-14",
    highlights: [
      { icon: "user", title: "Présence en mode sombre", text: "Boutons de présence plus contrastés en mode sombre." },
    ],
  },
  {
    version: "0.1.20",
    date: "2026-11-14",
    highlights: [
      { icon: "sparkle", title: "Jingles rétablis", text: "Les jingles ne dépendent plus des effets sonores." },
    ],
  },
  {
    version: "0.1.19",
    date: "2026-11-14",
    highlights: [
      { icon: "shelf", title: "Cartes de collection épurées", text: "Le compteur de jeux et la roue dentée apparaissent au survol ou à la sélection." },
      { icon: "user", title: "Visibilité du profil", text: "Ouvrez les profils publics depuis vos invitations. Dans votre compte iNetbox, choisissez qui peut voir le vôtre." },
    ],
  },
  {
    version: "0.1.18",
    date: "2026-11-14",
    highlights: [
      { icon: "grid", title: "Icônes de licences à parcourir", text: "Parcourez les icônes de licences iiDB pour vos collections." },
    ],
  },
  {
    version: "0.1.17",
    date: "2026-11-14",
    highlights: [
      { icon: "sparkle", title: "Soutenir iBox", text: "Paramètres → À propos → « Offrir un café »." },
    ],
  },
  {
    version: "0.1.16",
    date: "2026-11-14",
    highlights: [
      { icon: "grid", title: "Couleur des collections", text: "La couleur choisie colore le compteur de jeux et la roue dentée." },
    ],
  },
  {
    version: "0.1.15",
    date: "2026-11-14",
    highlights: [
      { icon: "front", title: "Jaquettes PC épurées", text: "Plus de bandeau en haut : l'illustration occupe toute la face." },
    ],
  },
  {
    version: "0.1.14",
    date: "2026-11-14",
    highlights: [
      { icon: "grid", title: "Icônes intactes", text: "Les icônes de licences gardent leur forme, sans coins coupés." },
    ],
  },
  {
    version: "0.1.13",
    date: "2026-11-14",
    highlights: [
      { icon: "front", title: "Boîtes PC plus fines", text: "Bandeau gris clair transparent avec un logo PC plus discret, et un bord d'ouverture détaillé sur les boîtiers (encoche, nervures, reflet)." },
    ],
  },
  {
    version: "0.1.12",
    date: "2026-11-14",
    highlights: [
      { icon: "grid", title: "Icônes de licences", text: "Donnez à une collection l'icône d'une licence iiDB (Mario, Zelda…) : la carte devient cette icône, toute simple." },
      { icon: "grid", title: "Modifier les jeux d'une collection", text: "Dans une collection ouverte, « Modifier les jeux » ajoute ou retire des jeux d'un clic." },
    ],
  },
  {
    version: "0.1.11",
    date: "2026-11-14",
    highlights: [
      { icon: "front", title: "Jaquettes PC et tranches soignées", text: "Votre logo PC choisi dans le bandeau des boîtes PC, et des tranches bien plus détaillées pour toutes les consoles (illustration, logo du jeu, année, reflet)." },
    ],
  },
  {
    version: "0.1.10",
    date: "2026-11-14",
    highlights: [
      { icon: "grid", title: "Logos et fonds à chercher", text: "Dans une collection, cherchez un logo de licence sur iiDB ou SteamGridDB et un fond sur SteamGridDB, puis réglez la taille du logo et l'assombrissement." },
    ],
  },
  {
    version: "0.1.9",
    date: "2026-11-14",
    highlights: [
      { icon: "grid", title: "Collections à votre image", text: "Logo d'un de vos jeux (iiDB, SteamGridDB), image de fond, style de carte et couleur libre : modifiez une collection avec sa roue dentée." },
      { icon: "front", title: "Jaquettes PC plus détaillées", text: "Bandeau PC, genre, éditeur et année, liseré et reflet de boîtier." },
    ],
  },
  {
    version: "0.1.8",
    date: "2026-11-14",
    highlights: [
      { icon: "sparkle", title: "Nouvelle police : Cal Sans", text: "Une écriture plus nette et plus affirmée dans toute l'interface." },
      { icon: "grid", title: "Des thèmes bien plus marqués", text: "Chaque palette colore maintenant le fond, les boutons et un décor de couleurs derrière l'interface (Paramètres → Apparence)." },
      { icon: "gamepad", title: "Icônes de consoles respectées", text: "Les icônes iiDB gardent leur forme d'origine, sans bords coupés." },
    ],
  },
  {
    version: "0.1.7",
    date: "2026-11-14",
    highlights: [
      { icon: "sparkle", title: "Vos propres jingles", text: "Sur la fiche d'un jeu, « Mon jingle » importe le son de votre choix. Il passe avant celui d'iiDB et reste même si vous retirez les sons téléchargés." },
    ],
  },
  {
    version: "0.1.6",
    date: "2026-11-14",
    highlights: [
      { icon: "sparkle", title: "Volume et suivi des jingles", text: "Réglez le volume des jingles dans Paramètres → Son, suivez leur téléchargement et soyez prévenu quand il est terminé." },
    ],
  },
  {
    version: "0.1.5",
    date: "2026-11-14",
    highlights: [
      { icon: "sparkle", title: "Jingles des jeux", text: "Ouvrez la fiche d'un jeu : sa petite musique se lance. Activez-les dans Paramètres → Son (téléchargées depuis iiDB, retirables à tout moment)." },
    ],
  },
  {
    version: "0.1.4",
    date: "2026-11-14",
    highlights: [
      { icon: "user", title: "Profils, messages, favoris", text: "Ouvrez le profil d'un ami, écrivez-lui, épinglez vos favoris et voyez les photos de profil de chacun." },
      { icon: "sparkle", title: "Notifications façon iBox", text: "Un ami lance un jeu, vous ajoute ou vous écrit : une carte apparaît en bas à droite, même iBox réduit." },
      { icon: "shelf", title: "Jeux en commun", text: "Sur la fiche d'un jeu, voyez quels amis l'ont aussi (s'ils partagent leur bibliothèque)." },
      { icon: "clock", title: "Activité des amis", text: "Ce que vos amis ont lancé ces 7 derniers jours, dans Amis → Activité." },
    ],
  },
  {
    version: "0.1.3",
    date: "2026-11-14",
    highlights: [
      { icon: "sparkle", title: "Mises à jour plus claires", text: "Le téléchargement s'affiche étape par étape, et en cas d'échec un bouton permet de réessayer." },
      { icon: "gamepad", title: "Dossier Steam au choix", text: "Si Steam n'est pas trouvé, choisissez son dossier dans Paramètres → PC." },
      { icon: "front", title: "Plus de tranches de jaquettes", text: "Les tranches sont aussi proposées depuis les autres consoles, même pour vos jeux PC." },
      { icon: "power", title: "Réduire iBox", text: "Un bouton dans la barre du haut pour réduire iBox sans l'éteindre." },
      { icon: "globe", title: "Langue dès le départ", text: "Français ou English se choisit sur le premier écran après l'installation." },
      { icon: "clock", title: "Sauvegardes de la bibliothèque", text: "Supprimez les anciennes copies depuis Paramètres → Système." },
    ],
  },
  {
    version: "0.1.2",
    date: "2026-11-14",
    highlights: [
      { icon: "gamepad", title: "Détection de Steam", text: "iBox retrouve Steam même lorsque le client est installé dans un autre dossier ou sur un autre disque." },
    ],
  },
  {
    version: "0.1.1",
    date: "2026-11-13",
    highlights: [
      { icon: "globe", title: "iBox en anglais", text: "Choisissez Français ou English dans Paramètres → Apparence." },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-11-13",
    highlights: [
      { icon: "shelf", title: "Étagère 3D", text: "Une rangée par console façon carrousel, les vraies jaquettes recto-verso, les boîtiers de chaque console modélisés." },
      { icon: "user", title: "Qui joue ?", text: "Plusieurs profils sur le même PC, et un assistant pour tout configurer en quelques étapes." },
      { icon: "grid", title: "Collections et statistiques", text: "Rangez vos jeux comme vous voulez et suivez votre temps de jeu." },
      { icon: "globe", title: "iNetbox en ligne", text: "Vos amis, ce à quoi ils jouent en direct, et les invitations à jouer." },
      { icon: "power", title: "iBox en arrière-plan", text: "Il s'efface pendant que vous jouez et reste près de l'horloge." },
    ],
  },
];

/** Compare deux versions « a.b.c » (négatif si a < b). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
