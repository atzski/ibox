-- iBox SmartConfig (schéma v15) : migration purement additive.

-- Journal des optimisations : chaque application de profil, réversible.
CREATE TABLE sc_applications (
  id                INTEGER PRIMARY KEY,
  game_id           INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  adapter           TEXT    NOT NULL,             -- dolphin | pcsx2 | …
  emulator_version  TEXT,
  target            TEXT    NOT NULL,             -- fichier de réglages par jeu modifié
  source            TEXT    NOT NULL,             -- emuready | community | verified | manual
  source_ref        TEXT    NOT NULL,             -- identifiant du profil chez la source
  mode              TEXT,                         -- performance | balanced | quality
  profile           TEXT    NOT NULL,             -- JSON : profil normalisé appliqué
  changes           TEXT    NOT NULL,             -- JSON : liste exacte (clé, avant, après)
  before_sha        TEXT,                         -- NULL = fichier absent avant
  after_sha         TEXT    NOT NULL,
  backup_file       TEXT,                         -- copie de l'état précédent
  status            TEXT    NOT NULL CHECK (status IN ('pending', 'applied', 'failed', 'restored', 'conflict')),
  created_at        TEXT    NOT NULL,
  restored_at       TEXT
);
CREATE INDEX sc_applications_game   ON sc_applications (game_id, id);
CREATE INDEX sc_applications_target ON sc_applications (target, status);

-- Cache des fournisseurs : données déjà normalisées et nettoyées (jamais la
-- réponse brute, qui peut contenir des informations sur les contributeurs).
CREATE TABLE sc_cache (
  key         TEXT    PRIMARY KEY,                -- fournisseur:opération:paramètres
  body        TEXT    NOT NULL,
  fetched_at  INTEGER NOT NULL,                   -- secondes Unix
  expires_at  INTEGER NOT NULL
);
CREATE INDEX sc_cache_expiry ON sc_cache (expires_at);

-- Retours d'expérience locaux après une session (jamais envoyés sans action explicite).
CREATE TABLE sc_feedback (
  id              INTEGER PRIMARY KEY,
  application_id  INTEGER REFERENCES sc_applications (id) ON DELETE SET NULL,
  game_id         INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  worked          INTEGER,                        -- 1 / 0 / NULL (sans réponse)
  performance_ok  INTEGER,
  graphics_issues INTEGER,
  created_at      TEXT    NOT NULL
);
CREATE INDEX sc_feedback_game ON sc_feedback (game_id, created_at);
