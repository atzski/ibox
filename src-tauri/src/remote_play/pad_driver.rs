//! Pilote de manettes virtuelles ViGEmBus : état et installation **avec l'accord de l'utilisateur**.
//!
//! Sans ce pilote, la manette d'un invité ne peut pas devenir une manette Xbox sur l'hôte.
//! L'installation télécharge l'installeur officiel signé (Nefarius, dernière version 1.22.0),
//! vérifie son empreinte SHA-256 figée ici, puis le lance en administrateur : Windows affiche son
//! invite (UAC), qui vaut accord. Une fois le pilote présent, [`crate::remote_play::input::RetryPads`]
//! branche la manette de l'invité tout seul, même en pleine session.

use serde::Serialize;
use sha2::{Digest, Sha256};

const URL: &str = "https://github.com/nefarius/ViGEmBus/releases/download/v1.22.0/ViGEmBus_1.22.0_x64_x86_arm64.exe";
const SHA256: &str = "89220a7865076b342892f98865f3499fb7c4cfd673159e89d352c360fd014c6a";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PadDriver {
    pub installed: bool,
    /// Une manette d'invité est arrivée alors que le pilote manquait.
    pub guest_pad_waiting: bool,
}

pub fn status() -> PadDriver {
    PadDriver {
        installed: installed(),
        guest_pad_waiting: super::input::GUEST_PAD_WAITING.load(std::sync::atomic::Ordering::Relaxed),
    }
}

#[cfg(windows)]
pub fn installed() -> bool {
    winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE)
        .open_subkey(r"SYSTEM\CurrentControlSet\Services\ViGEmBus")
        .is_ok()
}

#[cfg(not(windows))]
pub fn installed() -> bool {
    false
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Vérifie l'installeur téléchargé : seule l'empreinte figée est acceptée.
fn verify(data: &[u8]) -> Result<(), String> {
    let got = hex(&Sha256::digest(data));
    if got == SHA256 {
        Ok(())
    } else {
        Err("l'installeur téléchargé ne correspond pas à la version attendue : installation annulée".into())
    }
}

/// Télécharge, vérifie et lance l'installeur (invite Windows). Bloquant : à appeler hors du fil
/// principal. Renvoie l'état final.
#[cfg(windows)]
pub fn install() -> Result<PadDriver, String> {
    use std::os::windows::process::CommandExt;
    if installed() {
        return Ok(status());
    }
    let http = reqwest::blocking::Client::builder()
        .user_agent(concat!("iBox/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let data = http
        .get(URL)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.bytes())
        .map_err(|e| format!("téléchargement du pilote impossible : {e}"))?;
    verify(&data)?;
    let dir = std::env::temp_dir().join("ibox-vigembus");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let exe = dir.join("ViGEmBus_1.22.0_x64_x86_arm64.exe");
    std::fs::write(&exe, &data).map_err(|e| e.to_string())?;

    // invite d'administration de Windows (accord de l'utilisateur) ; installeur Advanced Installer :
    // sans fenêtre d'abord, avec sa fenêtre si l'installation silencieuse n'aboutit pas
    let run = |args: &str| -> Result<std::process::Output, String> {
        let list = if args.is_empty() { String::new() } else { format!(" -ArgumentList {args}") };
        let script = format!(
            "$p = Start-Process -FilePath '{}'{list} -Verb RunAs -Wait -PassThru; exit $p.ExitCode",
            exe.display().to_string().replace('\'', "''")
        );
        std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
            .creation_flags(0x08000000)
            .output()
            .map_err(|e| e.to_string())
    };
    let refused = |out: &std::process::Output| {
        let err = String::from_utf8_lossy(&out.stderr).to_lowercase();
        err.contains("cancel") || err.contains("annul")
    };
    let mut out = run("'/exenoui','/qn','/norestart'")?;
    if !installed() && !refused(&out) {
        out = run("")?;
    }
    let _ = std::fs::remove_file(&exe);
    if installed() {
        Ok(status())
    } else if refused(&out) {
        Err("installation refusée dans l'invite de Windows".into())
    } else {
        Err(format!("le pilote n'a pas pu être installé (code {})", out.status.code().unwrap_or(-1)))
    }
}

#[cfg(not(windows))]
pub fn install() -> Result<PadDriver, String> {
    Err("Windows uniquement".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_pinned_installer_is_accepted() {
        assert!(verify(b"pas le bon fichier").is_err());
        assert_eq!(SHA256.len(), 64);
    }
}
