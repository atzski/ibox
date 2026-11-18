-- iBox — schéma v16 : manuels de jeu (carnets feuilletables). Migration additive.

-- Un manuel par jeu : PDF rangé dans `manuals/` (dossier des données d'iBox).
CREATE TABLE game_manuals (
  game_id     INTEGER PRIMARY KEY REFERENCES games (id) ON DELETE CASCADE,
  source      TEXT    NOT NULL,             -- user | steam | screenscraper | archive
  source_ref  TEXT,                         -- identifiant chez la source (jamais d'identifiants de connexion)
  region      TEXT,                         -- fr | eu | us | jp | wor… (NULL : inconnue)
  file        TEXT    NOT NULL,             -- nom du fichier dans manuals/
  size        INTEGER NOT NULL,
  pages       INTEGER,                      -- renseigné par le lecteur au premier affichage
  added_at    TEXT    NOT NULL
);

-- Dernière recherche automatique : évite de réinterroger les sources à chaque ouverture.
CREATE TABLE manual_lookups (
  game_id     INTEGER PRIMARY KEY REFERENCES games (id) ON DELETE CASCADE,
  outcome     TEXT    NOT NULL CHECK (outcome IN ('found', 'none', 'error', 'dismissed')),
  checked_at  TEXT    NOT NULL
);
