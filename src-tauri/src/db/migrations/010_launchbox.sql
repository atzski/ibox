-- Jaquettes complètes (dos, tranche, face) : base publique LaunchBox Games Database.

-- Dernière recherche de jaquette complète pour un jeu (relancée au plus tous les 30 jours).
ALTER TABLE games ADD COLUMN jacket_checked_at TEXT;

-- Jeux LaunchBox des consoles prises en charge (nom et clé de comparaison).
CREATE TABLE ref_launchbox (
  db_id        INTEGER PRIMARY KEY,
  platform_id  TEXT NOT NULL,
  name         TEXT NOT NULL,
  title_key    TEXT NOT NULL
);
CREATE INDEX ref_launchbox_key ON ref_launchbox (platform_id, title_key);

-- Images de boîte de ces jeux (fichiers sur images.launchbox-app.com).
CREATE TABLE ref_launchbox_images (
  db_id   INTEGER NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('front', 'back', 'spine', 'full')),
  region  TEXT,
  file    TEXT NOT NULL
);
CREATE INDEX ref_launchbox_images_game ON ref_launchbox_images (db_id);
