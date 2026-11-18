//! Installation d'un émulateur depuis Flathub (Linux, Steam Deck), quand son projet ne publie pas
//! d'AppImage simple : Dolphin, RetroArch, melonDS, shadPS4, SameBoy, Stella, MAME.
//!
//! Flathub est la boutique d'applications du Steam Deck (Discover). iBox installe dans
//! l'installation **de l'utilisateur** (`flatpak install --user`, sans droits administrateur),
//! depuis le dépôt Flathub signé (OSTree + GPG, vérifiés par flatpak lui-même). Une application
//! déjà installée par Discover (installation système) est reprise telle quelle. Les mises à jour
//! passent ensuite par Flathub (Discover ou `flatpak update`), comme pour toute application du Deck.
//!
//! iBox garde une trace dans son dossier d'émulateurs (`<racine>/<nom>/ibox-install.json`,
//! source `flatpak:flathub/<id>`) : l'émulateur apparaît comme installé, et la désinstallation
//! retire l'application de l'installation de l'utilisateur (jamais celle du système).

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use super::catalog::Package;
use super::install::{InstallError, Installed, Manifest, Stage, Step};

pub const REMOTE_URL: &str = "https://dl.flathub.org/repo/flathub.flatpakrepo";
/// Préfixe de `Manifest::source_url` d'une installation Flathub.
pub const SOURCE_PREFIX: &str = "flatpak:flathub/";

/// Identifiant Flatpak sûr (lettres, chiffres, `.`, `_`, `-`, au moins trois segments).
pub fn valid_app_id(app: &str) -> bool {
    app.split('.').count() >= 3 && app.len() <= 255 && app.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Lanceurs exportés : installation de l'utilisateur, puis du système (Discover).
pub fn launcher_candidates(home: &Path, app: &str) -> [PathBuf; 2] {
    [
        home.join(".local/share/flatpak/exports/bin").join(app),
        PathBuf::from("/var/lib/flatpak/exports/bin").join(app),
    ]
}

pub fn launcher(app: &str) -> Option<PathBuf> {
    let home = crate::paths::home()?;
    launcher_candidates(&home, app).into_iter().find(|p| p.exists())
}

/// L'application est-elle dans l'installation de l'utilisateur (donc retirable par iBox) ?
pub fn user_installed(app: &str) -> bool {
    crate::paths::home().is_some_and(|h| launcher_candidates(&h, app)[0].exists())
}

fn flatpak() -> Command {
    let mut c = Command::new("flatpak");
    // sortie en anglais, stable à lire ; aucune question posée
    c.env("LC_ALL", "C").stdin(Stdio::null());
    c
}

fn available() -> bool {
    flatpak().arg("--version").stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success())
}

/// Lance une commande flatpak et attend sa fin ; `cancel` l'interrompt.
fn run(mut cmd: Command, cancel: &AtomicBool, what: &str) -> Result<(), InstallError> {
    let mut child = cmd.stdout(Stdio::null()).stderr(Stdio::piped()).spawn().map_err(|e| format!("flatpak introuvable : {e}"))?;
    loop {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(InstallError::Cancelled);
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(_)) => {
                let mut err = String::new();
                if let Some(mut e) = child.stderr.take() {
                    let _ = std::io::Read::read_to_string(&mut e, &mut err);
                }
                let last = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
                return Err(format!("{what} : {}", if last.is_empty() { "échec de flatpak" } else { last }).into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(200)),
            Err(e) => return Err(format!("{what} : {e}").into()),
        }
    }
}

/// Version affichée par `flatpak info` (ligne `Version:`), sinon « Flathub ».
pub fn parse_version(info: &str) -> String {
    info.lines()
        .find_map(|l| l.trim().strip_prefix("Version:").map(|v| v.trim().to_string()))
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "Flathub".into())
}

fn version(app: &str) -> String {
    flatpak().args(["info", app]).output().ok().map(|o| parse_version(&String::from_utf8_lossy(&o.stdout))).unwrap_or_else(|| "Flathub".into())
}

/// Installe (ou reprend) `app` depuis Flathub et l'inscrit dans le dossier des émulateurs.
pub fn install(pkg: &Package, app: &str, root: &Path, cancel: &AtomicBool, report: &mut dyn FnMut(Step)) -> Result<Installed, InstallError> {
    if !cfg!(target_os = "linux") {
        return Err("Flathub n'existe que sous Linux".to_string().into());
    }
    if !valid_app_id(app) {
        return Err("identifiant Flathub invalide".to_string().into());
    }
    report(Step::Stage(Stage::Resolving));
    if launcher(app).is_none() {
        if !available() {
            return Err("Flatpak est introuvable sur ce système : installez l'émulateur avec Discover, puis « Rechercher les émulateurs installés ».".to_string().into());
        }
        let mut add = flatpak();
        add.args(["remote-add", "--user", "--if-not-exists", "flathub", REMOTE_URL]);
        run(add, cancel, "dépôt Flathub")?;
        report(Step::Stage(Stage::Downloading));
        let mut inst = flatpak();
        inst.args(["install", "--user", "--noninteractive", "-y", "flathub", app]);
        run(inst, cancel, "installation Flathub")?;
    }
    report(Step::Stage(Stage::Installing));
    let exe = launcher(app).ok_or_else(|| InstallError::from("installation Flathub terminée, mais son lanceur est introuvable".to_string()))?;
    let v = version(app);
    report(Step::Version(v.clone()));
    let dir = root.join(super::install::folder_name(pkg));
    std::fs::create_dir_all(&dir).map_err(|e| super::download::disk_message(&e))?;
    let installed_at = crate::library::time::now_iso();
    let manifest = Manifest {
        package_id: pkg.id.into(),
        version: v.clone(),
        source_url: format!("{SOURCE_PREFIX}{app}"),
        sha256: String::new(),
        // dépôt signé, vérifié par flatpak
        verified: true,
        installed_at: installed_at.clone(),
        // chemin absolu : `dir.join(exe)` le garde tel quel
        exe: exe.to_string_lossy().into_owned(),
        files: Vec::new(),
    };
    super::install::write_manifest(&dir, &manifest)?;
    Ok(Installed {
        package_id: pkg.id.into(),
        dir: dir.to_string_lossy().into_owned(),
        exe: exe.to_string_lossy().into_owned(),
        version: v,
        verified: true,
        installed_at,
    })
}

/// Désinstallation : retire l'application de l'installation de l'utilisateur ; une installation
/// système (Discover) est laissée en place.
pub fn uninstall(app: &str) -> Result<(), String> {
    if !valid_app_id(app) || !user_installed(app) {
        return Ok(());
    }
    let out = flatpak().args(["uninstall", "--user", "--noninteractive", "-y", app]).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("désinstallation Flathub : {}", String::from_utf8_lossy(&out.stderr).trim()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiants_et_lanceurs() {
        assert!(valid_app_id("org.DolphinEmu.dolphin-emu"));
        assert!(!valid_app_id("dolphin"));
        assert!(!valid_app_id("org.x.y; rm -rf"));
        let [user, system] = launcher_candidates(Path::new("/home/deck"), "net.kuribo64.melonDS");
        assert_eq!(user, PathBuf::from("/home/deck/.local/share/flatpak/exports/bin/net.kuribo64.melonDS"));
        assert_eq!(system, PathBuf::from("/var/lib/flatpak/exports/bin/net.kuribo64.melonDS"));
        assert_eq!(parse_version("        ID: org.libretro.RetroArch\n   Version: 1.21.0\n    Branch: stable\n"), "1.21.0");
        assert_eq!(parse_version("ID: x"), "Flathub");
    }

    /// Essai réel (Linux, flatpak installé, réseau) : désinstallation par iBox d'une application
    /// de l'utilisateur. `IBOX_FLATPAK_APP=io.github.stella_emu.Stella cargo test --lib
    /// emulators::flatpak::tests::vraie_desinstallation -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn vraie_desinstallation() {
        let app = std::env::var("IBOX_FLATPAK_APP").expect("IBOX_FLATPAK_APP");
        assert!(user_installed(&app), "{app} absent de l'installation de l'utilisateur");
        uninstall(&app).unwrap();
        assert!(!user_installed(&app), "{app} toujours là");
        assert!(launcher(&app).is_none());
        println!("désinstallé : {app}");
    }
}
