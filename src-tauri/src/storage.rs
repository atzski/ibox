//! Emplacement des images (`media/`) et des manuels (`manuals/`).
//!
//! Par défaut dans le dossier des données d'iBox ; l'utilisateur peut choisir un autre dossier
//! (un autre disque, par exemple) dans Paramètres › Images et données. Le choix vit dans
//! `storage.json` (dossier des données). La base ne garde que des chemins relatifs à ces
//! dossiers : déplacer le stockage ne touche qu'aux fichiers, rien n'est retéléchargé.
//!
//! Le déplacement se fait à chaud : simple renommage sur le même disque, sinon copie
//! (progression sur `storage://progress`), bascule des stockages, rattrapage des fichiers
//! écrits entre-temps, puis effacement de l'ancien dossier. Pendant le déplacement, les
//! récupérations d'images et de manuels sont refusées (leurs drapeaux sont pris).

use crate::manuals::commands::ManualState;
use crate::metadata::commands::MetadataState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const CONFIG: &str = "storage.json";
pub const MEDIA: &str = "media";
pub const MANUALS: &str = "manuals";

#[derive(Serialize, Deserialize, Default)]
struct Config {
    root: Option<PathBuf>,
}

/// Dossier choisi par l'utilisateur, s'il y en a un.
pub fn custom_root(data: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(data.join(CONFIG)).ok()?;
    serde_json::from_str::<Config>(&text).ok()?.root.filter(|p| p.is_absolute())
}

/// Dossier qui contient `media/` et `manuals/`.
pub fn root(data: &Path) -> PathBuf {
    custom_root(data).unwrap_or_else(|| data.to_path_buf())
}

pub fn media_dir(data: &Path) -> PathBuf {
    root(data).join(MEDIA)
}

pub fn manuals_dir(data: &Path) -> PathBuf {
    root(data).join(MANUALS)
}

fn save_config(data: &Path, root: Option<&Path>) -> io::Result<()> {
    let path = data.join(CONFIG);
    let Some(root) = root else {
        return match fs::remove_file(&path) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        };
    };
    let text = serde_json::to_string_pretty(&Config { root: Some(root.to_path_buf()) }).map_err(io::Error::other)?;
    let tmp = data.join(format!("{CONFIG}.tmp"));
    fs::write(&tmp, text)?;
    fs::rename(&tmp, &path)
}

/// Chemin comparable : le plus long ancêtre existant est résolu (liens, casse, `..`), le reste
/// est ajouté tel quel. Sous Windows le préfixe `\\?\` est retiré.
fn canon(path: &Path) -> PathBuf {
    let mut rest = Vec::new();
    let mut cur = path;
    loop {
        if let Ok(c) = fs::canonicalize(cur) {
            let mut out = strip_verbatim(c);
            for part in rest.iter().rev() {
                out.push(part);
            }
            return out;
        }
        match (cur.parent(), cur.file_name()) {
            (Some(parent), Some(name)) => {
                rest.push(name.to_os_string());
                cur = parent;
            }
            _ => return path.to_path_buf(),
        }
    }
}

fn strip_verbatim(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{unc}"));
    }
    match text.strip_prefix(r"\\?\") {
        Some(plain) => PathBuf::from(plain),
        None => path,
    }
}

fn same_path(a: &Path, b: &Path) -> bool {
    let (a, b) = (canon(a), canon(b));
    if cfg!(windows) {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    } else {
        a == b
    }
}

fn inside(child: &Path, parent: &Path) -> bool {
    let (c, p) = (canon(child), canon(parent));
    if cfg!(windows) {
        PathBuf::from(c.to_string_lossy().to_lowercase()).starts_with(PathBuf::from(p.to_string_lossy().to_lowercase()))
    } else {
        c.starts_with(p)
    }
}

/// Dossier absent ou vide.
fn empty_or_missing(dir: &Path) -> bool {
    match fs::read_dir(dir) {
        Ok(mut it) => it.next().is_none(),
        Err(e) => e.kind() == io::ErrorKind::NotFound,
    }
}

/// Nombre d'octets sous `dir` (0 s'il n'existe pas).
pub fn tree_bytes(dir: &Path) -> u64 {
    walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}

/// Espace libre du disque qui porte `path` (point de montage le plus long qui le contient).
fn free_space(path: &Path) -> Option<u64> {
    let target = canon(path);
    let disks = sysinfo::Disks::new_with_refreshed_list();
    disks
        .list()
        .iter()
        .filter(|d| inside(&target, d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| d.available_space())
}

fn mount_of(path: &Path) -> Option<PathBuf> {
    let target = canon(path);
    let disks = sysinfo::Disks::new_with_refreshed_list();
    disks
        .list()
        .iter()
        .filter(|d| inside(&target, d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| d.mount_point().to_path_buf())
}

fn human(bytes: u64) -> String {
    const GIB: f64 = 1024.0 * 1024.0 * 1024.0;
    const MIB: f64 = 1024.0 * 1024.0;
    let b = bytes as f64;
    if b >= GIB {
        format!("{:.1} Go", b / GIB).replace('.', ",")
    } else {
        format!("{} Mo", (b / MIB).ceil() as u64)
    }
}

/// Vérifie qu'on peut déplacer le stockage de `from_root` vers `to_root`.
fn check(from_root: &Path, to_root: &Path) -> Result<(), String> {
    if !to_root.is_absolute() {
        return Err("Choisissez un dossier complet (avec sa lettre de lecteur).".into());
    }
    if same_path(from_root, to_root) {
        return Err("Les images et les manuels sont déjà dans ce dossier.".into());
    }
    for name in [MEDIA, MANUALS] {
        let old = from_root.join(name);
        let new = to_root.join(name);
        if inside(to_root, &old) || inside(&old, &new) {
            return Err("Le nouveau dossier ne peut pas se trouver dans l'ancien (ni l'inverse).".into());
        }
        if !empty_or_missing(&new) {
            return Err(format!(
                "Ce dossier contient déjà un dossier « {name} » qui n'est pas vide. Choisissez un dossier vide, ou créez-en un nouveau (par exemple « iBox »)."
            ));
        }
    }
    fs::create_dir_all(to_root).map_err(|e| format!("Impossible de créer ce dossier : {e}"))?;
    let probe = to_root.join(".ibox-test");
    fs::write(&probe, b"ibox").map_err(|_| "Impossible d'écrire dans ce dossier (lecture seule ou accès refusé).".to_string())?;
    let _ = fs::remove_file(probe);
    Ok(())
}

enum Moved {
    /// Rien à déplacer (dossier absent) : le nouveau dossier a été créé vide.
    Created,
    /// Renommé d'un seul coup (même disque) : rien à effacer.
    Renamed,
    /// Copié : l'ancien reste à rattraper puis à effacer.
    Copied,
}

/// Copie récursive ; `progress` reçoit le nombre d'octets copiés à chaque fichier.
fn copy_tree(from: &Path, to: &Path, progress: &mut dyn FnMut(u64)) -> io::Result<()> {
    for entry in walkdir::WalkDir::new(from) {
        let entry = entry.map_err(io::Error::other)?;
        let rel = entry.path().strip_prefix(from).map_err(io::Error::other)?;
        let dest = to.join(rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&dest)?;
        } else if entry.file_type().is_file() {
            progress(fs::copy(entry.path(), &dest)?);
        }
    }
    Ok(())
}

fn move_dir(from: &Path, to: &Path, progress: &mut dyn FnMut(u64)) -> io::Result<Moved> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    if !from.exists() {
        fs::create_dir_all(to)?;
        return Ok(Moved::Created);
    }
    // dossier vide laissé là (vérifié par `check`) : le renommage exige sa place libre
    let _ = fs::remove_dir(to);
    if fs::rename(from, to).is_ok() {
        return Ok(Moved::Renamed);
    }
    if let Err(e) = copy_tree(from, to, progress) {
        let _ = fs::remove_dir_all(to);
        return Err(e);
    }
    Ok(Moved::Copied)
}

fn undo(from: &Path, to: &Path, moved: &Moved) {
    match moved {
        Moved::Renamed => {
            let _ = fs::rename(to, from);
        }
        Moved::Created | Moved::Copied => {
            let _ = fs::remove_dir_all(to);
        }
    }
}

/// Après la bascule : copie ce qui a pu être écrit dans l'ancien dossier entre-temps, puis
/// l'efface. Renvoie faux si quelque chose y est resté (fichier ouvert ailleurs, droits).
fn finish(from: &Path, to: &Path) -> bool {
    for entry in walkdir::WalkDir::new(from).into_iter().filter_map(Result::ok) {
        let Ok(rel) = entry.path().strip_prefix(from) else { continue };
        let dest = to.join(rel);
        if entry.file_type().is_dir() {
            let _ = fs::create_dir_all(&dest);
        } else if entry.file_type().is_file() && !dest.exists() {
            let _ = fs::copy(entry.path(), &dest);
        }
    }
    fs::remove_dir_all(from).is_ok() || !from.exists()
}

/// Déplace `media/` et `manuals/` de `from_root` vers `to_root`. `commit` enregistre le choix
/// et bascule les stockages ; s'il échoue, tout est remis en place.
fn relocate(
    from_root: &Path,
    to_root: &Path,
    progress: &mut dyn FnMut(u64, u64),
    commit: impl FnOnce() -> io::Result<()>,
) -> Result<bool, String> {
    check(from_root, to_root)?;
    let pairs = [MEDIA, MANUALS].map(|name| (from_root.join(name), to_root.join(name)));
    let total: u64 = pairs.iter().map(|(from, _)| tree_bytes(from)).sum();
    let same_disk = matches!((mount_of(from_root), mount_of(to_root)), (Some(a), Some(b)) if a == b);
    if !same_disk {
        if let Some(free) = free_space(to_root) {
            // marge : tailles de blocs, fichiers écrits pendant la copie
            if free < total + total / 50 + 16 * 1024 * 1024 {
                return Err(format!("Espace insuffisant sur ce disque : {} nécessaires, {} libres.", human(total), human(free)));
            }
        }
    }
    let mut done = 0u64;
    progress(0, total);
    let mut moved: Vec<(&PathBuf, &PathBuf, Moved)> = Vec::new();
    for (from, to) in &pairs {
        let result = move_dir(from, to, &mut |n| {
            done += n;
            progress(done, total);
        });
        match result {
            Ok(m) => moved.push((from, to, m)),
            Err(e) => {
                for (f, t, m) in moved.iter().rev() {
                    undo(f, t, m);
                }
                return Err(format!("Déplacement interrompu, rien n'a changé : {e}"));
            }
        }
    }
    if let Err(e) = commit() {
        for (f, t, m) in moved.iter().rev() {
            undo(f, t, m);
        }
        return Err(format!("Déplacement annulé, rien n'a changé : {e}"));
    }
    progress(total, total);
    let mut clean = true;
    for (from, to, m) in &moved {
        if matches!(m, Moved::Copied) {
            clean &= finish(from, to);
        }
    }
    Ok(clean)
}

/// Déplace un fichier ou un dossier, même vers un autre disque (copie puis effacement).
pub fn move_path(from: &Path, to: &Path) -> io::Result<()> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    if from.is_dir() {
        copy_tree(from, to, &mut |_| {})?;
        fs::remove_dir_all(from)
    } else {
        fs::copy(from, to)?;
        fs::remove_file(from)
    }
}

// ——— Commandes ———

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    /// Dossier qui contient `media` et `manuals`.
    root: String,
    media: String,
    manuals: String,
    /// Emplacement choisi par l'utilisateur (faux : dossier des données d'iBox).
    custom: bool,
    /// Faux si le dossier choisi est introuvable (disque débranché).
    available: bool,
    bytes: u64,
    free: Option<u64>,
}

#[derive(Serialize, Clone)]
struct Progress {
    done: u64,
    total: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageMoved {
    info: StorageInfo,
    /// Faux si des fichiers sont restés dans l'ancien dossier (à effacer à la main).
    cleaned: bool,
    /// Ancien dossier, pour le signaler s'il n'a pas pu être vidé.
    previous: String,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn info(data: &Path) -> StorageInfo {
    let root = root(data);
    StorageInfo {
        media: root.join(MEDIA).to_string_lossy().into_owned(),
        manuals: root.join(MANUALS).to_string_lossy().into_owned(),
        custom: custom_root(data).is_some(),
        available: root.is_dir(),
        bytes: tree_bytes(&root.join(MEDIA)) + tree_bytes(&root.join(MANUALS)),
        free: free_space(&root),
        root: root.to_string_lossy().into_owned(),
    }
}

#[tauri::command]
pub async fn storage_info(app: AppHandle) -> Result<StorageInfo, String> {
    let data = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || info(&data)).await.map_err(|e| e.to_string())
}

/// Déplace images et manuels vers `target` (`None` : retour au dossier des données d'iBox).
#[tauri::command]
pub async fn storage_move(app: AppHandle, target: Option<String>) -> Result<StorageMoved, String> {
    let data = data_dir(&app)?;
    let meta = app.state::<MetadataState>();
    let manuals = app.state::<ManualState>();
    if !meta.claim() {
        return Err("Une récupération d'images est en cours : attendez qu'elle se termine ou arrêtez-la.".into());
    }
    if !manuals.claim() {
        meta.release();
        return Err("Une récupération de manuels est en cours : attendez qu'elle se termine ou arrêtez-la.".into());
    }
    let app2 = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let from_root = root(&data);
        let custom = target.map(PathBuf::from).filter(|t| !same_path(t, &data));
        let to_root = custom.clone().unwrap_or_else(|| data.clone());
        let mut last = Instant::now() - Duration::from_secs(1);
        let emitter = app2.clone();
        let mut progress = move |done: u64, total: u64| {
            if done == total || last.elapsed() >= Duration::from_millis(120) {
                last = Instant::now();
                let _ = emitter.emit("storage://progress", Progress { done, total });
            }
        };
        let cleaned = relocate(&from_root, &to_root, &mut progress, || {
            save_config(&data, custom.as_deref())?;
            app2.state::<MetadataState>().media.set_root(to_root.join(MEDIA));
            app2.state::<ManualState>().set_root(to_root.join(MANUALS));
            Ok(())
        })?;
        Ok(StorageMoved { info: info(&data), cleaned, previous: from_root.to_string_lossy().into_owned() })
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r);
    meta.release();
    manuals.release();
    result
}

/// Ouvre le dossier des images et manuels dans le gestionnaire de fichiers.
#[tauri::command]
pub fn storage_reveal(app: AppHandle) -> Result<(), String> {
    let root = root(&data_dir(&app)?);
    if !root.is_dir() {
        return Err("Dossier introuvable : le disque est-il branché ?".into());
    }
    crate::shell::open_target(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fill(root: &Path) {
        fs::create_dir_all(root.join("media/12")).unwrap();
        fs::write(root.join("media/12/front.png"), b"png").unwrap();
        fs::create_dir_all(root.join("manuals/cache")).unwrap();
        fs::write(root.join("manuals/12.pdf"), b"pdf").unwrap();
    }

    #[test]
    fn config_round_trip_and_default() {
        let data = tempfile::tempdir().unwrap();
        assert_eq!(root(data.path()), data.path());
        let other = tempfile::tempdir().unwrap();
        save_config(data.path(), Some(other.path())).unwrap();
        assert_eq!(media_dir(data.path()), other.path().join(MEDIA));
        save_config(data.path(), None).unwrap();
        assert_eq!(manuals_dir(data.path()), data.path().join(MANUALS));
        // fichier abîmé : retour au dossier par défaut, sans panne
        fs::write(data.path().join(CONFIG), "{").unwrap();
        assert_eq!(root(data.path()), data.path());
    }

    #[test]
    fn moves_everything_and_cleans_up() {
        let from = tempfile::tempdir().unwrap();
        let to = tempfile::tempdir().unwrap();
        let target = to.path().join("iBox");
        fill(from.path());
        let mut committed = false;
        let mut last = (0, 0);
        let clean = relocate(from.path(), &target, &mut |d, t| last = (d, t), || {
            committed = true;
            Ok(())
        })
        .unwrap();
        assert!(clean && committed);
        assert_eq!(last, (6, 6));
        assert_eq!(fs::read(target.join("media/12/front.png")).unwrap(), b"png");
        assert_eq!(fs::read(target.join("manuals/12.pdf")).unwrap(), b"pdf");
        assert!(target.join("manuals/cache").is_dir());
        assert!(!from.path().join("media").exists() && !from.path().join("manuals").exists());
    }

    #[test]
    fn failed_commit_puts_everything_back() {
        let from = tempfile::tempdir().unwrap();
        let to = tempfile::tempdir().unwrap();
        fill(from.path());
        let err = relocate(from.path(), to.path(), &mut |_, _| {}, || Err(io::Error::other("disque plein"))).unwrap_err();
        assert!(err.contains("rien n'a changé"));
        assert_eq!(fs::read(from.path().join("media/12/front.png")).unwrap(), b"png");
        assert!(!to.path().join("media").exists() || empty_or_missing(&to.path().join("media")));
    }

    #[test]
    fn refuses_bad_targets() {
        let from = tempfile::tempdir().unwrap();
        fill(from.path());
        // même dossier
        assert!(relocate(from.path(), from.path(), &mut |_, _| {}, || Ok(())).is_err());
        // dans l'ancien dossier des images
        let nested = from.path().join("media/sub");
        assert!(relocate(from.path(), &nested, &mut |_, _| {}, || Ok(())).is_err());
        // dossier « media » déjà rempli
        let busy = tempfile::tempdir().unwrap();
        fs::create_dir_all(busy.path().join("media")).unwrap();
        fs::write(busy.path().join("media/x"), b"x").unwrap();
        assert!(relocate(from.path(), busy.path(), &mut |_, _| {}, || Ok(())).unwrap_err().contains("media"));
        // un dossier « media » vide est accepté
        let empty = tempfile::tempdir().unwrap();
        fs::create_dir_all(empty.path().join("media")).unwrap();
        assert!(relocate(from.path(), empty.path(), &mut |_, _| {}, || Ok(())).unwrap());
        assert_eq!(fs::read(empty.path().join("manuals/12.pdf")).unwrap(), b"pdf");
    }

    #[test]
    fn nothing_to_move_creates_empty_folders() {
        let from = tempfile::tempdir().unwrap();
        let to = tempfile::tempdir().unwrap();
        assert!(relocate(from.path(), to.path(), &mut |_, _| {}, || Ok(())).unwrap());
        assert!(to.path().join("media").is_dir() && to.path().join("manuals").is_dir());
    }

    #[test]
    fn copy_fallback_then_catch_up() {
        let from = tempfile::tempdir().unwrap();
        let to = tempfile::tempdir().unwrap();
        fill(from.path());
        let target = to.path().join("media");
        let mut n = 0;
        copy_tree(&from.path().join("media"), &target, &mut |b| n += b).unwrap();
        assert_eq!(n, 3);
        // fichier écrit dans l'ancien dossier après la copie : rattrapé avant l'effacement
        fs::write(from.path().join("media/late.png"), b"late").unwrap();
        assert!(finish(&from.path().join("media"), &target));
        assert_eq!(fs::read(target.join("late.png")).unwrap(), b"late");
    }
}
