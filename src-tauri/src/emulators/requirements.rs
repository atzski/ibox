//! Prérequis d'une console : BIOS, micrologiciels, composants Windows. iBox ne
//! télécharge jamais de BIOS ni de clés : il vérifie leur présence, explique où
//! se les procurer légalement et copie au bon endroit un fichier choisi par
//! l'utilisateur (taille contrôlée, aucun écrasement).

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum State {
    Ok,
    Missing,
    /// Impossible à vérifier depuis iBox (géré dans l'émulateur).
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Requirement {
    /// Identifiant (textes dans l'interface).
    pub id: &'static str,
    /// bios | firmware | keys | runtime | setup
    pub kind: &'static str,
    pub state: State,
    pub required: bool,
    /// Dossier où l'émulateur cherche le fichier.
    pub folder: Option<String>,
    pub importable: bool,
    /// Page officielle (Microsoft, constructeur, documentation de l'émulateur).
    pub link: Option<&'static str>,
}

/// Règle d'import : tailles acceptées (octets).
struct Bios {
    id: &'static str,
    sizes: &'static [u64],
}

const KIB: u64 = 1024;
const PS1: Bios = Bios { id: "ps1-bios", sizes: &[512 * KIB] };
const PS2: Bios = Bios { id: "ps2-bios", sizes: &[4096 * KIB, 8192 * KIB] };
const SATURN: Bios = Bios { id: "saturn-bios", sizes: &[512 * KIB] };

pub(crate) fn documents() -> PathBuf {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        if let Ok(key) = winreg::RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders") {
            if let Ok(p) = key.get_value::<String, _>("Personal") {
                return PathBuf::from(p);
            }
        }
    }
    std::env::var("USERPROFILE").map(|h| PathBuf::from(h).join("Documents")).unwrap_or_default()
}

/// Dossier de BIOS de DuckStation : dossier utilisateur existant, sinon emplacement par défaut.
fn duckstation_bios() -> PathBuf {
    let candidates = [
        std::env::var("LOCALAPPDATA").map(|p| PathBuf::from(p).join("DuckStation")).unwrap_or_default(),
        documents().join("DuckStation"),
    ];
    candidates.iter().find(|p| p.is_dir()).cloned().unwrap_or_else(|| candidates[1].clone()).join("bios")
}

fn pcsx2_bios() -> PathBuf {
    documents().join("PCSX2").join("bios")
}

fn has_bios(dir: &Path, sizes: &[u64]) -> bool {
    fs::read_dir(dir).is_ok_and(|rd| rd.flatten().any(|e| e.metadata().is_ok_and(|m| m.is_file() && sizes.contains(&m.len()))))
}

fn vc_runtime_installed() -> State {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        let ok = winreg::RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey(r"SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64")
            .and_then(|k| k.get_value::<u32, _>("Installed"))
            .is_ok_and(|v| v == 1);
        return if ok { State::Ok } else { State::Missing };
    }
    #[allow(unreachable_code)]
    State::Unknown
}

fn dotnet8_desktop() -> State {
    let base = std::env::var("ProgramFiles").map(PathBuf::from).unwrap_or_default().join(r"dotnet\shared\Microsoft.WindowsDesktop.App");
    let ok = fs::read_dir(&base).is_ok_and(|rd| {
        rd.flatten().any(|e| e.file_name().to_string_lossy().split('.').next().and_then(|m| m.parse::<u32>().ok()).is_some_and(|m| m >= 8))
    });
    if ok { State::Ok } else { State::Missing }
}

const VC_LINK: &str = "https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist";

/// Pages officielles citées par les prérequis (seules adresses que l'interface peut ouvrir avec le catalogue).
pub const LINKS: &[&str] = &[
    VC_LINK,
    "https://www.duckstation.org/wiki/BIOS",
    "https://pcsx2.net/docs/setup/bios/",
    "https://docs.libretro.com/library/beetle_saturn/#bios",
    "https://rpcs3.net/quickstart",
    "https://vita3k.org/quickstart.html",
    "https://github.com/shadps4-emu/shadPS4#readme",
    "https://xemu.app/docs/required-files/",
    "https://cemu.cfw.guide/",
    "https://azahar-emu.org/pages/faq/",
    "https://github.com/flyinghead/flycast/wiki",
    "https://dotnet.microsoft.com/download/dotnet/8.0",
    "https://docs.libretro.com/library/fbneo/",
];

/// Prérequis d'une console, selon l'émulateur recommandé (`retroarch_dir` : RetroArch géré par iBox).
pub fn for_platform(platform: &str, retroarch_dir: Option<&Path>) -> Vec<Requirement> {
    let bios = |id: &'static str, dir: PathBuf, rule: &Bios, required: bool, link: Option<&'static str>| Requirement {
        id,
        kind: "bios",
        state: if has_bios(&dir, rule.sizes) { State::Ok } else { State::Missing },
        required,
        folder: Some(dir.to_string_lossy().to_string()),
        importable: true,
        link,
    };
    let info = |id: &'static str, kind: &'static str, required: bool, link: &'static str| Requirement { id, kind, state: State::Unknown, required, folder: None, importable: false, link: Some(link) };
    match platform {
        "ps1" => vec![bios(PS1.id, duckstation_bios(), &PS1, false, Some("https://www.duckstation.org/wiki/BIOS"))],
        "ps2" => vec![bios(PS2.id, pcsx2_bios(), &PS2, false, Some("https://pcsx2.net/docs/setup/bios/"))],
        "saturn" => match retroarch_dir {
            Some(ra) => vec![bios(SATURN.id, ra.join("system"), &SATURN, false, Some("https://docs.libretro.com/library/beetle_saturn/#bios"))],
            None => vec![info(SATURN.id, "bios", false, "https://docs.libretro.com/library/beetle_saturn/#bios")],
        },
        "ps3" => vec![
            info("ps3-firmware", "firmware", true, "https://rpcs3.net/quickstart"),
            Requirement { id: "vc-runtime", kind: "runtime", state: vc_runtime_installed(), required: true, folder: None, importable: false, link: Some(VC_LINK) },
        ],
        "vita" => vec![info("vita-firmware", "firmware", true, "https://vita3k.org/quickstart.html")],
        "ps4" => vec![info("ps4-modules", "firmware", true, "https://github.com/shadps4-emu/shadPS4#readme")],
        "xbox" => vec![info("xbox-files", "bios", true, "https://xemu.app/docs/required-files/")],
        "xbox360" => vec![Requirement { id: "vc-runtime", kind: "runtime", state: vc_runtime_installed(), required: true, folder: None, importable: false, link: Some(VC_LINK) }],
        "wiiu" => vec![info("wiiu-keys", "keys", true, "https://cemu.cfw.guide/")],
        // Eden, Lichii et Fritchii demandent les clés et le micrologiciel de votre console au premier démarrage
        "switch" | "switch2" => vec![info("switch-keys", "keys", true, "https://github.com/zortos293/Lichii")],
        "3ds" => vec![info("3ds-decrypted", "setup", true, "https://azahar-emu.org/pages/faq/")],
        "dreamcast" => vec![info("dreamcast-bios", "bios", false, "https://github.com/flyinghead/flycast/wiki")],
        "nes" | "snes" => vec![Requirement { id: "dotnet8", kind: "runtime", state: dotnet8_desktop(), required: true, folder: None, importable: false, link: Some("https://dotnet.microsoft.com/download/dotnet/8.0") }],
        "arcade" => vec![info("arcade-romsets", "setup", true, "https://docs.libretro.com/library/fbneo/")],
        _ => Vec::new(),
    }
}

/// Copie un BIOS choisi par l'utilisateur dans le dossier de l'émulateur.
pub fn import(requirement: &str, file: &Path, retroarch_dir: Option<&Path>) -> Result<PathBuf, String> {
    let (rule, dir) = match requirement {
        "ps1-bios" => (&PS1, duckstation_bios()),
        "ps2-bios" => (&PS2, pcsx2_bios()),
        "saturn-bios" => (&SATURN, retroarch_dir.ok_or("installez d'abord RetroArch avec iBox")?.join("system")),
        _ => return Err("ce prérequis ne s'importe pas depuis iBox".into()),
    };
    let meta = fs::metadata(file).map_err(|_| "fichier introuvable".to_string())?;
    if !meta.is_file() || !rule.sizes.contains(&meta.len()) {
        return Err("ce fichier n'a pas la taille d'un BIOS de cette console".into());
    }
    let name = file.file_name().ok_or("nom de fichier invalide")?;
    fs::create_dir_all(&dir).map_err(|e| super::download::disk_message(&e))?;
    let target = dir.join(name);
    if target.exists() {
        return if fs::read(&target).ok() == fs::read(file).ok() { Ok(target) } else { Err("un autre fichier porte déjà ce nom dans le dossier des BIOS".into()) };
    }
    fs::copy(file, &target).map_err(|e| super::download::disk_message(&e))?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_controle_la_taille_et_n_ecrase_rien() {
        let t = tempfile::tempdir().unwrap();
        let ra = t.path().join("RetroArch");
        let bad = t.path().join("faux.bin");
        fs::write(&bad, b"court").unwrap();
        assert!(import("saturn-bios", &bad, Some(&ra)).is_err());
        let good = t.path().join("sega_101.bin");
        fs::write(&good, vec![0u8; 512 * 1024]).unwrap();
        let placed = import("saturn-bios", &good, Some(&ra)).unwrap();
        assert!(placed.is_file());
        assert!(import("saturn-bios", &good, Some(&ra)).is_ok(), "même fichier : accepté");
        let other = t.path().join("autre").join("sega_101.bin");
        fs::create_dir_all(other.parent().unwrap()).unwrap();
        fs::write(&other, vec![1u8; 512 * 1024]).unwrap();
        assert!(import("saturn-bios", &other, Some(&ra)).is_err(), "jamais d'écrasement");
        let reqs = for_platform("saturn", Some(&ra));
        assert_eq!(reqs[0].state, State::Ok);
        assert!(import("ps3-firmware", &good, None).is_err());
    }
}
