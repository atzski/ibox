-- iBox — schéma v4 : fonds de jeu (« hero », bannière large affichée derrière le jeu).
-- SQLite ne modifie pas une contrainte CHECK : la table des médias est recréée.

CREATE TABLE media_v4 (
  id          INTEGER PRIMARY KEY,
  game_id     INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('front', 'back', 'spine', 'full', 'disc', 'logo', 'title', 'screenshot', 'hero')),
  slot        INTEGER NOT NULL DEFAULT 0,
  source      TEXT    NOT NULL,
  source_ref  TEXT,
  file        TEXT    NOT NULL,
  width       INTEGER,
  height      INTEGER,
  added_at    TEXT    NOT NULL,
  UNIQUE (game_id, kind, slot)
);
INSERT INTO media_v4 (id, game_id, kind, slot, source, source_ref, file, width, height, added_at)
  SELECT id, game_id, kind, slot, source, source_ref, file, width, height, added_at FROM media;
DROP TABLE media;
ALTER TABLE media_v4 RENAME TO media;
CREATE INDEX media_game ON media (game_id);
