-- iBox — schéma v1 (phase 2)
-- Principe : la base ne référence QUE des chemins. Aucun fichier de jeu n'est
-- jamais déplacé, modifié ou supprimé par l'application.

-- Dossiers surveillés, éventuellement associés à une console.
CREATE TABLE folders (
  id            INTEGER PRIMARY KEY,
  path          TEXT    NOT NULL UNIQUE,
  platform_id   TEXT,                       -- NULL = détection automatique
  recursive     INTEGER NOT NULL DEFAULT 1,
  enabled       INTEGER NOT NULL DEFAULT 1,
  added_at      TEXT    NOT NULL,
  last_scan_at  TEXT
);

-- Un jeu de la collection (peut regrouper plusieurs fichiers : cue/bin, disques).
CREATE TABLE games (
  id              INTEGER PRIMARY KEY,
  platform_id     TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  sort_title      TEXT    NOT NULL,
  serial          TEXT,                     -- identifiant interne (ex. GALE01, NTR-ADME)
  region          TEXT,                     -- PAL | NTSC-U | NTSC-J | NULL
  year            INTEGER,
  publisher       TEXT,
  developer       TEXT,
  genre           TEXT,
  players         TEXT,
  description     TEXT,
  favorite        INTEGER NOT NULL DEFAULT 0,
  added_at        TEXT    NOT NULL,
  last_played_at  TEXT,
  play_count      INTEGER NOT NULL DEFAULT 0,
  -- Comment le jeu a été reconnu, et avec quelle certitude (0..1).
  id_method       TEXT    NOT NULL CHECK (id_method IN ('header', 'folder', 'filename', 'database', 'manual')),
  id_confidence   REAL    NOT NULL,
  -- Candidats alternatifs (JSON) quand l'identification est ambiguë.
  id_alternatives TEXT,
  -- Corrigé à la main : le scan ne doit plus écraser ces champs.
  user_locked     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX games_platform ON games (platform_id, sort_title);
CREATE INDEX games_serial   ON games (platform_id, serial);

-- Fichiers physiques. Le chemin d'origine est conservé tel quel.
CREATE TABLE game_files (
  id            INTEGER PRIMARY KEY,
  game_id       INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  folder_id     INTEGER REFERENCES folders (id) ON DELETE SET NULL,
  path          TEXT    NOT NULL UNIQUE,
  size          INTEGER NOT NULL,
  modified_at   INTEGER,                    -- secondes Unix
  fingerprint   TEXT,                       -- taille + xxh3 début/fin : détecte doublons et déplacements
  role          TEXT    NOT NULL DEFAULT 'main' CHECK (role IN ('main', 'track', 'disc', 'playlist')),
  disc_number   INTEGER,
  status        TEXT    NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'missing')),
  last_seen_at  TEXT    NOT NULL
);

CREATE INDEX game_files_game        ON game_files (game_id);
CREATE INDEX game_files_fingerprint ON game_files (fingerprint);

-- Réglages applicatifs (migrés depuis le stockage local du WebView).
CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL                      -- JSON
);

-- Historique des scans (affiché dans « Actualiser la collection »).
CREATE TABLE scan_runs (
  id           INTEGER PRIMARY KEY,
  started_at   TEXT    NOT NULL,
  finished_at  TEXT,
  added        INTEGER NOT NULL DEFAULT 0,
  updated      INTEGER NOT NULL DEFAULT 0,
  moved        INTEGER NOT NULL DEFAULT 0,
  missing      INTEGER NOT NULL DEFAULT 0,
  duplicates   INTEGER NOT NULL DEFAULT 0,
  errors       TEXT                         -- JSON
);
