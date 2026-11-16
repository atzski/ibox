-- Galettes des jeux (scans GameTDB et LaunchBox) : les jeux à disque déjà traités sont
-- revus une fois, et la base LaunchBox est relue pour y ajouter les images « Disc ».
UPDATE games SET jacket_checked_at = NULL
 WHERE platform_id IN ('gamecube', 'wii', 'wiiu', 'ps1', 'ps2', 'psp');
DELETE FROM ref_sources WHERE id = 'launchbox';
