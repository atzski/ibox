-- Collections personnelles (« À finir », « Coop »…) : un jeu peut être dans plusieurs.
CREATE TABLE collections (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  color       TEXT    NOT NULL DEFAULT '#8CCDF1',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL
);

CREATE TABLE collection_games (
  collection_id  INTEGER NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  game_id        INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  added_at       TEXT    NOT NULL,
  PRIMARY KEY (collection_id, game_id)
);
CREATE INDEX collection_games_game ON collection_games (game_id);
