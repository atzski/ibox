-- iBox — schéma v3 (phase 4) : émulateurs, associations et historique de jeu.

-- Émulateurs installés par l'utilisateur (jamais téléchargés par iBox).
CREATE TABLE emulators (
  id          INTEGER PRIMARY KEY,
  profile_id  TEXT    NOT NULL,             -- dolphin | melonds | pcsx2 | … | custom
  name        TEXT    NOT NULL,
  exe_path    TEXT    NOT NULL UNIQUE,
  args        TEXT    NOT NULL,             -- JSON : modèle d'arguments (« {rom} », « {fullscreen} », « {core} »)
  fullscreen  INTEGER NOT NULL DEFAULT 1,
  cores       TEXT,                         -- JSON : console → cœur libretro (RetroArch)
  added_at    TEXT    NOT NULL
);

-- Émulateur par défaut de chaque console.
CREATE TABLE platform_emulators (
  platform_id  TEXT    PRIMARY KEY,
  emulator_id  INTEGER NOT NULL REFERENCES emulators (id) ON DELETE CASCADE
);

-- Émulateur choisi pour un jeu précis (sinon celui de sa console).
ALTER TABLE games ADD COLUMN emulator_id INTEGER REFERENCES emulators (id) ON DELETE SET NULL;
ALTER TABLE games ADD COLUMN play_seconds INTEGER NOT NULL DEFAULT 0;

-- Sessions de jeu (durée, code de sortie, erreur éventuelle).
CREATE TABLE play_sessions (
  id           INTEGER PRIMARY KEY,
  game_id      INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  emulator_id  INTEGER REFERENCES emulators (id) ON DELETE SET NULL,
  started_at   TEXT    NOT NULL,
  ended_at     TEXT,
  seconds      INTEGER,
  exit_code    INTEGER,
  error        TEXT
);
CREATE INDEX play_sessions_game ON play_sessions (game_id, started_at);
