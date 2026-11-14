-- Jeux de la Famille Steam : possédés par un autre membre, partagés avec l'utilisateur.
ALTER TABLE pc_installs ADD COLUMN family INTEGER NOT NULL DEFAULT 0;
