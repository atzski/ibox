-- iBox Platforms : provenance des émulateurs (installé et géré par iBox, détecté
-- sur Windows, ajouté à la main), paquet du catalogue et version installée.
ALTER TABLE emulators ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE emulators ADD COLUMN package_id TEXT;
ALTER TABLE emulators ADD COLUMN version TEXT;
