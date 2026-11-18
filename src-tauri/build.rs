fn main() {
    screenscraper_dev();
    tauri_build::build()
}

/// Identifiants développeur ScreenScraper : fournis au moment de la compilation
/// (`IBOX_SS_DEVID`, `IBOX_SS_DEVPASSWORD`, posés par scripts/release.ps1),
/// jamais présents dans les sources. Ils sont brouillés pour ne pas apparaître
/// en clair dans l'exécutable. Sans eux, la source ScreenScraper est indisponible.
fn screenscraper_dev() {
    println!("cargo:rerun-if-env-changed=IBOX_SS_DEVID");
    println!("cargo:rerun-if-env-changed=IBOX_SS_DEVPASSWORD");
    let id = std::env::var("IBOX_SS_DEVID").unwrap_or_default();
    let pw = std::env::var("IBOX_SS_DEVPASSWORD").unwrap_or_default();
    let packed = if id.trim().is_empty() || pw.trim().is_empty() {
        String::new()
    } else {
        let plain = format!("{}\n{}", id.trim(), pw.trim());
        plain
            .bytes()
            .enumerate()
            .map(|(i, b)| format!("{:02x}", b ^ MASK[i % MASK.len()]))
            .collect()
    };
    println!("cargo:rustc-env=IBOX_SS_DEV_PACKED={packed}");
}

// Doit rester identique à `manuals::screenscraper::MASK`.
const MASK: &[u8] = b"iBox-carnets-7f3a";
