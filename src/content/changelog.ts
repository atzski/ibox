/**
 * Nouveautés de chaque version, affichées une fois après une mise à jour
 * (« Quoi de neuf »). La plus récente en premier.
 */
export interface Release {
  version: string;
  date: string;
  highlights: { icon: "shelf" | "front" | "user" | "power" | "clock" | "grid" | "disc" | "gamepad" | "sparkle" | "globe" | "trophy" | "copy" | "download" | "key" | "manual"; title: string; text: string }[];
}

export const CHANGELOG: Release[] = [
  {
    version: "1.0.26",
    date: "2026-11-26",
    highlights: [
      { icon: "sparkle", title: "Chaque plugin a son icône", text: "La fenêtre d’un plugin, comme le Studio d’iClips, a maintenant son propre bouton dans la barre des tâches de Windows, avec le logo du plugin au lieu de celui d’iBox." },
    ],
  },
  {
    version: "1.0.25",
    date: "2026-11-26",
    highlights: [
      { icon: "sparkle", title: "Le son des clips se règle dans iClips", text: "Dans le Studio d’iClips, les barres Son du jeu et Micro changent vraiment ce que vous entendez pendant la lecture : iBox fournit maintenant au Studio les pistes du jeu et du micro gardées à part." },
    ],
  },
  {
    version: "1.0.24",
    date: "2026-11-26",
    highlights: [
      { icon: "sparkle", title: "« Clip ça ! » ne garde plus de clips pour rien", text: "Dans iBox installé, le moteur Vosk ne se chargeait pas et « Clip ça ! » repassait sur la reconnaissance vocale de Windows, qui gardait des clips pour rien. Vosk se charge désormais à chaque fois." },
    ],
  },
  {
    version: "1.0.23",
    date: "2026-11-26",
    highlights: [
      { icon: "front", title: "Les fiches s’ouvrent sans figer", text: "Ouvrir la fiche d’un jeu ne fige plus l’interface quand l’étagère 3D vient de se mettre en pause." },
      { icon: "sparkle", title: "Le bon jingle sur chaque fiche", text: "Une fiche ne joue plus le jingle d’un autre jeu, comme celui de Zelda sur « Callus »." },
      { icon: "shelf", title: "Retour à l’étagère sans accroc", text: "Revenir d’une fiche à l’étagère 3D se fait sans accroc : l’étagère reste vivante sous la fiche." },
    ],
  },
  {
    version: "1.0.22",
    date: "2026-11-26",
    highlights: [
      { icon: "sparkle", title: "Un nouveau moteur pour « Clip ça ! »", text: "« Clip ça ! » passe par Vosk, un moteur de reconnaissance vocale open source qui fonctionne sans Internet, livré avec iBox. Il reconnaît la phrase elle-même : « Tac », « Clic », « C’est ça » ou une conversation ne gardent plus de clip, et votre « Clip ça ! » est reconnu dès le début de l’écoute." },
      { icon: "sparkle", title: "Rien ne part tout seul", text: "La musique, un jeu ou une notification qui sortent du PC ne comptent jamais comme votre voix. Le journal logs/voix.log dit pourquoi chaque son a été gardé ou refusé." },
    ],
  },
  {
    version: "1.0.21",
    date: "2026-11-26",
    highlights: [
      { icon: "disc", title: "Seulement YouTube Music", text: "Music in the Box ne suit plus que YouTube Music : une vidéo ouverte ailleurs, sur Twitter, YouTube ou dans un onglet, ne prend plus la place de votre musique." },
    ],
  },
  {
    version: "1.0.20",
    date: "2026-11-26",
    highlights: [
      { icon: "sparkle", title: "« Clip ça ! » écoute votre voix, pas le PC", text: "« Clip ça ! » ne se fie plus au score du moteur vocal, qui confondait votre phrase avec la musique, un jeu ou une notification. iBox compare maintenant votre micro à tout ce que le PC fait sortir (enceintes, casque, écran) : seule une voix au micro, nettement au-dessus de ce son, garde un clip. Le journal logs/voix.log dit pourquoi chaque son a été refusé." },
      { icon: "sparkle", title: "Votre phrase passe du premier coup", text: "Dite normalement, même un peu bas, « Clip ça ! » est de nouveau reconnu : la règle de la 1.0.19 refusait la plupart des vraies phrases." },
    ],
  },
  {
    version: "1.0.19",
    date: "2026-11-26",
    highlights: [
      { icon: "sparkle", title: "Plus de clips au lancement", text: "Au démarrage d’iBox ou d’un jeu, les sons d’accueil et la notification « Clip ça ! vous écoute » pouvaient garder un ou deux clips tout seuls. L’écoute ignore désormais les 20 premières secondes." },
      { icon: "sparkle", title: "« Clip ça ! » n’écoute plus la musique", text: "Avec de la musique ou un jeu dans les enceintes, des sons étaient pris pour « Clip ça ! » toutes les quelques secondes. Seule la phrase dite nettement garde maintenant un clip : si elle ne passe pas, redites-la un peu plus clairement." },
    ],
  },
  {
    version: "1.0.18",
    date: "2026-11-26",
    highlights: [
      { icon: "disc", title: "Des fins de titre sans saut", text: "Dans Music in the Box, la fin d’un titre ne saute plus jusqu’au suivant sans fondu : la vraie durée du titre est utilisée, même quand YouTube Music en annonce une autre. Avec le plugin Music in the Box 1.0.12." },
      { icon: "sparkle", title: "« Clip ça ! » vous suit quand vous enchaînez", text: "Une phrase dite fort ou traînée compte de nouveau. Après six clips à la voix en deux minutes, l’écoute fait une pause de deux minutes puis reprend seule, sans rien à réactiver." },
    ],
  },
  {
    version: "1.0.17",
    date: "2026-11-26",
    highlights: [
      { icon: "sparkle", title: "« Clip ça ! » ne part plus tout seul", text: "Un son long du jeu pouvait être pris pour « Clip ça ! » et garder un clip sans que vous parliez. La phrase est courte : un son qui dure trop longtemps ne compte plus, et votre « Clip ça ! » passe toujours du premier coup." },
    ],
  },
  {
    version: "1.0.16",
    date: "2026-11-26",
    highlights: [
      { icon: "disc", title: "Un journal pour Music in the Box", text: "Music in the Box note ce que font les fondus entre les titres dans logs/music.log, pour comprendre une fin de titre qui saute. Avec le plugin Music in the Box 1.0.11." },
    ],
  },
  {
    version: "1.0.15",
    date: "2026-11-26",
    highlights: [
      { icon: "sparkle", title: "« Clip ça ! » plus facile à déclencher", text: "La phrase reconnue de justesse garde maintenant le clip du premier coup, sans avoir à la répéter. Trois clips à la voix en moins de 90 s mettent toujours l’écoute en pause, au cas où un son du PC lui ressemblerait." },
    ],
  },
  {
    version: "1.0.14",
    date: "2026-11-26",
    highlights: [
      { icon: "disc", title: "Une file d’attente pour Music in the Box", text: "Un bouton + à côté de chaque titre (recherche, albums, playlists, fiches d’artiste) l’ajoute à la file. À suivre montre la vraie file, avec les titres ajoutés, et un titre ajouté passe avant la lecture automatique. Avec le plugin Music in the Box 1.0.10." },
    ],
  },
  {
    version: "1.0.13",
    date: "2026-11-26",
    highlights: [
      { icon: "sparkle", title: "« Clip ça ! » vous entend, même en pleine partie", text: "La phrase dite au milieu du son d’un jeu est mieux reconnue : si elle n’est pas sûre du premier coup, la répéter suffit. Un dialogue de jeu ne garde toujours pas de clip, et un journal de l’écoute (sans rien de ce qui est dit) aide à comprendre un raté." },
    ],
  },
  {
    version: "1.0.12",
    date: "2026-11-25",
    highlights: [
      { icon: "sparkle", title: "« Clip ça ! » vous entend de nouveau", text: "La 1.0.11 était devenue trop stricte et ne reconnaissait presque plus la phrase. L’écoute compare maintenant ce qu’elle entend à la parole ordinaire : « Clip ça ! » dit au micro garde le clip, la musique et les dialogues d’un jeu ne déclenchent toujours rien." },
      { icon: "disc", title: "Des fondus enchaînés sans coupure", text: "Dans Music in the Box, le début du fondu entre deux titres ne fait plus entendre de micro-coupure, le titre suivant ne s’arrête plus tout seul après le fondu, aucun autre titre ne joue plus par-dessus, et la musique des menus d’iBox ne revient plus pendant l’écoute." },
      { icon: "grid", title: "L’accueil revient en haut", text: "En revenant à l’accueil depuis les succès ou un autre écran, la page repart en haut au lieu de s’arrêter au milieu." },
    ],
  },
  {
    version: "1.0.11",
    date: "2026-11-25",
    highlights: [
      { icon: "sparkle", title: "« Clip ça ! » n’entend plus que vous", text: "La musique, une sonnerie ou les dialogues d’un jeu pouvaient passer pour « Clip ça ! » et garder des clips sans fin. La voix n’accepte plus que la phrase dite clairement, et trois clips à la voix en moins de 90 s la mettent en pause, avec une notification." },
    ],
  },
  {
    version: "1.0.10",
    date: "2026-11-25",
    highlights: [
      { icon: "sparkle", title: "« Clip ça ! » ne s’emballe plus", text: "Le son de la notification d’un clip gardé pouvait être pris pour « Clip ça ! » et relancer des clips en boucle. La voix fait maintenant une courte pause après chaque clip." },
      { icon: "disc", title: "Un fondu enchaîné sans à-coups", text: "Dans Music in the Box, le fondu entre deux titres ne fait plus entendre de sons en double ni de sauts de volume. Avec le plugin Music in the Box 1.0.7." },
    ],
  },
  {
    version: "1.0.9",
    date: "2026-11-25",
    highlights: [
      { icon: "sparkle", title: "« Clip ça ! » ne s’écoute plus lui-même", text: "Quand vous regardez un clip dans iClips, sa phrase « Clip ça ! » sortie des haut-parleurs ne crée plus un nouveau clip : l’écoute se tait pendant la lecture et revient juste après, sans toucher à vos réglages. Avec le plugin iClips 0.7.1." },
      { icon: "power", title: "Le volume du micro et du son de Windows", text: "Paramètres › Système règle maintenant le volume du son de Windows et celui du micro dans vos prochains clips. Dans iClips, Réglages › Son les montre toujours, avec un curseur fin." },
    ],
  },
  {
    version: "1.0.8",
    date: "2026-11-25",
    highlights: [
      { icon: "sparkle", title: "Des clips avec le plugin iClips", text: "iBox ouvre ses clips aux plugins. Avec iClips, un Studio range vos clips, un panneau remplace l’overlay de capture en jeu, et l’on coupe, assemble, passe en vertical ou en GIF. Dites « Clip ça ! » pour garder les dernières secondes, puis glissez le clip vers Discord ou envoyez-le à un ami." },
      { icon: "disc", title: "Les .iso trouvent leur console", text: "iBox reconnaît maintenant les .iso PS3, Xbox et Xbox 360. Quand le contenu d’un .iso ne dit rien, iBox vous demande « De quelle console s’agit-il ? » au lieu de deviner, et se souvient de la réponse." },
      { icon: "grid", title: "Le mode Jaquette prend du recul", text: "Cinq niveaux d’affichage, de la grille habituelle jusqu’à plus de trente jaquettes par rangée : Ctrl + molette, touches − et +, ou stick droit à la manette. La grille reste fluide même avec une très grande bibliothèque. La barre de la bibliothèque passe en icônes, avec les logos des consoles." },
      { icon: "sparkle", title: "Une ambiance sonore dans les menus", text: "Un air original et discret, clavier doux, basse et écho, remplace la musique des menus. Il se règle dans Paramètres › Son, sous Ambiance sonore." },
      { icon: "gamepad", title: "Remote Play plus réactif", text: "L’image reste stable quand le jeu occupe tout le processeur de l’hôte, et le nouveau réglage Priorité à la réactivité garde de la marge quand la connexion limite le débit." },
      { icon: "power", title: "Steam Deck : mode performance", text: "Le mode performance (Paramètres › Affichage) garde la même interface sans ce qui coûte cher aux petites machines, et iBox se met en veille quand un jeu passe devant. L’installation sur Steam Deck tient en une ligne." },
      { icon: "disc", title: "Music in the Box enchaîne les titres", text: "Un vrai fondu enchaîné entre les titres, une suite automatique de titres proches quand la file s’arrête, et des noms d’artistes cliquables qui ouvrent leur fiche. Avec le plugin Music in the Box 1.0.6." },
      { icon: "user", title: "Communauté et collections", text: "La Communauté accepte trois publications par jour et par compte ; les places restantes s’affichent. Pendant le rangement des collections, une barre suit l’écran avec un bouton Valider." },
    ],
  },
  {
    version: "1.0.7",
    date: "2026-11-21",
    highlights: [
      { icon: "sparkle", title: "Des captures d’écran en plein écran", text: "Le raccourci de capture fige maintenant l’image avec la même technique que les clips vidéo, pour ne plus donner une image noire avec les jeux en plein écran exclusif. L’ancienne méthode reste en secours si la nouvelle n’est pas disponible sur votre PC." },
    ],
  },
  {
    version: "1.0.6",
    date: "2026-11-21",
    highlights: [
      { icon: "disc", title: "Le lecteur réduit tient sur les grands écrans", text: "Sur un écran 1440p ou 4K, la barre du lecteur réduit de Music in the Box grandit avec le texte : le titre s’affiche en entier au lieu de quelques lettres, et la pochette comme les boutons gardent leurs proportions." },
    ],
  },
  {
    version: "1.0.5",
    date: "2026-11-21",
    highlights: [
      { icon: "disc", title: "Un lecteur réduit", text: "Music in the Box se replie en une petite barre : pochette, titre qui défile, précédent, pause, suivant et progression. Bouton dans le lecteur, Menu à la manette ou R au clavier ; LB et RB changent de titre, et iBox s’en souvient à la prochaine ouverture." },
      { icon: "sparkle", title: "Des vidéos dans la recherche", text: "La recherche du panneau musique a un onglet Vidéos : sons de fans, extraits de bandes originales, remix… Quand aucun titre officiel ne correspond, iBox y passe tout seul. Avec le plugin Music in the Box 1.0.5." },
    ],
  },
  {
    version: "1.0.4",
    date: "2026-11-21",
    highlights: [
      { icon: "disc", title: "Des paroles synchronisées avec la musique", text: "Dans le panneau Music in the Box, les paroles suivent maintenant le titre ligne par ligne : la ligne chantée grandit et s’éclaire, les autres s’estompent. Cliquez sur une ligne pour y amener la lecture. Avec le plugin Music in the Box 1.0.4 ; les clips vidéo, sans horaires, gardent un défilement estimé." },
    ],
  },
  {
    version: "1.0.3",
    date: "2026-11-21",
    highlights: [
      { icon: "grid", title: "Une recherche qui trouve tout", text: "La recherche (touche /, bouton Select) retrouve vos jeux avec leur jaquette, les consoles, vos collections, les pages des Paramètres et des actions. Elle comprend les initiales (« mk8 »), les sigles (« GC ») et une faute de frappe. Entrée ouvre le meilleur résultat, X lance le jeu." },
      { icon: "shelf", title: "Au hasard : iBox choisit pour vous", text: "Sur l’étagère 3D, le bouton Au hasard (touche R) fait défiler les boîtiers jusqu’à un jeu tiré au sort, qui fait un tour sur lui-même. Aussi depuis l’accueil, le menu rapide et la recherche." },
      { icon: "clock", title: "Un journal de jeu sur chaque fiche", text: "La pastille Journal d’une fiche ouvre le détail de vos parties : temps total, plus longue partie, rythme des douze dernières semaines, puis les parties une à une. La bibliothèque gagne le tri Joués récemment." },
      { icon: "disc", title: "Votre musique jusque dans iBox", text: "Avec le plugin Music in the Box, le titre en cours s’affiche dans la barre du haut (lecture, pause, suivant) et la musique des menus se tait tant que la vôtre joue. Le panneau gagne les paroles, une radio à partir d’un titre et un démarrage rapide quand rien ne joue." },
      { icon: "key", title: "Corrections", text: "Les liens vers les Paramètres ouvrent la bonne page. Une partie lancée après minuit compte pour le bon jour dans les statistiques, et la série de jours n’est plus limitée à 60. Dans le panneau musique, on avance dans un titre au clavier et à la manette." },
    ],
  },
  {
    version: "1.0.2",
    date: "2026-11-21",
    highlights: [
      { icon: "sparkle", title: "Des sons plus chauds et plus tactiles", text: "L’appui sur un bouton descend d’une octave : un « toc » grave et rond au lieu d’une note aiguë. Chaque signal est maintenant fait de couches (un contact feutré, un corps grave, puis la note) et toute la palette est plus chaude." },
      { icon: "key", title: "Un signal quand c’est enregistré", text: "Tous les boutons Enregistrer répondent de la même façon : un son dédié et une pastille « Enregistré » dont la coche se trace au-dessus du bouton, même si la fenêtre se referme aussitôt." },
      { icon: "grid", title: "Chaque destination a sa signature", text: "Accueil, Paramètres, Amis, Notifications, Profil, Recherche, menu rapide, réduction et extinction ont chacun leur propre son, et l’entrée dans une rubrique a son élan." },
    ],
  },
  {
    version: "1.0.1",
    date: "2026-11-21",
    highlights: [
      { icon: "sparkle", title: "Un nouveau design sonore", text: "Tous les sons d’iBox ont été refaits : des lames de verre et de bois, douces et précises, accordées entre elles pour former une seule famille. Le déplacement reste discret, la validation est plus présente, l’erreur reste douce." },
      { icon: "grid", title: "Tout ce qui se clique répond", text: "Chaque bouton, onglet, case ou lien a maintenant son signal, même dans les panneaux qui restaient muets. Les fenêtres ont un son d’ouverture et un son de fermeture accordés à leur animation." },
      { icon: "trophy", title: "Des signaux qui se reconnaissent", text: "Interrupteur allumé ou éteint, favori ajouté ou retiré, suppression, notification, message d’un ami, tâche terminée, lancement d’un jeu : chacun a désormais son propre son." },
      { icon: "power", title: "Plus de claquement parasite", text: "Un petit claquement pouvait parfois accompagner l’ouverture d’un boîtier ou le rangement d’un disque : il a disparu. Les sons se taisent toujours quand iBox est masqué, et suivent le volume choisi dans Paramètres, Son." },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-11-21",
    highlights: [
      { icon: "sparkle", title: "iBox 1.0 : tout bouge d’un seul geste", text: "Chaque animation d’iBox a été revue et suit désormais le même langage de mouvement : des ressorts doux pour ce qui répond à vos gestes, des fondus courts pour le reste. Écrans, cartes, menus et boutons se posent au lieu de sauter." },
      { icon: "grid", title: "Des écrans qui s’enchaînent", text: "Avancer fait entrer l’écran suivant en profondeur, revenir fait reculer le précédent. À l’ouverture, le décor arrive d’abord puis l’interface monte se poser." },
      { icon: "front", title: "Des jaquettes plus vivantes", text: "Une jaquette suit le pointeur de près puis revient se poser comme un ressort, et son reflet ne passe qu’au moment où vous la choisissez." },
      { icon: "copy", title: "Des fenêtres qui se retirent en douceur", text: "Les fenêtres de dialogue se ferment maintenant avec une courte sortie au lieu de disparaître d’un coup." },
      { icon: "power", title: "Plus léger pour la carte graphique", text: "Des animations qui tournaient en continu sans être vues ont été retirées, et le réglage Animations réduites (Paramètres, Affichage) est mieux respecté." },
    ],
  },
  {
    version: "0.1.113",
    date: "2026-11-21",
    highlights: [
      { icon: "disc", title: "Des albums dans Music in the Box", text: "La recherche du panneau musique a un troisième onglet, Albums : ouvrez un album pour voir ses titres, puis lisez-le en entier dans l’ordre ou à partir du titre de votre choix. Avec le plugin Music in the Box 1.0.2." },
    ],
  },
  {
    version: "0.1.112",
    date: "2026-11-21",
    highlights: [
      { icon: "globe", title: "La communauté iBox sur Discord", text: "iBox a maintenant son serveur Discord : aide, nouvelles versions, état d’iNetbox en direct et idées pour la suite. Rejoignez-le depuis Paramètres, Système, À propos." },
    ],
  },
  {
    version: "0.1.111",
    date: "2026-11-20",
    highlights: [
      { icon: "disc", title: "Des titres qui défilent sans s’arrêter", text: "Dans le panneau musique, un titre ou un nom d’artiste trop long pour tenir défile désormais en continu : il ne se fige plus après un redimensionnement du panneau ou l’arrivée de la police." },
    ],
  },
  {
    version: "0.1.110",
    date: "2026-11-20",
    highlights: [
      { icon: "sparkle", title: "Un verre sans raccord", text: "Le fond flouté du panneau musique est préparé une fois en petit au lieu d’être flouté en direct : plus de bande horizontale dans le verre, et moins de travail pour la carte graphique pendant que vous jouez." },
    ],
  },
  {
    version: "0.1.109",
    date: "2026-11-20",
    highlights: [
      { icon: "disc", title: "Titres aimés en un instant", text: "Dans Music in the Box, vos playlists s’affichent dès la première page de titres, et la suite arrive pendant que vous parcourez. « Titres aimés » est préparée dès l’ouverture de vos playlists." },
      { icon: "disc", title: "YouTube Music reste en coulisses", text: "La fenêtre de YouTube Music qui fait jouer la musique n’apparaît plus dans la barre des tâches ni dans Alt+Tab ; elle ne se montre que pour vous connecter." },
      { icon: "sparkle", title: "Un fond de panneau plus doux", text: "Le verre du panneau musique suit le jeu en fondu, et sa teinte glisse d’une pochette à l’autre au lieu de changer d’un coup." },
    ],
  },
  {
    version: "0.1.108",
    date: "2026-11-19",
    highlights: [
      { icon: "sparkle", title: "Plus de cadre jaune autour de l’écran", text: "L’enregistrement des clips en jeu ne fait plus apparaître de bordure jaune. Sur les Windows qui ne savent pas la masquer, les clips se mettent en pause au lieu de l’afficher." },
      { icon: "shelf", title: "Dossier Epic Games au choix", text: "Si iBox ne trouve pas Epic Games, Paramètres › PC permet de choisir son dossier à la main, comme pour Steam." },
    ],
  },
  {
    version: "0.1.107",
    date: "2026-11-19",
    highlights: [
      { icon: "sparkle", title: "Plugins", text: "Nouvel onglet Paramètres › Plugins : des extensions signées par leur créateur, publiées à part d’iBox. Leurs permissions sont affichées avant l’installation, et un plugin désactivé ne réserve ni raccourci ni fenêtre." },
      { icon: "disc", title: "Music in the Box", text: "Le premier plugin : pilotez YouTube Music ou votre lecteur Windows par-dessus vos parties, avec Alt+C ou Vue + Y à la manette. À installer depuis Paramètres › Plugins." },
      { icon: "key", title: "Raccourcis clavier réglables", text: "La capture en jeu passe à Alt+X par défaut. Paramètres › Système permet de choisir une autre combinaison, et iBox prévient quand une autre application l’utilise déjà." },
    ],
  },
  {
    version: "0.1.106",
    date: "2026-11-18",
    highlights: [
      { icon: "gamepad", title: "iBox arrive sur Steam Deck (en essai)", text: "Une version Steam Deck est publiée à côté de la version Windows, qui ne change pas. Vos amis sur Steam Deck peuvent rejoindre vos parties Remote Play : gardez iBox à jour sur ce PC." },
      { icon: "sparkle", title: "Profils graphiques", text: "Paramètres › Apparence › Rendu 3D : Automatique, Qualité, Steam Deck ou Économie. L’étagère garde son rendu ; seuls la finesse et le nombre d’images par seconde changent, pour soulager la carte graphique ou la batterie." },
      { icon: "clock", title: "Panneau des performances", text: "Paramètres › Système › Diagnostic › Afficher les performances : images par seconde, processeur, carte graphique et mémoire, et pendant Remote Play le ping, le décodage et le débit." },
    ],
  },
  {
    version: "0.1.105",
    date: "2026-11-18",
    highlights: [
      { icon: "gamepad", title: "Remote Play plus fluide chez l’invité", text: "Quand vous rejoignez la partie d’un ami, l’étagère 3D d’iBox se met en pause pendant toute la session : l’image de l’hôte a votre ordinateur pour elle seule." },
      { icon: "power", title: "Plus économe sur batterie", text: "Sur un PC portable débranché, iBox espace ses actualisations (amis, succès, boutiques) et dessine l’étagère 3D sans suréchantillonnage. Tout reprend son rythme dès que vous rebranchez." },
    ],
  },
  {
    version: "0.1.104",
    date: "2026-11-18",
    highlights: [
      { icon: "globe", title: "Des descriptions intactes en anglais", text: "Avec l’interface en anglais, la description d’un jeu restait truffée de mots traduits au hasard (« of », « and » au milieu du français). Elle s’affiche désormais telle quelle." },
      { icon: "globe", title: "Les derniers mots en français traduits", text: "« avec » sous le bouton Jouer, le compteur « pour le 100 % » des succès, l’étiquette du bouton Amis et la page Images et données passent enfin en anglais." },
      { icon: "manual", title: "Images et données à jour", text: "La case ScreenScraper « Bientôt » disparaît de Paramètres › Images et données : ScreenScraper sert déjà aux manuels, réglés dans Paramètres › Manuels." },
    ],
  },
  {
    version: "0.1.103",
    date: "2026-11-18",
    highlights: [
      { icon: "grid", title: "Des boîtes bien cadrées", text: "Dans le choix des jeux d’une collection, les boîtes plus petites (DS, 3DS, Switch…) ne laissent plus de bloc vide sous l’image : elles gardent leur vraie forme, alignées sur leur titre. Les jaquettes des cartes de collection remplissent aussi leur cadre." },
    ],
  },
  {
    version: "0.1.102",
    date: "2026-11-18",
    highlights: [
      { icon: "sparkle", title: "Un éditeur de collection repensé", text: "Tout est rangé en trois onglets, Apparence, Contenu et Icône, avec des sections colorées. L’aperçu de la carte reste visible pendant vos réglages, et les recherches de logos ou de fonds ne s’ouvrent que si vous les demandez." },
    ],
  },
  {
    version: "0.1.101",
    date: "2026-11-18",
    highlights: [
      { icon: "grid", title: "Des cartes sans voile coloré", text: "« Assombrir le fond » propose maintenant « Aucun » : le dégradé de couleur en bas des cartes de collection disparaît et l’image reste intacte." },
    ],
  },
  {
    version: "0.1.100",
    date: "2026-11-18",
    highlights: [
      { icon: "grid", title: "Des collections sans jaquettes", text: "Un nouveau style de carte, « Sans jaquettes », masque les boîtes de jeux pour ne garder que votre fond, votre logo et votre nom." },
      { icon: "sparkle", title: "Plus de place pour les stickers", text: "Dès qu’une recherche de stickers est lancée, les suggestions (Kirby, Mario…) s’effacent pour laisser toute la place aux résultats ; videz le champ pour les retrouver." },
    ],
  },
  {
    version: "0.1.99",
    date: "2026-11-18",
    highlights: [
      { icon: "sparkle", title: "Bien plus de stickers", text: "La recherche de stickers affiche maintenant des dizaines de résultats d’un coup dans des cases compactes, et en charge d’autres à mesure que vous faites défiler." },
    ],
  },
  {
    version: "0.1.98",
    date: "2026-11-18",
    highlights: [
      { icon: "sparkle", title: "Des stickers de jeux mignons", text: "Les décorations puisent maintenant dans les stickers animés de GIPHY : Kirby, Sonic, Pac-Man, Yoshi… détourés et tout public. Une clé GIPHY gratuite suffit, collée une seule fois." },
      { icon: "grid", title: "Des décorations bien dosées", text: "Une décoration n’occupe plus toute sa case : elle reste une petite incrustation, et sa taille se règle (petite, moyenne ou grande)." },
    ],
  },
  {
    version: "0.1.97",
    date: "2026-11-18",
    highlights: [
      { icon: "sparkle", title: "Des décorations 100 % jeu vidéo", text: "Les émojis quittent les décorations. À la place : les icônes de personnages et les logos transparents de n’importe quel jeu via SteamGridDB, animés compris, et pour chaque Pokémon ses rendus 3D de Pokémon HOME et son illustration officielle, en plus des sprites animés." },
    ],
  },
  {
    version: "0.1.96",
    date: "2026-11-18",
    highlights: [
      { icon: "globe", title: "Des pluriels bien accordés", text: "En anglais, les compteurs affichaient parfois « 5 gamex » : tous les nombres de jeux, consoles, images et succès s’écrivent maintenant correctement, comme le temps de jeu total dans vos statistiques." },
    ],
  },
  {
    version: "0.1.95",
    date: "2026-11-18",
    highlights: [
      { icon: "power", title: "iBox démarre sur tous les Windows", text: "Sur les éditions « N » de Windows, vendues en Europe, iBox ne se lançait pas. Il démarre désormais partout ; seuls les clips et Remote Play vous indiquent comment ajouter le module vidéo de Windows s’il manque." },
      { icon: "grid", title: "De très grandes collections, toujours fluides", text: "Avec des milliers de jeux, la grille ne revient plus au début pendant que les jaquettes arrivent, et la bibliothèque se met à jour sans figer l’écran." },
      { icon: "download", title: "Des installations qui ne restent plus bloquées", text: "Si la connexion se fige pendant le téléchargement d’un émulateur, iBox l’arrête au bout d’une minute et vous prévient, au lieu d’attendre sans fin." },
    ],
  },
  {
    version: "0.1.94",
    date: "2026-11-18",
    highlights: [
      { icon: "grid", title: "Une grille au cordeau", text: "Les collections s’alignent maintenant sur des cases carrées qui occupent toute la largeur de l’écran : une icône ou une décoration prend une case, une grande carte en prend deux. Plus de trous entre petites et grandes cartes." },
      { icon: "shelf", title: "Grandes et petites cartes se rangent ensemble", text: "Posez une grande carte sur deux petites : elles prennent sa place. Les cases visées s’allument pendant que vous la déplacez." },
    ],
  },
  {
    version: "0.1.93",
    date: "2026-11-18",
    highlights: [
      { icon: "grid", title: "Vos collections où vous voulez", text: "Avec Organiser, chaque collection ou décoration se pose dans la case de votre choix, même s’il reste des cases vides avant elle. Lâchée sur une autre carte, les deux échangent leur place." },
      { icon: "shelf", title: "Un glisser tout en douceur", text: "La carte attrapée suit maintenant la souris sans se dédoubler, puis glisse d’elle-même dans sa nouvelle case." },
      { icon: "sparkle", title: "Encore plus de décorations mignonnes", text: "Plus de 80 émojis animées (animaux, frimousses, étoiles, gourmandises…) rejoignent les Pokémon, qui passent eux aussi à 40, dont toute la famille d’Évoli." },
      { icon: "front", title: "Des boutons cohérents", text: "Les boutons des collections prennent la même forme que la barre de l’accueil : des icônes seules, avec leur nom en bulle au survol, qui ne se cache plus jamais derrière une carte." },
    ],
  },
  {
    version: "0.1.92",
    date: "2026-11-18",
    highlights: [
      { icon: "globe", title: "iBox parle anglais jusqu’au bout", text: "Les derniers textes restés en français dans l’interface anglaise sont traduits : consoles sans jeux, boutiques PC, sauvegarde de la collection, émulateurs, Remote Play et plus encore." },
      { icon: "sparkle", title: "Des Paramètres plus légers", text: "L’écran Paramètres est réorganisé en coulisses, une partie par catégorie : il reste aussi rapide à ouvrir et sera plus simple à faire évoluer." },
    ],
  },
  {
    version: "0.1.91",
    date: "2026-11-18",
    highlights: [
      { icon: "grid", title: "Toutes vos collections d’un coup d’œil", text: "Quand elles ne tiennent plus sur une ligne, vos collections passent à la ligne suivante au lieu de disparaître sur le côté : tout reste visible sur l’accueil." },
      { icon: "shelf", title: "Rangez à la souris", text: "Avec le bouton Organiser, maintenez le clic sur une collection et faites-la glisser où vous voulez : les autres s’écartent pour lui faire place. Les flèches restent là pour le clavier et la manette." },
      { icon: "sparkle", title: "Des décorations pour vos collections", text: "Le nouveau bouton étincelle ajoute une image ou un GIF seul, détouré comme les icônes : une icône iiDB, un Pokémon animé qui vous salue, ou votre propre image depuis le PC." },
      { icon: "front", title: "Un accueil plus sobre", text: "La barre de raccourcis de l’accueil ne garde que ses icônes. Leur nom s’affiche dès que vous les survolez ou les sélectionnez à la manette." },
    ],
  },
  {
    version: "0.1.90",
    date: "2026-11-18",
    highlights: [
      { icon: "power", title: "Plus solide que jamais", text: "Si un écran rencontre un problème, il propose de réessayer ou de revenir à l’accueil, et le reste d’iBox continue de fonctionner. Un incident en arrière-plan n’arrête plus l’application, et il est noté dans le rapport de problème (Paramètres › Système) pour être corrigé." },
      { icon: "sparkle", title: "Un démarrage plus léger", text: "iBox charge près de moitié moins de code au démarrage : les écrans moins fréquents (Paramètres, Communauté, Succès, Plateformes) se préparent en arrière-plan et s’ouvrent toujours aussitôt." },
      { icon: "key", title: "Sécurité renforcée", text: "Protections de l’interface resserrées, outils de Windows toujours appelés depuis leur emplacement officiel, et chaque version vérifiée par l’ensemble des tests avant d’être publiée." },
    ],
  },
  {
    version: "0.1.89",
    date: "2026-11-18",
    highlights: [
      { icon: "manual", title: "Un carnet à la bonne taille", text: "Ouvert, le manuel prend un peu plus de la moitié de la hauteur de l’écran et ne passe plus jamais sous les boutons de pages ni sous les vignettes, quelle que soit la taille de votre écran." },
    ],
  },
  {
    version: "0.1.88",
    date: "2026-11-18",
    highlights: [
      { icon: "manual", title: "Des carnets qui s’ouvrent aussitôt", text: "Pendant que vous regardez la boîte d’un jeu, son manuel se prépare en silence : un clic sur le carnet et la couverture est déjà là. Chaque page lue est gardée sur votre PC, les réouvertures sont instantanées, et la couverture puis les pages visibles passent toujours avant les vignettes." },
      { icon: "front", title: "Une page agrandie qui tient à l’écran", text: "Agrandie, une page s’affiche désormais en entier, nette, sans rien couper en haut ni en bas. Un double-clic (ou le bouton +) l’agrandit encore pour lire un détail." },
      { icon: "sparkle", title: "Un carnet bien net", text: "Le petit trait qui apparaissait à gauche au moment de tourner la première page a disparu : la tranche des pages ne se montre qu’une fois les feuilles posées." },
    ],
  },
  {
    version: "0.1.87",
    date: "2026-11-18",
    highlights: [
      { icon: "manual", title: "Un livret dans chaque boîte", text: "Comme dans la vraie vie, chaque boîte ouverte contient désormais son livret, glissé sous les clips. Cliquez dessus : le vrai manuel s’ouvre, fermé sur sa couverture, et se feuillette page après page. S’il n’a pas encore été trouvé, le livret vous propose d’en chercher un ou d’importer le vôtre." },
      { icon: "download", title: "Toute votre collection équipée", text: "iBox range maintenant tout seul, en arrière-plan, le manuel de chacun de vos jeux, nouveaux jeux compris. La recherche est bien plus large et choisit l’édition de votre jeu. Un bouton « Actualiser les manuels » dans Paramètres › Manuels relance tout, comme pour les illustrations." },
      { icon: "sparkle", title: "Des pages qui tournent en douceur", text: "Les pages se soulèvent avec leur ombre, les doubles pages scannées restent face à face, et le dos du livret n’apparaît plus à côté de la couverture : il le referme, à la toute fin." },
    ],
  },
  {
    version: "0.1.86",
    date: "2026-11-18",
    highlights: [
      { icon: "manual", title: "Les manuels entrent dans les boîtes", text: "Ouvrez la boîte d’un jeu : son manuel est glissé sous les clips, comme un vrai carnet. Cliquez dessus pour le feuilleter en double page, avec les vignettes, le zoom, le clavier ou la manette." },
      { icon: "globe", title: "Des manuels trouvés pour vous", text: "À l’ouverture d’une fiche, iBox cherche le manuel du jeu et ne l’ajoute que lorsqu’il est sûr de lui ; sinon, le bouton « Manuel » vous propose les versions trouvées. Sources et options dans Paramètres › Manuels." },
      { icon: "download", title: "Vos propres carnets", text: "Un scan de votre boîte ou un manuel numérique ? Importez n’importe quel PDF depuis le bouton « Manuel » de la fiche : il prend aussitôt place dans la boîte." },
    ],
  },
  {
    version: "0.1.85",
    date: "2026-11-18",
    highlights: [
      { icon: "shelf", title: "Une étagère tout en douceur", text: "Dans « Ma collection », les jaquettes apparaissent et s’effacent désormais en fondu sur le bord gauche de l’étagère, comme à droite, au lieu d’être coupées net." },
    ],
  },
  {
    version: "0.1.84",
    date: "2026-11-18",
    highlights: [
      { icon: "shelf", title: "Votre collection bien en vue", text: "Le jeu mis en avant derrière l’étagère de « Ma collection » ressort enfin : voile allégé, image plus nette et plus colorée. « Votre dernière aventure » laisse aussi bien mieux voir l’image du jeu, sous un voile de couleur bien plus léger." },
      { icon: "user", title: "Des visages d’amis plus nets", text: "Les photos du bouton Amis sont un peu plus grandes, cerclées et ne se mélangent plus quand elles se chevauchent." },
    ],
  },
  {
    version: "0.1.83",
    date: "2026-11-18",
    highlights: [
      { icon: "sparkle", title: "Des boutons aux couleurs de votre thème", text: "Boutons et icônes de toute l’app prennent maintenant les couleurs du thème choisi, tout en douceur ; les thèmes volontairement vifs, comme Bonbon et Agrume, gardent leur éclat." },
      { icon: "grid", title: "iBox Platforms en verre", text: "La tuile « iBox Platforms » de l’accueil devient une plaque de verre dépoli, translucide et plus douce, teintée par votre thème." },
      { icon: "front", title: "Un fond d’accueil plus doux", text: "Le grand fond de l’accueil est légèrement flouté pour laisser respirer les cases. Et « Votre dernière aventure » affiche toujours l’image du jeu, même sans grande illustration." },
    ],
  },
  {
    version: "0.1.82",
    date: "2026-11-18",
    highlights: [
      { icon: "user", title: "Vos amis en un coup d’œil", text: "Le bouton Amis de la barre du haut affiche maintenant les photos de vos amis, ceux en ligne en premier, avec leur pastille de présence et le nombre des autres." },
      { icon: "sparkle", title: "Un accueil plus sobre", text: "Les boutons de « Mes collections » se résument à leur icône, la ligne du nombre de plateformes disparaît, et le bouton pour changer d’utilisateur passe à gauche de votre profil." },
    ],
  },
  {
    version: "0.1.81",
    date: "2026-11-18",
    highlights: [
      { icon: "sparkle", title: "Votre collection change de visage", text: "La case « Ma collection » met désormais toujours en avant un de vos jeux, différent à chaque retour sur l’accueil, quel que soit le fond choisi. Et la tuile « iBox Platforms » se pare de couleurs vivantes." },
      { icon: "download", title: "Steam plus patient", text: "Quand les serveurs de Steam ont un raté (erreur 502, souvent pendant leur maintenance du mardi), iBox réessaie tout seul et vous explique la situation : vos jeux installés restent à jour, et les jeux possédés arrivent à l’actualisation suivante." },
    ],
  },
  {
    version: "0.1.80",
    date: "2026-11-17",
    highlights: [
      { icon: "sparkle", title: "Un jeu à l’honneur dans votre collection", text: "La case « Ma collection » de l’accueil met en avant un de vos jeux, tiré au hasard à chaque retour : sa grande illustration s’affiche derrière l’étagère, et le fond de l’écran retrouve son ambiance habituelle." },
      { icon: "grid", title: "Rangez vos collections", text: "Le bouton « Organiser » des collections de l’accueil permet de les remettre dans l’ordre de votre choix : glissez-les à la souris, ou déplacez-les avec les flèches au clavier et à la manette." },
    ],
  },
  {
    version: "0.1.79",
    date: "2026-11-17",
    highlights: [
      { icon: "sparkle", title: "Un de vos jeux en fond d’accueil", text: "À chaque retour sur l’accueil, iBox choisit un de vos jeux au hasard et le met en fond, flou et en bonne qualité. Vous préférez toujours le même ? Choisissez-le avec le bouton « Fond » de l’accueil ou dans les Paramètres." },
      { icon: "front", title: "Des notifications soignées", text: "Les notifications en bas à droite n’affichent plus de grand cadre sombre autour d’elles : une carte seule, avec un liseré aux couleurs de son type, une icône animée et le temps restant. Elles suivent le thème clair ou sombre de l’app." },
      { icon: "shelf", title: "Une étagère encore plus vivante", text: "Sur l’étagère de l’accueil, les jaquettes tournent, sautent ou se balancent bien plus souvent." },
    ],
  },
  {
    version: "0.1.78",
    date: "2026-11-17",
    highlights: [
      { icon: "shelf", title: "Un accueil qui vit", text: "Votre collection s’expose sur une étagère en 3D : vos jeux, debout sur leurs planches, défilent tranquillement, et de temps en temps l’une d’elles fait un tour sur elle-même ou un petit saut. Votre dernière aventure passe à droite, en carte compacte avec « Reprendre » en un geste." },
      { icon: "sparkle", title: "SmartConfig voit les réglages des PC", text: "SmartConfig lit désormais les configurations publiées par les joueurs PC sur EmuReady, et plus seulement celles des appareils mobiles : les recommandations « matériel similaire » apparaissent pour beaucoup plus de jeux. Pour un jeu Switch en XCI, l’identifiant du jeu est retrouvé auprès d’EmuReady. Les onglets Performance, Équilibré et Qualité passent de l’un à l’autre en douceur." },
      { icon: "gamepad", title: "Lichii pour la Switch 2, Fritchii pour Ocarina of Time", text: "Lichii, l'émulateur Switch 2 le plus actif, s'installe en un clic depuis la fiche de la Switch 2 et se met à jour comme les autres. Sur la fiche d'Ocarina of Time, iBox propose Fritchii, une version de Lichii faite pour ce jeu : installée et choisie pour ce jeu seulement, puis tenue à jour, sans changer l'émulateur de la console." },
      { icon: "grid", title: "De vraies alternatives", text: "Sur la fiche d’une console, les autres émulateurs ne sont plus cachés : chacun a sa carte complète, avec ce qui le distingue, l’installation en un clic et ses liens officiels." },
    ],
  },
  {
    version: "0.1.77",
    date: "2026-11-17",
    highlights: [
      { icon: "gamepad", title: "Eden pour la Switch", text: "Eden rejoint iBox Platforms pour la Nintendo Switch : installation en un clic depuis son site officiel, et SmartConfig sait appliquer les nombreuses configurations que la communauté EmuReady a testées avec lui. Lichii reste proposé en alternative." },
    ],
  },
  {
    version: "0.1.76",
    date: "2026-11-17",
    highlights: [
      { icon: "globe", title: "SmartConfig s’appuie sur EmuReady", text: "Les réglages partagés par les joueurs viennent désormais uniquement d’EmuReady, qui en rassemble déjà beaucoup : pour proposer les vôtres, publiez-les sur emuready.com. iBox ne garde aucune configuration de joueur sur ses serveurs." },
    ],
  },
  {
    version: "0.1.75",
    date: "2026-11-17",
    highlights: [
      { icon: "sparkle", title: "SmartConfig plus discret", text: "Sur la fiche d’un jeu, SmartConfig tient maintenant sur une seule pastille au-dessus de « Jouer » : son état en deux mots, et un léger halo quand une recommandation vous attend. Un clic la déplie pour optimiser, restaurer ou voir les configurations." },
    ],
  },
  {
    version: "0.1.74",
    date: "2026-11-17",
    highlights: [
      { icon: "sparkle", title: "iBox SmartConfig", text: "Less configuration. More gaming. Sur la fiche d’un jeu, SmartConfig cherche des réglages testés par d’autres joueurs pour votre émulateur, les compare à votre PC (processeur, carte graphique, écran) et vous explique pourquoi il en recommande un. Rien n’est appliqué sans vous : vous voyez d’abord la liste exacte des changements." },
      { icon: "disc", title: "Réglages par jeu, toujours réversibles", text: "SmartConfig n’écrit que dans les réglages propres au jeu, prévus par l’émulateur (Dolphin, PCSX2, DuckStation, PPSSPP, RPCS3, Azahar et RetroArch), jamais dans vos manettes, BIOS ou sauvegardes. Chaque optimisation est sauvegardée : « Restaurer » remet tout comme avant, et l’historique se consulte dans l’univers SmartConfig." },
      { icon: "globe", title: "Les réglages de la communauté", text: "Partagez une configuration qui marche bien chez vous avec votre compte iNetbox (aperçu exact avant publication), confirmez celles des autres et signalez les mauvaises. Consulter les recommandations ne demande aucun compte. Tout se règle dans Paramètres › SmartConfig, y compris les sources de données." },
    ],
  },
  {
    version: "0.1.73",
    date: "2026-11-17",
    highlights: [
      { icon: "sparkle", title: "Une iBox plus colorée", text: "Chaque action a désormais sa couleur, partout dans l’app : bleu pour ouvrir, vert pour jouer et les amis, jaune pour les favoris, violet pour les collections, rose pour les images, orange pour les réglages, rouge pour supprimer ou quitter. Les boutons ont un petit relief façon console, les fenêtres un bandeau aux couleurs du thème, et les catégories des Paramètres de vraies icônes colorées." },
      { icon: "grid", title: "Les palettes changent vraiment tout", text: "La palette choisie dans Paramètres › Apparence teinte maintenant les cartes, les menus, les filets et le fond, en mode clair comme en mode sombre. Les contrastes ont été vérifiés pour que chaque texte reste lisible." },
      { icon: "front", title: "Une fiche de jeu bien rangée", text: "Le bouton « Désinstaller » n’apparaît plus en double. Jouer et Remote Play sont côte à côte, les outils (Favoris, Collections, Sauvegardes, Images, Versions, Corriger) forment une grille régulière, et la désinstallation reste à part, en rouge, à côté des détails du fichier." },
    ],
  },
  {
    version: "0.1.72",
    date: "2026-11-17",
    highlights: [
      { icon: "disc", title: "PS2, PS1 et Saturn sans BIOS", text: "iBox Platforms recommande désormais des émulateurs libres qui n’ont besoin d’aucun BIOS : Play! pour la PlayStation 2, PCSX ReARMed pour la PlayStation et Yabause pour la Saturn. Un clic installe RetroArch et le bon cœur, et les jeux se lancent. PCSX2, DuckStation et Beetle Saturn restent proposés dans « Alternatives pour les connaisseurs », leur BIOS devient facultatif." },
      { icon: "front", title: "Des clips vidéo avec le son", text: "Les clips de l’overlay (Alt+E) deviennent de vraies vidéos MP4, encodées par la carte graphique : réglez leur durée (jusqu’à 30 secondes), leur qualité (480p, 720p ou 1080p à 60 images par seconde), et choisissez d’enregistrer le son de Windows et votre micro, dans Paramètres › Système › Overlay en jeu." },
      { icon: "globe", title: "Communauté : images seulement", text: "Pour le moment, la Communauté n’accepte que les captures d’écran : les clips vidéo restent sur votre PC, où vous pouvez les regarder et les retrouver dans le dossier des captures." },
    ],
  },
  {
    version: "0.1.71",
    date: "2026-11-17",
    highlights: [
      { icon: "download", title: "Désinstaller un jeu", text: "Un bouton « Désinstaller » sur chaque fiche supprime le jeu proprement : Steam s’en charge lui-même, sinon le désinstalleur officiel du jeu s’ouvre (fichiers, raccourcis et inscription Windows retirés). Un jeu ajouté à la main ou une ROM part à la Corbeille, jamais effacé pour de bon, et la fiche se met à jour toute seule." },
      { icon: "front", title: "Une fiche de jeu mieux rangée", text: "Jouer et Remote Play côte à côte, le favori en étoile juste à côté ; Illustrations, Modifier et Regrouper une version passent dessous en plus discret, la désinstallation à part en rouge." },
      { icon: "user", title: "Avatars et fonds de n’importe quel jeu", text: "Pour la photo de profil et la bannière, la recherche couvre tout le catalogue de jeux, pas seulement votre collection : tapez un nom, choisissez le jeu, puis l’image." },
    ],
  },
  {
    version: "0.1.70",
    date: "2026-11-17",
    highlights: [
      { icon: "trophy", title: "Un succès mis en avant qui brille", text: "Sur un profil, le succès mis en avant a sa propre carte : médaille dont l’anneau se remplit, pastille Steam ou RetroAchievements, pourcentage et barre de progression lumineuse animée. À 100 %, tout passe en or." },
    ],
  },
  {
    version: "0.1.69",
    date: "2026-11-17",
    highlights: [
      { icon: "user", title: "Profils en un clic", text: "Dans un groupe, sur une publication ou un commentaire de la Communauté, cliquez sur une photo de profil, un pseudo ou un « @pseudo » pour ouvrir le profil du joueur, même s’il n’est pas votre ami." },
      { icon: "sparkle", title: "Ajouter en ami directement", text: "Un profil public montre sa bannière, sa bio, ses jeux favoris et son succès mis en avant, avec un bouton « Ajouter en ami » : plus besoin de code-ami. Un profil privé garde tout pour ses amis et n’affiche que « Profil privé »." },
    ],
  },
  {
    version: "0.1.68",
    date: "2026-11-17",
    highlights: [
      { icon: "gamepad", title: "Remote Play bien plus réactif", text: "L’image de l’hôte s’affiche dès qu’elle est décodée, sans tampon de lissage, comme dans le cloud gaming. Elle part dès sa capture au lieu d’attendre jusqu’à une image entière, n’est plus retardée pour se caler sur le son, et chaque image reste assez petite pour traverser le réseau d’un coup." },
      { icon: "sparkle", title: "Commandes plus directes", text: "La manette de l’invité est lue 250 fois par seconde au lieu de 60, la souris part à chaque mouvement sans attendre l’image suivante, et le son est découpé en tranches de 10 ms. Sur l’hôte, capture, encodage et réseau passent en priorité devant le reste du PC." },
      { icon: "download", title: "Jeux Steam prêts tout de suite", text: "Dès que Steam a fini d’installer un jeu, sa fiche dans iBox passe d’« Installer » à « Jouer », même si iBox est resté ouvert devant pendant le téléchargement. Une désinstallation est vue de la même façon." },
    ],
  },
  {
    version: "0.1.67",
    date: "2026-11-17",
    highlights: [
      { icon: "gamepad", title: "Invitations Remote Play plus nettes", text: "Dans la liste des amis à inviter, le contour d’un ami coché n’est plus coupé en haut et en bas." },
    ],
  },
  {
    version: "0.1.66",
    date: "2026-11-17",
    highlights: [
      { icon: "power", title: "iBox s’allume avec Windows", text: "À l’ouverture de session, iBox démarre en arrière-plan, sans fenêtre ni musique, et attend dans la zone de notification : il est prêt dès que vous l’ouvrez. Activé par défaut, à couper dans Paramètres › Système › Démarrage (ou dans l’assistant de configuration)." },
      { icon: "sparkle", title: "Un démarrage plus propre", text: "Plus d’éclair de fenêtre en plein écran au démarrage avec Windows, et l’entrée de démarrage se répare toute seule après une mise à jour ou un déplacement d’iBox." },
      { icon: "gamepad", title: "Remote Play en plein écran", text: "Quand vous rejoignez un ami, son écran occupe tout votre écran. Bougez la souris pour voir l’hôte et la qualité de la connexion ; Échap, Select + Start maintenus ou le bouton central ouvrent un menu pour reprendre, envoyer votre clavier, voir les statistiques ou quitter proprement la session." },
    ],
  },
  {
    version: "0.1.65",
    date: "2026-11-17",
    highlights: [
      { icon: "gamepad", title: "Une vraie manette partout", text: "Les mêmes boutons dans tout iBox : A valide, B revient, LB / RB changent d’onglet, de vue, de catégorie ou de jeu, X lance le jeu choisi, Y le met en favori ou retourne le boîtier. La barre du bas montre les vrais boutons de votre manette, aux couleurs Xbox, PlayStation ou Nintendo." },
      { icon: "shelf", title: "Défiler beaucoup plus vite", text: "Les gâchettes sautent d’une page entière dans les grilles, les listes et les étagères (8 boîtiers d’un coup) ; un clic de stick ramène au début ou à la fin. Une direction maintenue accélère, et le stick droit fait défiler la page en douceur." },
      { icon: "grid", title: "Menu rapide", text: "Start (ou F1) ouvre un menu pour aller partout en deux appuis — accueil, collection, iBox Platforms, succès, communauté, paramètres — avec l’aide de toutes les commandes. Select (ou /) ouvre la recherche depuis n’importe quel écran, le bouton central revient à l’accueil." },
      { icon: "key", title: "Clavier virtuel", text: "Valider un champ de texte à la manette ouvre un clavier à l’écran (accents compris) : X efface, Y met une espace, Start valide. La recherche, les messages et les noms se remplissent sans clavier." },
      { icon: "front", title: "Feuilleter sa collection", text: "Sur la fiche d’un jeu, LB / RB passent au jeu précédent ou suivant de la même console. Dans les Paramètres, LB / RB changent de catégorie et B ramène d’abord à la liste ; les listes déroulantes se règlent à la croix." },
    ],
  },
  {
    version: "0.1.64",
    date: "2026-11-17",
    highlights: [
      { icon: "user", title: "Groupes de discussion", text: "Dans le panneau des amis, « Groupe » crée une discussion avec plusieurs amis (10 membres au plus) : nom du groupe, « … écrit », non lus, ajout d’amis et départ du groupe." },
      { icon: "gamepad", title: "Cases à cocher plus nettes", text: "Dans Remote Play, les confirmations sont de vraies cases iBox : grandes, lisibles et utilisables à la manette." },
    ],
  },
  {
    version: "0.1.63",
    date: "2026-11-17",
    highlights: [
      { icon: "gamepad", title: "Plusieurs amis invités d’un coup", text: "Dans Remote Play, cochez plusieurs amis puis invitez-les tous ensemble, avec les mêmes droits et le même écran partagé (jusqu’à 6 joueurs avec vous). Si une invitation échoue, iBox vous dit laquelle." },
      { icon: "sparkle", title: "Une étagère qui défile", text: "Dans iBox Platforms, les consoles sont posées côte à côte sur une étagère vitrée et défilent ensemble : la console choisie avance au centre, ses voisines restent visibles de part et d’autre." },
    ],
  },
  {
    version: "0.1.62",
    date: "2026-11-17",
    highlights: [
      { icon: "sparkle", title: "iBox Platforms plus naturel", text: "Les consoles flottent doucement sur place, sans glisser d’un côté à l’autre, et leur mouvement continue sans repartir de zéro quand vous changez de console. Elles sont aussi un peu plus petites pour mieux respirer à l’écran." },
      { icon: "gamepad", title: "Parcourir à la molette", text: "Dans iBox Platforms, chaque cran de molette passe à la console suivante ou précédente." },
      { icon: "grid", title: "Les nouvelles consoles à l’accueil", text: "Sur l’accueil, les consoles sans illustration montrent maintenant leur vraie photo : Xbox 360, Dreamcast, Mega Drive et toutes les autres." },
    ],
  },
  {
    version: "0.1.61",
    date: "2026-11-17",
    highlights: [
      { icon: "sparkle", title: "iBox Platforms", text: "Un musée des consoles dans iBox : 29 machines en vraies photographies, de l’Atari 2600 à la Switch 2, avec leur histoire, leur matériel et votre collection. Parcourez-les à la manette sur une frise chronologique, filtrez par constructeur ou par type." },
      { icon: "download", title: "L’émulateur installé pour vous", text: "Sur la fiche d’une console, « Installer » télécharge l’émulateur recommandé depuis sa source officielle, vérifie son empreinte, l’installe dans votre dossier iBox\\Emulators, l’enregistre et l’associe à la console. Progression réelle, annulation, mise à jour et retour à la version précédente." },
      { icon: "gamepad", title: "11 nouvelles consoles", text: "NES, Master System, Mega Drive, Game Gear, Saturn, Dreamcast, Atari 2600, Jaguar, Xbox, Xbox 360 et PlayStation 3 rejoignent la bibliothèque, avec leurs formats de jeux, jaquettes et profils de lancement. PS4, PS Vita et l’arcade sont à découvrir." },
      { icon: "key", title: "BIOS et prérequis expliqués", text: "Chaque fiche indique ce qui manque encore (BIOS, micrologiciel, composant Windows) et importe votre propre fichier au bon endroit. iBox ne télécharge jamais de BIOS ni de clés." },
      { icon: "front", title: "Votre jeu est presque prêt", text: "Un jeu sans émulateur propose désormais d’installer celui de sa console. Vos installations existantes sont reconnues, réutilisées et jamais remplacées sans votre accord." },
    ],
  },
  {
    version: "0.1.60",
    date: "2026-11-17",
    highlights: [
      { icon: "gamepad", title: "Remote Play jusqu’à 6 joueurs", text: "Invitez jusqu’à 5 amis dans la même partie : chacun a sa connexion directe et sa manette, branchée d’office comme une manette de plus sur l’hôte. « Inviter un ami de plus » depuis la carte de partage." },
      { icon: "key", title: "Collaborateur : la souris répond", text: "Sur la fenêtre d’un jeu, l’invité Collaborateur contrôle enfin souris et clavier, confinés à cette fenêtre (raccourcis système bloqués). Quand l’hôte arrête, l’invité revient aussitôt à iBox." },
      { icon: "user", title: "Plus d’écho Discord", text: "En appel Discord pendant une session, votre ami n’entend plus sa propre voix renvoyée : le son de Discord est retiré de ce qui lui est envoyé (Paramètres › Remote Play, activé par défaut)." },
      { icon: "power", title: "Plus rapide, plus de cartes graphiques", text: "Latence réduite (capture au plus près, encodeur en mode faible latence) et encodeurs AMD et Intel mieux pris en charge, y compris sur les PC à deux cartes graphiques." },
      { icon: "sparkle", title: "Communauté plus vivante", text: "Mentionnez un ami avec @ dans une légende ou un commentaire (il reçoit une notification), répondez aux commentaires, et profitez d’animations plus soignées." },
      { icon: "trophy", title: "Succès instantanés", text: "L’écran Succès s’ouvre déjà rempli avec vos dernières données, puis se met à jour en arrière-plan." },
      { icon: "shelf", title: "Nouveau logo, nouvelle musique", text: "iBox adopte son nouveau logo et une musique de menu originale, composée pour iBox. Au premier lancement, l’accueil montre « Votre dernière aventure » ; le dossier des jeux se choisit dans les Paramètres." },
    ],
  },
  {
    version: "0.1.59",
    date: "2026-11-17",
    highlights: [
      { icon: "gamepad", title: "Le son arrive chez l’invité", text: "En Remote Play, votre ami entend maintenant le son de votre PC (jeu, musique, vidéos), en plus de l’image. Si Windows bloque la lecture sonore, le son démarre au premier clic ou à la première touche." },
      { icon: "front", title: "Carte de partage masquable", text: "La carte Remote Play de l’hôte (code de sécurité, connexion) se masque d’un clic et laisse une petite pastille dans le coin ; un clic dessus la rouvre." },
    ],
  },
  {
    version: "0.1.58",
    date: "2026-11-17",
    highlights: [
      { icon: "gamepad", title: "Manette de l’invité connectée d’office", text: "En Remote Play, la manette de votre ami est détectée et envoyée toute seule dès qu’il la branche et appuie sur un bouton, sans rien cliquer. Son nom s’affiche en bas de l’écran." },
      { icon: "download", title: "Pilote manette installé en un clic", text: "Sur l’hôte, la manette de l’invité a besoin du pilote ViGEmBus. S’il manque, iBox propose de l’installer (Windows demande votre accord) et la manette se branche aussitôt, sans relancer la session. Aussi dans Paramètres › Remote Play." },
      { icon: "front", title: "Bandeau de partage réductible", text: "Le bandeau « Partage en cours avec » se réduit en une petite pastille dans le coin de l’écran ; un clic dessus le rouvre." },
    ],
  },
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
