-- Versions d'un même jeu (régions, révisions, doublons) : la fiche secondaire pointe
-- vers la fiche principale et n'apparaît plus seule dans la bibliothèque.
-- Chaque version garde son fichier, ses parties et son temps de jeu ; on peut séparer à tout moment.
ALTER TABLE games ADD COLUMN variant_of INTEGER REFERENCES games (id) ON DELETE SET NULL;
CREATE INDEX games_variant_of ON games (variant_of);
