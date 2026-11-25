//! Installation d'un paquet `.iboxplugin` déjà téléchargé : vérification (signature,
//! empreinte, manifeste, version d'iBox, plateforme), extraction sûre puis bascule de version.
//!
//! Un paquet est une donnée non sûre : aucun chemin en `..`, aucun lien symbolique, taille
//! et nombre de fichiers limités, et jamais d'exécution native.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use super::manifest::{self, Manifest};
use super::trust;

/// Taille maximale d'un paquet téléchargé.
pub const MAX_PACKAGE: usize = 64 * 1024 * 1024;
/// Taille maximale une fois extrait, et nombre de fichiers.
const MAX_EXTRACTED: u64 = 256 * 1024 * 1024;
const MAX_FILES: usize = 4000;

/// Ce que le catalogue annonce pour un paquet (et que la signature couvre).
#[derive(Debug, Clone)]
pub struct Expected<'a> {
    pub id: &'a str,
    pub version: &'a str,
    pub sha256: &'a str,
    pub signature: &'a str,
    pub publisher: &'a str,
}

pub fn version_dir(root: &Path, id: &str, version: &str) -> PathBuf {
    root.join(id).join(version)
}

/// Vérifie puis extrait dans `<root>/<id>/<version>/`. Rend le manifeste validé.
/// Les autres versions du plugin restent en place : la bascule se fait dans le registre.
pub fn install(root: &Path, bytes: &[u8], exp: &Expected, ibox_version: &str) -> Result<Manifest, String> {
    if bytes.len() > MAX_PACKAGE {
        return Err("Paquet trop volumineux.".into());
    }
    if !manifest::valid_id(exp.id) || manifest::parse_version(exp.version).is_none() {
        return Err("Entrée de catalogue invalide.".into());
    }
    // 1. signature et empreinte, avant même d'ouvrir l'archive
    trust::verify(bytes, exp.id, exp.version, exp.sha256, exp.signature, exp.publisher)?;

    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| "Archive du plugin illisible.")?;
    if zip.len() > MAX_FILES {
        return Err("Trop de fichiers dans le paquet.".into());
    }

    // 2. manifeste : cohérent avec ce qui a été signé, compatible avec ce PC
    let manifest = {
        let mut f = zip.by_name("manifest.json").map_err(|_| "manifest.json manquant.")?;
        let mut buf = Vec::new();
        f.by_ref().take(256 * 1024).read_to_end(&mut buf).map_err(|e| e.to_string())?;
        Manifest::parse(&buf)?
    };
    if manifest.id != exp.id || manifest.version != exp.version {
        return Err("Le manifeste ne correspond pas au paquet signé.".into());
    }
    if !manifest::ibox_satisfies(manifest.ibox.as_deref(), ibox_version) {
        return Err(format!("Ce plugin demande une version plus récente d'iBox ({}).", manifest.ibox.as_deref().unwrap_or("")));
    }
    if !manifest.platforms.is_empty() && !manifest.platforms.iter().any(|p| p == manifest::current_platform()) {
        return Err("Ce plugin n'est pas disponible sur ce système.".into());
    }

    // 3. extraction dans un dossier temporaire voisin, puis renommage
    let plugin_dir = root.join(exp.id);
    fs::create_dir_all(&plugin_dir).map_err(|e| e.to_string())?;
    let staging = plugin_dir.join(format!(".staging-{}-{}", exp.version, std::process::id()));
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let result = extract(&mut zip, &staging);
    if let Err(e) = result {
        let _ = fs::remove_dir_all(&staging);
        return Err(e);
    }
    for needed in manifest.overlay.iter().filter_map(|o| o.entry.as_ref()).chain(manifest.webview.iter().flat_map(|w| w.scripts.iter())) {
        if !staging.join(needed).is_file() {
            let _ = fs::remove_dir_all(&staging);
            return Err(format!("Fichier manquant dans le paquet : {needed}"));
        }
    }
    let target = version_dir(root, exp.id, exp.version);
    let _ = fs::remove_dir_all(&target);
    fs::rename(&staging, &target).map_err(|e| {
        let _ = fs::remove_dir_all(&staging);
        e.to_string()
    })?;
    Ok(manifest)
}

fn extract<R: Read + std::io::Seek>(zip: &mut zip::ZipArchive<R>, dest: &Path) -> Result<(), String> {
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|_| "Archive du plugin illisible.")?;
        let name = f.name().map_err(|_| "Nom de fichier illisible dans le paquet.")?.to_string();
        if f.is_symlink() {
            return Err(format!("Lien symbolique refusé : {name}"));
        }
        if f.is_dir() {
            continue;
        }
        // nom strictement relatif, sans `..` ni `\` ni lecteur
        if !manifest::safe_path(&name) {
            return Err(format!("Chemin refusé dans le paquet : {name}"));
        }
        let path = dest.join(&name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = fs::File::create(&path).map_err(|e| e.to_string())?;
        // la taille annoncée par l'archive peut mentir : on compte ce qui est réellement écrit
        let budget = MAX_EXTRACTED - total;
        let n = std::io::copy(&mut f.by_ref().take(budget + 1), &mut out).map_err(|e| e.to_string())?;
        total += n;
        if total > MAX_EXTRACTED {
            return Err("Paquet trop volumineux une fois extrait.".into());
        }
    }
    Ok(())
}

/// Supprime les versions autres que `keep` (après une mise à jour réussie).
pub fn prune(root: &Path, id: &str, keep: &str) {
    if let Ok(entries) = fs::read_dir(root.join(id)) {
        for e in entries.flatten() {
            if e.file_name().to_str() != Some(keep) {
                let _ = fs::remove_dir_all(e.path());
            }
        }
    }
}

pub fn uninstall(root: &Path, id: &str) -> Result<(), String> {
    if !manifest::valid_id(id) {
        return Err("Identifiant invalide.".into());
    }
    let dir = root.join(id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::io::Write;

    pub fn manifest_json(id: &str, version: &str) -> serde_json::Value {
        serde_json::json!({
            "id": id, "name": "Démo", "version": version, "author": { "name": "atzski" },
            "permissions": ["overlay"], "overlay": { "entry": "ui/index.html" }
        })
    }

    /// Construit un paquet zip à partir de (nom, contenu).
    pub fn zip_of(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut buf);
            for (name, data) in files {
                w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
                w.write_all(data).unwrap();
            }
            w.finish().unwrap();
        }
        buf.into_inner()
    }

    pub fn package(id: &str, version: &str) -> Vec<u8> {
        let m = manifest_json(id, version).to_string();
        zip_of(&[("manifest.json", m.as_bytes()), ("ui/index.html", b"<h1>demo</h1>"), ("icon.png", b"png")])
    }

    fn run(root: &Path, bytes: &[u8], id: &str, version: &str) -> Result<Manifest, String> {
        let (sha, sig) = trust::sign_for_tests(bytes, id, version);
        install(root, bytes, &Expected { id, version, sha256: &sha, signature: &sig, publisher: "test" }, "0.1.106")
    }

    #[test]
    fn a_signed_package_installs() {
        let dir = tempfile::tempdir().unwrap();
        let m = run(dir.path(), &package("demo", "1.0.0"), "demo", "1.0.0").unwrap();
        assert_eq!(m.id, "demo");
        assert_eq!(fs::read(dir.path().join("demo/1.0.0/ui/index.html")).unwrap(), b"<h1>demo</h1>");
        // mise à jour puis nettoyage de l'ancienne version
        run(dir.path(), &package("demo", "1.1.0"), "demo", "1.1.0").unwrap();
        prune(dir.path(), "demo", "1.1.0");
        assert!(!dir.path().join("demo/1.0.0").exists());
        uninstall(dir.path(), "demo").unwrap();
        assert!(!dir.path().join("demo").exists());
    }

    #[test]
    fn a_modified_package_is_refused_before_extraction() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = package("demo", "1.0.0");
        let (sha, sig) = trust::sign_for_tests(&bytes, "demo", "1.0.0");
        let mut tampered = bytes.clone();
        let last = tampered.len() - 30;
        tampered[last] ^= 0xFF;
        let e = install(dir.path(), &tampered, &Expected { id: "demo", version: "1.0.0", sha256: &sha, signature: &sig, publisher: "test" }, "0.1.106");
        assert!(e.is_err());
        assert!(!dir.path().join("demo").exists());
    }

    #[test]
    fn dangerous_archives_are_refused_even_when_signed() {
        let dir = tempfile::tempdir().unwrap();
        let m = manifest_json("demo", "1.0.0").to_string();
        for bad in ["../evil.txt", "ui/../../evil.txt", "C:/evil.txt", "/evil.txt", "ui\\..\\evil.txt"] {
            let z = zip_of(&[("manifest.json", m.as_bytes()), ("ui/index.html", b"x"), (bad, b"x")]);
            assert!(run(dir.path(), &z, "demo", "1.0.0").is_err(), "{bad}");
        }
        assert!(!dir.path().join("evil.txt").exists() && !dir.path().parent().unwrap().join("evil.txt").exists());
        // manifeste d'un autre plugin que celui signé
        assert!(run(dir.path(), &package("other", "1.0.0"), "demo", "1.0.0").is_err());
        // entrée de l'overlay absente
        let z = zip_of(&[("manifest.json", m.as_bytes())]);
        assert!(run(dir.path(), &z, "demo", "1.0.0").is_err());
        // iBox trop ancien
        let mut newer = manifest_json("demo", "1.0.0");
        newer["ibox"] = ">=9.0.0".into();
        let z = zip_of(&[("manifest.json", newer.to_string().as_bytes()), ("ui/index.html", b"x")]);
        assert!(run(dir.path(), &z, "demo", "1.0.0").is_err());
    }

    /// Compatibilité avec `scripts/plugin-sign.mjs` et la vraie clé atzski : paquet signé par
    /// le script, désigné par `IBOX_PLUGIN_FIXTURE` (dossier contenant `entry.json`). Ignoré sinon.
    #[test]
    fn a_package_signed_by_the_script_installs() {
        let Ok(dir) = std::env::var("IBOX_PLUGIN_FIXTURE") else { return };
        let dir = std::path::PathBuf::from(dir);
        let e: serde_json::Value = serde_json::from_slice(&fs::read(dir.join("entry.json")).unwrap()).unwrap();
        let s = |k: &str| e[k].as_str().unwrap().to_string();
        let bytes = fs::read(dir.join(s("url"))).unwrap();
        let out = tempfile::tempdir().unwrap();
        let exp = Expected { id: &s("id"), version: &s("version"), sha256: &s("sha256"), signature: &s("signature"), publisher: &s("publisher") };
        install(out.path(), &bytes, &exp, "99.0.0").unwrap();
        let tampered = fs::read(dir.join("tampered.iboxplugin")).unwrap();
        assert!(install(out.path(), &tampered, &exp, "99.0.0").is_err());
    }
}
