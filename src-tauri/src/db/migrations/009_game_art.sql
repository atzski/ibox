-- iBox Asset Manager : illustrations des jeux depuis iiDB.

-- Image choisie à la main (sélecteur, import, lien) : jamais remplacée automatiquement.
ALTER TABLE media ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
UPDATE media SET pinned = 1 WHERE source = 'user';

-- Correspondance jeu iBox ↔ « parent » iiDB (groupe de versions partageant leurs illustrations).
CREATE TABLE game_links (
  game_id      INTEGER PRIMARY KEY REFERENCES games (id) ON DELETE CASCADE,
  status       TEXT    NOT NULL CHECK (status IN ('matched', 'needs_choice', 'not_found', 'manual')),
  parent_id    INTEGER,
  parent_name  TEXT,
  candidates   TEXT,                 -- JSON [{id, name, year, platform}] quand un choix est nécessaire
  resolved_at  TEXT    NOT NULL
);

-- Identifiant de console iiDB (préférence d'illustrations pour les jeux de cette console).
ALTER TABLE platform_links ADD COLUMN console_id TEXT;
