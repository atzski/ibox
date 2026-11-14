/**
 * Mentions légales, confidentialité et licences d'iBox. Une seule source :
 * affichée dans Paramètres › Système › À propos et reprise par le site.
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
          "Votre bibliothèque (jeux, dossiers, temps de jeu, collections, favoris), vos réglages et vos profils sont enregistrés uniquement sur ce PC.",
          "Les clés API (Steam, SteamGridDB) et la session iNetbox sont rangées dans le coffre d'identifiants de Windows, jamais en clair.",
          "Vos jeux ne sont jamais envoyés nulle part, ni déplacés, ni modifiés. Les sauvegardes de jeu ne sont que copiées, sur ce PC, quand vous le demandez.",
          "Le rapport de problème est créé sur ce PC ; c'est vous qui choisissez de le partager. iBox n'envoie aucune statistique d'utilisation.",
        ],
      },
      {
        heading: "iNetbox (facultatif)",
        items: [
          "Si vous créez un compte, le serveur iNetbox conserve : votre identifiant, votre nom affiché, votre mot de passe sous forme chiffrée (jamais lisible), votre code ami, vos amis, vos blocages et vos choix de confidentialité.",
          "Votre statut en ligne et le jeu en cours ne sont partagés que si vous l'avez activé, avec vos amis seulement, et ne sont pas archivés : ils disparaissent après 90 secondes sans nouvelles.",
          "Une invitation à jouer contient le titre du jeu et sa console ; elle est supprimée après 30 minutes.",
          "Le serveur est hébergé par Render et la base de données par Neon. Supprimer votre compte (iNetbox › Mon compte) efface toutes ces données.",
        ],
      },
      {
        heading: "Services contactés",
        items: [
          "Pour les jaquettes et les informations : libretro-thumbnails et libretro-database (GitHub), GameTDB, LaunchBox Games Database, SteamGridDB (avec votre clé) et iiDB. Seuls le nom ou l'identifiant d'un jeu sont transmis.",
          "Pour vos jeux PC : l'API Web de Steam, avec votre clé et votre identifiant Steam, si vous l'avez configurée.",
          "Les mises à jour d'iBox sont vérifiées sur l'adresse de publication d'iBox ; aucune donnée personnelle n'est envoyée.",
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
          "Les illustrations restent la propriété de leurs auteurs et des éditeurs des jeux.",
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
          "SQLite (domaine public), rusqlite — MIT",
          "reqwest, serde, zip, walkdir — MIT / Apache 2.0",
          "Polices Nunito et Fredoka — SIL Open Font License 1.1",
        ],
      },
      {
        heading: "Serveur iNetbox",
        items: ["Fastify — MIT", "node-postgres, PGlite — MIT / Apache 2.0", "Zod — MIT"],
      },
      {
        heading: "Modèles 3D",
        items: ["Boîtiers modélisés pour iBox dans Blender ; outils de modélisation dérivés de blender-modeler — MIT."],
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
          "iBox ne fournit, ne télécharge et ne partage aucun jeu, BIOS, firmware ni émulateur. Utilisez uniquement des copies de jeux que vous possédez légalement, conformément à la loi de votre pays.",
          "iBox ne contourne aucune protection (DRM) : les jeux PC sont lancés par leurs boutiques.",
        ],
      },
    ],
  },
];
