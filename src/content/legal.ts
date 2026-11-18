/**
 * Mentions légales, confidentialité et licences d'iBox. Une seule source :
 * affichée dans Paramètres › Système › À propos et reprise par le site
 * (`node scripts/build-site-legal.mjs` : site/confidentialite.html et site/privacy.html).
 * Chaque phrase doit décrire ce que fait réellement le code (durées : serveur iNetbox).
 */
export interface LegalSection {
  id: "privacy" | "sources" | "software" | "brands";
  title: string;
  blocks: { heading?: string; items: string[] }[];
}

export const LEGAL: LegalSection[] = [
  {
    id: "privacy",
    title: "Confidentialité",
    blocks: [
      {
        heading: "Ce qui reste sur votre PC",
        items: [
          "Votre bibliothèque (jeux, dossiers, temps de jeu, collections, favoris), vos réglages, vos profils, vos captures et vos clips sont enregistrés uniquement sur ce PC.",
          "Les clés API (Steam, SteamGridDB, RetroAchievements, GIPHY) et la session iNetbox sont rangées dans le coffre d'identifiants de Windows, jamais en clair.",
          "Vos jeux ne sont jamais envoyés nulle part, ni déplacés, ni modifiés. Les sauvegardes de jeu ne sont que copiées, sur ce PC, quand vous le demandez.",
          "Le rapport de problème et le journal des incidents sont créés sur ce PC ; c'est vous qui choisissez de les partager. iBox n'envoie aucune statistique d'utilisation.",
        ],
      },
      {
        heading: "iNetbox (facultatif)",
        items: [
          "Si vous créez un compte, le serveur iNetbox conserve : votre identifiant, votre adresse e-mail, votre nom affiché, votre mot de passe sous forme d'empreinte irréversible (jamais lisible), votre code ami, vos amis, vos blocages, vos choix de confidentialité et les éléments de profil que vous choisissez d'afficher.",
          "Votre statut en ligne et le jeu en cours ne sont partagés que si vous l'avez activé, avec vos amis seulement : le statut disparaît après 90 secondes sans nouvelles, l'historique des jeux lancés après 7 jours.",
          "Si vous partagez votre bibliothèque, la liste de vos jeux est envoyée pour montrer à vos amis vos jeux en commun ; désactiver ce partage l'efface du serveur.",
          "Les messages privés et de groupe sont conservés 90 jours, puis effacés. Une invitation à jouer contient le titre du jeu et sa console ; elle est supprimée après 30 minutes.",
          "Communauté : les images que vous partagez (8 Mo au plus) sont visibles par vos amis, ou par tous si votre profil est public. Seules vos 12 dernières sont gardées, avec leurs réactions et réponses ; vous pouvez les supprimer à tout moment.",
          "Remote Play : iNetbox ne fait que mettre les deux PC en relation (session effacée après 15 minutes d'inactivité) et garde la clé publique de vos appareils. L'image, le son et les commandes passent directement de PC à PC, chiffrés, sans passer par le serveur.",
          "Le serveur est hébergé par Render et la base de données par Neon. Supprimer votre compte (iNetbox › Mon compte) efface toutes ces données.",
        ],
      },
      {
        heading: "Services contactés",
        items: [
          "Pour les jaquettes et les informations : libretro-thumbnails et libretro-database (GitHub), GameTDB, LaunchBox Games Database, SteamGridDB (avec votre clé) et iiDB. Seuls le nom ou l'identifiant d'un jeu sont transmis.",
          "Pour les manuels : ScreenScraper, Internet Archive et Steam. Seuls le nom ou l'identifiant d'un jeu sont transmis.",
          "Pour les succès : RetroAchievements (avec votre nom d'utilisateur et votre clé) et l'API Web de Steam.",
          "Pour vos jeux PC : l'API Web de Steam, avec votre clé et votre identifiant Steam, si vous l'avez configurée.",
          "iBox Platforms : les émulateurs sont téléchargés, à votre demande, depuis leurs sources officielles (GitHub ou le site de l'émulateur). Pour Remote Play, le pilote de manettes virtuelles ViGEmBus vient de GitHub, avec votre accord.",
          "SmartConfig : EmuReady reçoit le titre du jeu pour trouver des réglages partagés par la communauté.",
          "Remote Play : des serveurs STUN publics (Cloudflare, Google) aident les deux PC à se trouver ; ils voient votre adresse IP, comme tout site web.",
          "Images de décoration et d'avatar : SteamGridDB, GIPHY (avec votre clé, seul le mot recherché est transmis), Pokémon Showdown, GitHub et Riot Games (Data Dragon). Seules des images sont téléchargées.",
          "Les mises à jour d'iBox sont vérifiées sur GitHub (atzski/ibox) ; aucune donnée personnelle n'est envoyée.",
        ],
      },
    ],
  },
  {
    id: "sources",
    title: "Sources des données",
    blocks: [
      {
        items: [
          "libretro-database — informations des jeux, licence CC BY-SA 4.0.",
          "libretro-thumbnails — jaquettes, écrans-titres et logos.",
          "GameTDB — titres, synopsis et scans de jaquettes (GameCube, Wii, DS, 3DS, Switch).",
          "LaunchBox Games Database — images de boîtes (face, dos, tranche).",
          "SteamGridDB — jaquettes, fonds et logos de la communauté.",
          "iiDB (iisu.network) — illustrations des consoles et des jeux, CC BY-SA 4.0.",
          "GIPHY — stickers animés des décorations de l'accueil.",
          "ScreenScraper et Internet Archive — manuels des jeux.",
          "RetroAchievements — succès et badges.",
          "EmuReady — réglages d'émulateurs partagés par la communauté (SmartConfig).",
          "Les illustrations et les manuels restent la propriété de leurs auteurs et des éditeurs des jeux.",
        ],
      },
    ],
  },
  {
    id: "software",
    title: "Logiciels libres",
    blocks: [
      {
        heading: "Application",
        items: [
          "Tauri — MIT / Apache 2.0",
          "React, React DOM — MIT",
          "three.js, React Three Fiber, Drei — MIT",
          "Motion — MIT",
          "Zustand — MIT",
          "PDF.js — Apache 2.0",
          "SQLite (domaine public), rusqlite — MIT",
          "reqwest, serde, zip, walkdir — MIT / Apache 2.0",
          "str0m (Remote Play) — MIT / Apache 2.0",
          "opus-rs (son de Remote Play) — BSD 3-Clause",
          "ed25519-dalek — BSD 3-Clause",
          "vigem-client — MIT ; pilote ViGEmBus — BSD 3-Clause",
          "sevenz-rust2 — Apache 2.0",
          "Polices Nunito, Fredoka et Cal Sans — SIL Open Font License 1.1",
        ],
      },
      {
        heading: "Serveur iNetbox",
        items: ["Fastify — MIT", "node-postgres, PGlite — MIT / Apache 2.0", "Zod — MIT"],
      },
      {
        heading: "Version Steam Deck (Linux)",
        items: [
          "FFmpeg 4.4.2 (décodage H.264 de Remote Play) — LGPL 2.1 ou ultérieure, compilé sans composant GPL ni nonfree, en bibliothèques partagées (liaison dynamique), source officielle non modifiée. Textes, options de compilation et source exacte : /usr/share/licenses/ibox dans l'AppImage.",
          "GStreamer et ses greffons — LGPL 2.1 ou ultérieure ; les greffons sous GPL ne sont pas livrés.",
          "WebKitGTK — LGPL 2 et BSD ; GTK, GLib, libsoup — LGPL.",
          "Le format H.264 est couvert par des brevets, distincts des licences logicielles : voir H264-PATENTS.md dans l'AppImage. Le décodage matériel du Steam Deck (VA-API) est utilisé en priorité.",
          "La version Windows n'embarque ni FFmpeg ni GStreamer.",
        ],
      },
      {
        heading: "Modèles 3D et musique",
        items: [
          "Boîtiers modélisés pour iBox dans Blender ; outils de modélisation dérivés de blender-modeler — MIT.",
          "Musique de menu composée pour iBox.",
        ],
      },
    ],
  },
  {
    id: "brands",
    title: "Marques et émulation",
    blocks: [
      {
        items: [
          "iBox n'est affilié à aucun fabricant de consoles ni éditeur de jeux. Nintendo, Switch, GameCube, Wii, DS, 3DS, PlayStation, PSP, Xbox, Steam, Epic Games et les autres noms cités sont des marques de leurs détenteurs respectifs.",
          "iBox ne fournit, ne télécharge et ne partage aucun jeu, BIOS, firmware ni clé. Les émulateurs proposés par iBox Platforms sont téléchargés, à votre demande, depuis leurs sources officielles. Utilisez uniquement des copies de jeux que vous possédez légalement, conformément à la loi de votre pays.",
          "iBox ne contourne aucune protection (DRM) : les jeux PC sont lancés par leurs boutiques.",
        ],
      },
    ],
  },
];
