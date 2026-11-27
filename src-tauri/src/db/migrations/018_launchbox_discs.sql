-- Galettes LaunchBox : la migration 013 a ajouté les images « Disc » (type `disc`), mais la
-- contrainte de 010 n'acceptait que front, back, spine et full. Toute relecture de la base
-- LaunchBox échouait (« CHECK constraint failed ») : plus de jaquettes complètes ni de galettes
-- LaunchBox. La table (un cache) est recréée et la base sera relue au prochain passage.
DROP TABLE ref_launchbox_images;
CREATE TABLE ref_launchbox_images (
  db_id   INTEGER NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('front', 'back', 'spine', 'full', 'disc')),
  region  TEXT,
  file    TEXT NOT NULL
);
CREATE INDEX ref_launchbox_images_game ON ref_launchbox_images (db_id);
DELETE FROM ref_sources WHERE id = 'launchbox';
