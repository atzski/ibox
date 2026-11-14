-- iBox — schéma v2 (phase 3) : médias, métadonnées et bases de référence.

-- Images d'un jeu, mises en cache localement (une par type et emplacement).
CREATE TABLE media (
  id          INTEGER PRIMARY KEY,
  game_id     INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('front', 'back', 'spine', 'full', 'disc', 'logo', 'title', 'screenshot')),
  slot        INTEGER NOT NULL DEFAULT 0,
  source      TEXT    NOT NULL,             -- libretro | steamgriddb | user
  source_ref  TEXT,                         -- URL ou identifiant distant (traçabilité)
  file        TEXT    NOT NULL,             -- chemin relatif au dossier « media »
  width       INTEGER,
  height      INTEGER,
  added_at    TEXT    NOT NULL,
  UNIQUE (game_id, kind, slot)
);
CREATE INDEX media_game ON media (game_id);

-- Suivi des métadonnées et de la recherche d'images.
ALTER TABLE games ADD COLUMN meta_source TEXT;       -- gametdb | libretro-db
ALTER TABLE games ADD COLUMN meta_fetched_at TEXT;
-- NULL : jamais cherché · found · ambiguous (à choisir) · none (rien trouvé)
ALTER TABLE games ADD COLUMN media_status TEXT;

-- Empreinte CRC32 des cartouches (correspondance libretro-database).
ALTER TABLE game_files ADD COLUMN crc32 TEXT;

-- Bases de référence téléchargées (consultables hors connexion).
CREATE TABLE ref_gametdb (
  serial       TEXT PRIMARY KEY,
  platform_id  TEXT NOT NULL,
  region       TEXT,
  title_fr     TEXT,
  title_en     TEXT,
  synopsis_fr  TEXT,
  synopsis_en  TEXT,
  developer    TEXT,
  publisher    TEXT,
  year         INTEGER,
  genre        TEXT,
  players      INTEGER
);

CREATE TABLE ref_libretro_meta (
  platform_id  TEXT NOT NULL,
  name         TEXT NOT NULL,                -- nom No-Intro / Redump
  name_key     TEXT NOT NULL,                -- nom normalisé
  crc          TEXT,
  developer    TEXT,
  publisher    TEXT,
  genre        TEXT,
  year         INTEGER,
  players      INTEGER,
  PRIMARY KEY (platform_id, name)
);
CREATE INDEX ref_libretro_meta_crc ON ref_libretro_meta (platform_id, crc);
CREATE INDEX ref_libretro_meta_key ON ref_libretro_meta (platform_id, name_key);

-- Index des noms d'images libretro (un par console et par type).
CREATE TABLE ref_libretro_thumbs (
  platform_id  TEXT NOT NULL,
  kind         TEXT NOT NULL,                -- front | title | screenshot | logo
  name         TEXT NOT NULL,                -- nom de fichier sans .png
  name_key     TEXT NOT NULL,
  PRIMARY KEY (platform_id, kind, name)
);
CREATE INDEX ref_libretro_thumbs_key ON ref_libretro_thumbs (platform_id, kind, name_key);

-- Date de mise à jour de chaque base (« gametdb:wii », « libretro-thumbs:gamecube:front »…).
CREATE TABLE ref_sources (
  id          TEXT PRIMARY KEY,
  fetched_at  TEXT    NOT NULL,
  items       INTEGER NOT NULL
);
