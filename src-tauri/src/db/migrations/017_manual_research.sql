-- iBox — schéma v17 : recherche des manuels élargie (0.1.87).
-- Les jeux restés sans manuel sont recherchés à nouveau avec les nouvelles règles.
DELETE FROM manual_lookups WHERE outcome IN ('none', 'error');
