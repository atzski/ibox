-- iBox Asset Manager : illustrations des consoles (iiDB et fichiers de l'utilisateur).

-- Correspondance console iBox ↔ plateforme iiDB (identifiants distincts, jamais confondus).
CREATE TABLE platform_links (
  platform_id       TEXT PRIMARY KEY,               -- identifiant iBox (gamecube, ps2, pc…)
  provider          TEXT NOT NULL DEFAULT 'iidb',
  status            TEXT NOT NULL CHECK (status IN ('matched', 'needs_choice', 'not_found', 'manual')),
  remote_id         INTEGER,                        -- identifiant de plateforme iiDB
  remote_name       TEXT,
  candidates        TEXT,                           -- JSON [{id, name}] quand un choix est nécessaire
  resolved_at       TEXT NOT NULL
);

-- Illustration retenue pour chaque emplacement d'une console.
CREATE TABLE platform_assets (
  platform_id   TEXT NOT NULL,
  slot          TEXT NOT NULL CHECK (slot IN ('platform_icon', 'platform_logo', 'platform_hero', 'platform_border')),
  provider      TEXT NOT NULL,                      -- iidb | user
  asset_id      INTEGER,                            -- identifiant d'asset iiDB
  revision      TEXT,
  source_url    TEXT,
  file          TEXT NOT NULL,                      -- chemin relatif au dossier « media »
  width         INTEGER,
  height        INTEGER,
  format        TEXT,
  region        TEXT,
  -- auto : recommandé (remplaçable par une synchronisation) ; manual : choisi dans une galerie ; user : fichier importé
  choice        TEXT NOT NULL DEFAULT 'auto' CHECK (choice IN ('auto', 'manual', 'user')),
  added_at      TEXT NOT NULL,
  PRIMARY KEY (platform_id, slot)
);
