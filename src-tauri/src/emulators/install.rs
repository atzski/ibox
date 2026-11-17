//! Installation transactionnelle d'un émulateur dans le dossier géré par iBox :
//! téléchargement → extraction isolée (`_staging`) → validation de l'exécutable →
//! activation par renommage. Une version précédente est conservée dans
//! `_backups` (restaurable) et les fichiers créés par l'utilisateur (réglages,
//! sauvegardes rangées à côté du programme) sont reportés dans la nouvelle.
//!
//! Disposition : `<racine>\<Émulateur>\` (+ `ibox-install.json`), `<racine>\_downloads`,
//! `<racine>\_staging`, `<racine>\_backups`.

use super::archive;
use super::catalog::{Package, Source};
use super::download::{self, DownloadError, Resolved};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use walkdir::WalkDir;

pub const MANIFEST: &str = "ibox-install.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub package_id: String,
    pub version: String,
    pub source_url: String,
    pub sha256: String,
    /// Empreinte comparée à celle publiée par la source officielle.
    pub verified: bool,
    pub installed_at: String,
    /// Exécutable, relatif au dossier d'installation (vide pour un cœur libretro).
    pub exe: String,
    /// Entrées de premier niveau livrées par l'archive (le reste appartient à l'utilisateur).
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub package_id: String,
    pub dir: String,
    pub exe: String,
    pub version: String,
    pub verified: bool,
    pub installed_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub package_id: String,
    pub dir: String,
    pub version: String,
    pub uninstalled: bool,
    pub bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Resolving,
    Downloading,
    Verifying,
    Extracting,
    Installing,
}

pub enum Step {
    Stage(Stage),
    Bytes { received: u64, total: Option<u64>, speed: u64 },
    Version(String),
}

#[derive(Debug, PartialEq)]
pub enum InstallError {
    Cancelled,
    Failed(String),
}

impl From<String> for InstallError {
    fn from(s: String) -> Self {
        InstallError::Failed(s)
    }
}

pub fn default_root() -> PathBuf {
    let home = std::env::var("USERPROFILE").map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
    home.join("iBox").join("Emulators")
}

/// Nom de dossier lisible et sûr (« Rosalie's Mupen GUI » → « Rosalie's Mupen GUI »).
pub fn folder_name(pkg: &Package) -> String {
    pkg.name.chars().filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '\'')).collect::<String>().trim().to_string()
}

fn read_manifest(dir: &Path) -> Option<Manifest> {
    serde_json::from_slice(&fs::read(dir.join(MANIFEST)).ok()?).ok()
}

fn write_manifest(dir: &Path, m: &Manifest) -> Result<(), String> {
    fs::write(dir.join(MANIFEST), serde_json::to_vec_pretty(m).unwrap_or_default()).map_err(|e| download::disk_message(&e))
}

/// Installations gérées présentes sous la racine (dossiers portant un manifeste).
pub fn installed(root: &Path) -> Vec<Installed> {
    let Ok(rd) = fs::read_dir(root) else { return Vec::new() };
    let mut out: Vec<Installed> = rd
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()) && !e.file_name().to_string_lossy().starts_with('_'))
        .filter_map(|e| {
            let m = read_manifest(&e.path())?;
            Some(Installed {
                dir: e.path().to_string_lossy().to_string(),
                exe: if m.exe.is_empty() { String::new() } else { e.path().join(&m.exe).to_string_lossy().to_string() },
                package_id: m.package_id,
                version: m.version,
                verified: m.verified,
                installed_at: m.installed_at,
            })
        })
        .collect();
    out.extend(installed_cores(root));
    out
}

/// Cœurs libretro installés par iBox dans le RetroArch géré (manifeste `cores\<cœur>.ibox.json`).
fn installed_cores(root: &Path) -> Vec<Installed> {
    let Some(ra) = installed_dir(root, "retroarch") else { return Vec::new() };
    let Ok(rd) = fs::read_dir(ra.join("cores")) else { return Vec::new() };
    rd.flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".ibox.json"))
        .filter_map(|e| {
            let m: Manifest = serde_json::from_slice(&fs::read(e.path()).ok()?).ok()?;
            let dll = ra.join("cores").join(&m.exe);
            dll.is_file().then(|| Installed {
                package_id: m.package_id,
                dir: ra.join("cores").to_string_lossy().to_string(),
                exe: dll.to_string_lossy().to_string(),
                version: m.version,
                verified: m.verified,
                installed_at: m.installed_at,
            })
        })
        .collect()
}

pub fn installed_dir(root: &Path, package_id: &str) -> Option<PathBuf> {
    fs::read_dir(root).ok()?.flatten().map(|e| e.path()).find(|p| {
        !p.file_name().is_some_and(|n| n.to_string_lossy().starts_with('_')) && read_manifest(p).is_some_and(|m| m.package_id == package_id)
    })
}

pub fn backups(root: &Path) -> Vec<Backup> {
    let Ok(rd) = fs::read_dir(root.join("_backups")) else { return Vec::new() };
    let mut out: Vec<Backup> = rd
        .flatten()
        .filter_map(|e| {
            let m = read_manifest(&e.path())?;
            let bytes = WalkDir::new(e.path()).into_iter().flatten().filter_map(|f| f.metadata().ok()).filter(|m| m.is_file()).map(|m| m.len()).sum();
            Some(Backup {
                package_id: m.package_id,
                dir: e.path().to_string_lossy().to_string(),
                version: m.version,
                uninstalled: e.file_name().to_string_lossy().contains("-desinstalle-"),
                bytes,
            })
        })
        .collect();
    out.sort_by(|a, b| b.dir.cmp(&a.dir));
    out
}

fn stamp() -> String {
    let s = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format!("{s}")
}

/// Un programme de ce dossier est-il en cours d'exécution ?
pub fn running_inside(dir: &Path) -> bool {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet));
    let dir = dir.to_string_lossy().to_lowercase();
    sys.processes().values().any(|p| p.exe().is_some_and(|e| e.to_string_lossy().to_lowercase().starts_with(&dir)))
}

/// Dossier racine du contenu extrait : un dossier unique au premier niveau est « déplié ».
fn content_root(staging: &Path) -> PathBuf {
    let entries: Vec<_> = fs::read_dir(staging).map(|rd| rd.flatten().collect()).unwrap_or_default();
    if entries.len() == 1 && entries[0].file_type().is_ok_and(|t| t.is_dir()) {
        content_root(&entries[0].path())
    } else {
        staging.to_path_buf()
    }
}

/// Exécutable principal : nom attendu (sans casse), à trois niveaux au plus, vrai programme Windows.
pub fn find_exe(dir: &Path, names: &[&str]) -> Option<PathBuf> {
    let mut found: Vec<PathBuf> = WalkDir::new(dir)
        .max_depth(3)
        .follow_links(false)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .filter(|e| names.iter().any(|n| e.file_name().to_string_lossy().eq_ignore_ascii_case(n)))
        .map(|e| e.into_path())
        .collect();
    found.sort_by_key(|p| (names.iter().position(|n| p.file_name().is_some_and(|f| f.to_string_lossy().eq_ignore_ascii_case(n))), p.components().count()));
    found.into_iter().find(|p| is_pe(p))
}

fn is_pe(p: &Path) -> bool {
    use std::io::Read;
    let mut head = [0u8; 2];
    fs::File::open(p).and_then(|mut f| f.read_exact(&mut head)).is_ok() && &head == b"MZ"
}

/// Reporte les fichiers de l'utilisateur (absents de la liste du programme) de `from` vers `to`.
fn carry_user_data(from: &Path, to: &Path, program_files: &[String]) {
    let Ok(rd) = fs::read_dir(from) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name == MANIFEST || program_files.iter().any(|f| f.eq_ignore_ascii_case(&name)) || to.join(&name).exists() {
            continue;
        }
        let _ = fs::rename(e.path(), to.join(&name));
    }
}

fn top_level(dir: &Path) -> Vec<String> {
    fs::read_dir(dir).map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect()).unwrap_or_default()
}

/// Télécharge et installe (ou met à jour) un paquet. Bloquant : à appeler hors du fil principal.
pub fn install(
    http: &reqwest::blocking::Client,
    pkg: &Package,
    root: &Path,
    cancel: &AtomicBool,
    report: &mut dyn FnMut(Step),
) -> Result<Installed, InstallError> {
    if !pkg.automatic {
        return Err("cet émulateur s'installe depuis son site officiel".to_string().into());
    }
    report(Step::Stage(Stage::Resolving));
    let resolved = download::resolve(http, pkg)?;
    report(Step::Version(resolved.version.clone()));
    install_resolved(http, pkg, &resolved, root, cancel, report)
}

pub fn install_resolved(
    http: &reqwest::blocking::Client,
    pkg: &Package,
    resolved: &Resolved,
    root: &Path,
    cancel: &AtomicBool,
    report: &mut dyn FnMut(Step),
) -> Result<Installed, InstallError> {
    let core_target = match pkg.source {
        Source::LibretroCore { file } => {
            let ra = installed_dir(root, "retroarch").ok_or("installez d'abord RetroArch avec iBox".to_string())?;
            Some((ra, file))
        }
        _ => None,
    };
    for sub in ["_downloads", "_staging", "_backups"] {
        fs::create_dir_all(root.join(sub)).map_err(|e| download::disk_message(&e))?;
    }
    let archive_path = root.join("_downloads").join(archive::safe_relative(&resolved.file_name).and_then(|p| p.file_name().map(|f| f.to_owned())).ok_or("nom de fichier invalide".to_string())?);
    report(Step::Stage(Stage::Downloading));
    let digest = match download::download(http, resolved, &archive_path, pkg.max_download, cancel, |received, total, speed| report(Step::Bytes { received, total, speed })) {
        Ok(d) => d,
        Err(DownloadError::Cancelled) => return Err(InstallError::Cancelled),
        Err(DownloadError::Failed(m)) => return Err(m.into()),
    };
    report(Step::Stage(Stage::Verifying));
    let staging = root.join("_staging").join(format!("{}-{}", pkg.id, stamp()));
    let result = (|| -> Result<Installed, InstallError> {
        report(Step::Stage(Stage::Extracting));
        let mut last = 0u64;
        archive::extract(pkg.archive, &archive_path, &staging, cancel, &mut |bytes| {
            if bytes - last > 4 * 1024 * 1024 {
                last = bytes;
                report(Step::Bytes { received: bytes, total: None, speed: 0 });
            }
        })
        .map_err(|e| if e == "annulé" { InstallError::Cancelled } else { InstallError::Failed(e) })?;
        report(Step::Stage(Stage::Installing));
        let manifest_base = Manifest {
            package_id: pkg.id.into(),
            version: resolved.version.clone(),
            source_url: resolved.url.clone(),
            sha256: digest.clone(),
            verified: resolved.sha256.is_some(),
            installed_at: crate::library::now_iso(),
            exe: String::new(),
            files: Vec::new(),
        };
        if let Some((ra, file)) = &core_target {
            return activate_core(&staging, ra, file, manifest_base);
        }
        let content = content_root(&staging);
        let exe = find_exe(&content, pkg.exe).ok_or("programme de l'émulateur introuvable dans l'archive officielle".to_string())?;
        let rel_exe = exe.strip_prefix(&content).map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        for marker in pkg.markers {
            fs::write(exe.parent().unwrap_or(&content).join(marker), b"").map_err(|e| download::disk_message(&e))?;
        }
        let manifest = Manifest { exe: rel_exe.clone(), files: top_level(&content), ..manifest_base };
        write_manifest(&content, &manifest)?;
        let final_dir = activate(root, pkg, &content)?;
        Ok(Installed {
            package_id: pkg.id.into(),
            exe: final_dir.join(&rel_exe).to_string_lossy().to_string(),
            dir: final_dir.to_string_lossy().to_string(),
            version: manifest.version,
            verified: manifest.verified,
            installed_at: manifest.installed_at,
        })
    })();
    let _ = fs::remove_dir_all(&staging);
    let _ = fs::remove_file(&archive_path);
    result
}

/// Met en place le contenu validé. Une installation gérée existante passe dans `_backups` ;
/// un dossier homonyme qui n'appartient pas à iBox n'est jamais touché.
fn activate(root: &Path, pkg: &Package, content: &Path) -> Result<PathBuf, InstallError> {
    let previous = installed_dir(root, pkg.id);
    if let Some(prev) = &previous {
        if running_inside(prev) {
            return Err(format!("{} est ouvert : fermez-le puis réessayez", pkg.name).into());
        }
    }
    let mut final_dir = previous.clone().unwrap_or_else(|| root.join(folder_name(pkg)));
    if previous.is_none() && final_dir.exists() {
        final_dir = root.join(format!("{} (iBox)", folder_name(pkg)));
        if final_dir.exists() {
            return Err("un dossier du même nom existe déjà dans le dossier des émulateurs".to_string().into());
        }
    }
    let backup = previous.as_ref().map(|prev| {
        let v = read_manifest(prev).map(|m| m.version).unwrap_or_default();
        root.join("_backups").join(format!("{}-{}-{}", folder_name(pkg), sanitize(&v), stamp()))
    });
    if let (Some(prev), Some(b)) = (&previous, &backup) {
        fs::create_dir_all(root.join("_backups")).map_err(|e| download::disk_message(&e))?;
        fs::rename(prev, b).map_err(|e| format!("version précédente impossible à mettre de côté ({})", download::disk_message(&e)))?;
    }
    if let Err(e) = fs::rename(content, &final_dir) {
        // échec : la version précédente reprend sa place
        if let (Some(prev), Some(b)) = (&previous, &backup) {
            let _ = fs::rename(b, prev);
        }
        return Err(format!("activation impossible ({})", download::disk_message(&e)).into());
    }
    if let Some(b) = &backup {
        let old_files = read_manifest(b).map(|m| m.files).unwrap_or_default();
        carry_user_data(b, &final_dir, &old_files);
    }
    Ok(final_dir)
}

fn activate_core(staging: &Path, ra: &Path, file: &str, base: Manifest) -> Result<Installed, InstallError> {
    let content = content_root(staging);
    let dll = WalkDir::new(&content).max_depth(2).into_iter().flatten().find(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(file)).map(|e| e.into_path());
    let dll = dll.filter(|p| is_pe(p)).ok_or("cœur introuvable dans l'archive officielle".to_string())?;
    let cores = ra.join("cores");
    fs::create_dir_all(&cores).map_err(|e| download::disk_message(&e))?;
    let target = cores.join(file);
    if target.exists() {
        let old = cores.join(format!("{file}.ancien"));
        let _ = fs::remove_file(&old);
        fs::rename(&target, &old).map_err(|e| download::disk_message(&e))?;
    }
    fs::rename(&dll, &target).map_err(|e| download::disk_message(&e))?;
    let m = Manifest { exe: file.to_string(), files: vec![file.to_string()], ..base };
    fs::write(cores.join(format!("{file}.ibox.json")), serde_json::to_vec_pretty(&m).unwrap_or_default()).map_err(|e| download::disk_message(&e))?;
    Ok(Installed {
        package_id: m.package_id,
        dir: cores.to_string_lossy().to_string(),
        exe: target.to_string_lossy().to_string(),
        version: m.version,
        verified: m.verified,
        installed_at: m.installed_at,
    })
}

fn sanitize(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')).take(40).collect()
}

/// Désinstallation : le dossier géré part dans `_backups` (restaurable), jamais une installation externe.
pub fn uninstall(root: &Path, pkg: &Package) -> Result<PathBuf, String> {
    if let Source::LibretroCore { file } = pkg.source {
        let ra = installed_dir(root, "retroarch").ok_or("RetroArch géré par iBox introuvable")?;
        let cores = ra.join("cores");
        fs::remove_file(cores.join(format!("{file}.ibox.json"))).map_err(|e| download::disk_message(&e))?;
        let _ = fs::remove_file(cores.join(format!("{file}.ancien")));
        fs::remove_file(cores.join(file)).map_err(|e| download::disk_message(&e))?;
        return Ok(cores);
    }
    let dir = installed_dir(root, pkg.id).ok_or("cet émulateur n'a pas été installé par iBox")?;
    if running_inside(&dir) {
        return Err(format!("{} est ouvert : fermez-le puis réessayez", pkg.name));
    }
    let v = read_manifest(&dir).map(|m| m.version).unwrap_or_default();
    fs::create_dir_all(root.join("_backups")).map_err(|e| download::disk_message(&e))?;
    let target = root.join("_backups").join(format!("{}-{}-desinstalle-{}", folder_name(pkg), sanitize(&v), stamp()));
    fs::rename(&dir, &target).map_err(|e| download::disk_message(&e))?;
    Ok(target)
}

/// Remet en place la sauvegarde la plus récente (la version active part à son tour dans `_backups`).
pub fn restore(root: &Path, pkg: &Package) -> Result<Installed, String> {
    let b = backups(root).into_iter().find(|b| b.package_id == pkg.id).ok_or("aucune version précédente conservée")?;
    let backup = PathBuf::from(&b.dir);
    if let Some(current) = installed_dir(root, pkg.id) {
        if running_inside(&current) {
            return Err(format!("{} est ouvert : fermez-le puis réessayez", pkg.name));
        }
        let v = read_manifest(&current).map(|m| m.version).unwrap_or_default();
        let aside = root.join("_backups").join(format!("{}-{}-{}", folder_name(pkg), sanitize(&v), stamp()));
        fs::rename(&current, &aside).map_err(|e| download::disk_message(&e))?;
        let final_dir = root.join(folder_name(pkg));
        let target = if final_dir.exists() { current.clone() } else { final_dir };
        if let Err(e) = fs::rename(&backup, &target) {
            let _ = fs::rename(&aside, &current);
            return Err(download::disk_message(&e));
        }
        let files = read_manifest(&aside).map(|m| m.files).unwrap_or_default();
        carry_user_data(&aside, &target, &files);
        return describe(&target).ok_or("restauration incomplète".into());
    }
    let mut target = root.join(folder_name(pkg));
    if target.exists() {
        target = root.join(format!("{} (iBox)", folder_name(pkg)));
    }
    fs::rename(&backup, &target).map_err(|e| download::disk_message(&e))?;
    describe(&target).ok_or("restauration incomplète".into())
}

fn describe(dir: &Path) -> Option<Installed> {
    let m = read_manifest(dir)?;
    Some(Installed {
        exe: dir.join(&m.exe).to_string_lossy().to_string(),
        dir: dir.to_string_lossy().to_string(),
        package_id: m.package_id,
        version: m.version,
        verified: m.verified,
        installed_at: m.installed_at,
    })
}

/// Supprime définitivement les sauvegardes d'un paquet (à la demande de l'utilisateur).
pub fn purge_backups(root: &Path, package_id: &str) -> Result<u64, String> {
    let mut freed = 0;
    for b in backups(root).into_iter().filter(|b| b.package_id == package_id) {
        // seulement des dossiers du sous-dossier _backups, jamais au-delà
        let p = PathBuf::from(&b.dir);
        if p.parent() != Some(root.join("_backups").as_path()) {
            continue;
        }
        fs::remove_dir_all(&p).map_err(|e| download::disk_message(&e))?;
        freed += b.bytes;
    }
    Ok(freed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::emulators::catalog;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn fake_zip(path: &Path, version_marker: &[u8]) {
        let mut w = zip::ZipWriter::new(fs::File::create(path).unwrap());
        w.start_file("PPSSPP/PPSSPPWindows64.exe", SimpleFileOptions::default()).unwrap();
        w.write_all(b"MZ fake").unwrap();
        w.start_file("PPSSPP/assets/version.txt", SimpleFileOptions::default()).unwrap();
        w.write_all(version_marker).unwrap();
        w.finish().unwrap();
    }

    /// Installe une archive locale sans réseau (le téléchargement est testé à part).
    fn install_local(root: &Path, version: &str, marker: &[u8]) -> Result<Installed, InstallError> {
        let pkg = catalog::package("ppsspp").unwrap();
        fs::create_dir_all(root.join("_downloads")).unwrap();
        let file = format!("PPSSPP-{version}.zip");
        let archive_path = root.join("_downloads").join(&file);
        fake_zip(&archive_path, marker);
        let staging = root.join("_staging").join(format!("t-{version}"));
        archive::extract(pkg.archive, &archive_path, &staging, &AtomicBool::new(false), &mut |_| {}).map_err(InstallError::Failed)?;
        let content = content_root(&staging);
        let exe = find_exe(&content, pkg.exe).unwrap();
        for m in pkg.markers {
            fs::write(exe.parent().unwrap().join(m), b"").unwrap();
        }
        let manifest = Manifest {
            package_id: pkg.id.into(),
            version: version.into(),
            source_url: "local".into(),
            sha256: String::new(),
            verified: false,
            installed_at: "t".into(),
            exe: "PPSSPPWindows64.exe".into(),
            files: top_level(&content),
        };
        write_manifest(&content, &manifest).unwrap();
        let dir = activate(root, pkg, &content)?;
        let _ = fs::remove_dir_all(&staging);
        Ok(describe(&dir).unwrap())
    }

    #[test]
    fn installation_mise_a_jour_restauration_desinstallation() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("Mes émulateurs (D)");
        let pkg = catalog::package("ppsspp").unwrap();

        let first = install_local(&root, "1.0", b"v1").unwrap();
        assert!(Path::new(&first.exe).is_file());
        assert!(Path::new(&first.dir).join("installed.txt").is_file(), "données dans Documents");
        assert_eq!(installed(&root).len(), 1);

        // l'utilisateur crée des fichiers à côté du programme
        fs::create_dir_all(Path::new(&first.dir).join("memstick/SAVEDATA")).unwrap();
        fs::write(Path::new(&first.dir).join("memstick/SAVEDATA/save.bin"), b"partie").unwrap();

        let second = install_local(&root, "2.0", b"v2").unwrap();
        assert_eq!(second.dir, first.dir, "même dossier après mise à jour");
        assert_eq!(fs::read(Path::new(&second.dir).join("assets/version.txt")).unwrap(), b"v2");
        assert_eq!(fs::read(Path::new(&second.dir).join("memstick/SAVEDATA/save.bin")).unwrap(), b"partie", "sauvegarde conservée");
        assert_eq!(backups(&root).len(), 1, "version 1.0 conservée");

        let restored = restore(&root, pkg).unwrap();
        assert_eq!(restored.version, "1.0");
        assert_eq!(fs::read(Path::new(&restored.dir).join("assets/version.txt")).unwrap(), b"v1");
        assert!(Path::new(&restored.dir).join("memstick/SAVEDATA/save.bin").is_file(), "sauvegarde suivie");

        let moved = uninstall(&root, pkg).unwrap();
        assert!(moved.join("PPSSPPWindows64.exe").is_file(), "désinstallation réversible");
        assert!(installed(&root).is_empty());
        assert!(purge_backups(&root, "ppsspp").unwrap() > 0);
        assert!(backups(&root).is_empty());
    }

    #[test]
    fn dossier_externe_homonyme_jamais_ecrase() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path();
        fs::create_dir_all(root.join("PPSSPP")).unwrap();
        fs::write(root.join("PPSSPP/ma-config.ini"), b"perso").unwrap();
        let inst = install_local(root, "1.0", b"v1").unwrap();
        assert!(inst.dir.ends_with("PPSSPP (iBox)"));
        assert_eq!(fs::read(root.join("PPSSPP/ma-config.ini")).unwrap(), b"perso");
    }

    #[test]
    fn exe_introuvable_ou_factice_refuse() {
        let t = tempfile::tempdir().unwrap();
        fs::create_dir_all(t.path().join("a")).unwrap();
        fs::write(t.path().join("a/PPSSPPWindows64.exe"), b"pas un programme").unwrap();
        assert!(find_exe(t.path(), &["PPSSPPWindows64.exe"]).is_none());
        fs::write(t.path().join("a/PPSSPPWindows64.exe"), b"MZ").unwrap();
        assert!(find_exe(t.path(), &["ppssppwindows64.exe"]).is_some());
    }

    /// Essai réel (réseau) : `cargo test --lib emulators::install::tests::vrai -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn vrai_telechargement_des_paquets() {
        let ids: Vec<String> = std::env::var("IBOX_PKGS").unwrap_or_else(|_| "ppsspp".into()).split(',').map(str::to_string).collect();
        let root = std::env::var("IBOX_EMU_ROOT").map(PathBuf::from).unwrap_or_else(|_| tempfile::tempdir().unwrap().keep());
        let http = download::client().unwrap();
        for id in ids {
            let pkg = catalog::package(&id).unwrap();
            let started = std::time::Instant::now();
            let mut last = String::new();
            let r = install(&http, pkg, &root, &AtomicBool::new(false), &mut |s| {
                if let Step::Version(v) = s {
                    last = v;
                }
            });
            match r {
                Ok(i) => println!("OK {id} {} ({}) vérifié={} en {:?} → {}", i.version, last, i.verified, started.elapsed(), i.exe),
                Err(e) => println!("ÉCHEC {id}: {e:?}"),
            }
        }
    }
}
