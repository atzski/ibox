-- iBox — schéma v6 : synchronisation des boutiques PC.
-- `hidden` : masqué par l'utilisateur (outil, logiciel…) ; la synchronisation le respecte.
-- `playtime_minutes` : temps de jeu enregistré par la boutique elle-même (Steam…).

ALTER TABLE pc_installs ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pc_installs ADD COLUMN playtime_minutes INTEGER;
