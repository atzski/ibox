-- iBox — schéma v5 : plateforme PC (une seule collection, plusieurs sources).
--
-- Un jeu PC est une ligne de `games` (platform_id = 'pc') ; chaque installation
-- ou version connue (Steam, GOG, ajout manuel…) est une ligne de `pc_installs`.
-- Un même jeu présent sur deux boutiques a donc une fiche et deux installations.

CREATE TABLE pc_installs (
  id            INTEGER PRIMARY KEY,
  game_id       INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  source        TEXT    NOT NULL,           -- manual | steam | epic | gog | ubisoft | ea | xbox | battlenet | rockstar | itch
  external_id   TEXT    NOT NULL,           -- identifiant chez la source (ajout manuel : chemin de l'exécutable)
  launch_kind   TEXT    NOT NULL CHECK (launch_kind IN ('exe', 'protocol', 'none')),
  launch_target TEXT,                       -- exécutable, ou adresse de lancement officielle de la boutique
  args          TEXT    NOT NULL DEFAULT '[]', -- JSON : arguments (liste, jamais une ligne de commande)
  install_dir   TEXT,
  installed     INTEGER NOT NULL DEFAULT 1,
  preferred     INTEGER NOT NULL DEFAULT 0, -- version lancée par « Jouer »
  added_at      TEXT    NOT NULL,
  last_seen_at  TEXT    NOT NULL,
  UNIQUE (source, external_id)
);
CREATE INDEX pc_installs_game ON pc_installs (game_id);
