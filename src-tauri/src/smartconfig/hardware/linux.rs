//! Collecte Linux / SteamOS / Steam Deck (préparation du portage, phase 6).
//!
//! Tout passe par des fichiers texte du noyau et du système, lus en
//! **lecture seule** sous une racine (`/` en production, un dossier de test
//! ailleurs) : les analyseurs sont des fonctions pures, testées sur Windows.
//!
//! | Donnée | Source |
//! |---|---|
//! | Processeur, cœurs, fils | `/proc/cpuinfo` (`model name`, `vendor_id`, `processor`, `physical id`/`core id`) |
//! | RAM | `/proc/meminfo` (`MemTotal`) |
//! | GPU | `/sys/class/drm/cardN/device/{vendor,device}` (ID PCI), `mem_info_vram_total` (amdgpu) |
//! | Modèle d'appareil | DMI `/sys/class/dmi/id/{sys_vendor,product_name}` (Valve `Jupiter` = Steam Deck LCD, `Galileo` = Steam Deck OLED) |
//! | Système | `/etc/os-release` (`ID=steamos` pour SteamOS) |
//! | Batterie | `/sys/class/power_supply/*/type` |
//! | Vulkan | chargeur `libvulkan.so.1` dans les dossiers de bibliothèques usuels |
//!
//! Non collectés (jamais supposés) : nom commercial du GPU (il faudrait la base
//! `pci.ids` ou un contexte graphique), version du pilote, écran, OpenGL.
//! Direct3D et Metal n'existent pas sous Linux : `Some(false)`, ce qui fait
//! refuser par la validation tout moteur de rendu D3D reçu d'une source.

use super::*;
use std::path::Path;

/// Steam Deck reconnu par son modèle DMI (fabricant Valve).
pub fn steam_deck_model(sys_vendor: &str, product_name: &str) -> Option<&'static str> {
    if !sys_vendor.trim().eq_ignore_ascii_case("valve") {
        return None;
    }
    match product_name.trim() {
        "Jupiter" => Some("Steam Deck (LCD)"),
        "Galileo" => Some("Steam Deck OLED"),
        _ => None,
    }
}

/// Champs utiles de `/etc/os-release` (format `CLE=valeur`, guillemets facultatifs).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct OsRelease {
    pub id: Option<String>,
    pub id_like: Vec<String>,
    pub pretty_name: Option<String>,
    pub version_id: Option<String>,
}

impl OsRelease {
    pub fn is_steamos(&self) -> bool {
        self.id.as_deref() == Some("steamos")
    }
}

pub fn parse_os_release(text: &str) -> OsRelease {
    let mut out = OsRelease::default();
    for line in text.lines() {
        let Some((k, v)) = line.trim().split_once('=') else { continue };
        let v = v.trim().trim_matches('"').trim_matches('\'').trim();
        if v.is_empty() {
            continue;
        }
        match k.trim() {
            "ID" => out.id = Some(v.to_ascii_lowercase()),
            "ID_LIKE" => out.id_like = v.split_whitespace().map(str::to_ascii_lowercase).collect(),
            "PRETTY_NAME" => out.pretty_name = Some(v.chars().take(80).collect()),
            "VERSION_ID" => out.version_id = Some(v.chars().take(40).collect()),
            _ => {}
        }
    }
    out
}

/// `/proc/cpuinfo` → processeur. Fils = nombre d'entrées `processor` ; cœurs
/// physiques = paires (`physical id`, `core id`) distinctes, inconnus si le
/// noyau ne les publie pas (certains processeurs ARM).
pub fn parse_cpuinfo(text: &str) -> CpuInfo {
    let mut cpu = CpuInfo::default();
    let mut threads = 0u32;
    let mut cores = std::collections::BTreeSet::new();
    let (mut phys, mut core): (Option<String>, Option<String>) = (None, None);
    let mut flush = |phys: &mut Option<String>, core: &mut Option<String>| {
        if let (Some(p), Some(c)) = (phys.take(), core.take()) {
            cores.insert((p, c));
        }
    };
    for line in text.lines() {
        if line.trim().is_empty() {
            flush(&mut phys, &mut core);
            continue;
        }
        let Some((k, v)) = line.split_once(':') else { continue };
        let (k, v) = (k.trim(), v.trim());
        match k {
            "processor" => threads += 1,
            "model name" | "Model" if cpu.brand.is_none() && !v.is_empty() => cpu.brand = Some(v.chars().take(120).collect()),
            "vendor_id" | "CPU implementer" if cpu.vendor.is_none() && !v.is_empty() => cpu.vendor = Some(v.chars().take(40).collect()),
            "physical id" => phys = Some(v.to_string()),
            "core id" => core = Some(v.to_string()),
            _ => {}
        }
    }
    flush(&mut phys, &mut core);
    cpu.threads = (threads > 0).then_some(threads);
    cpu.physical_cores = (!cores.is_empty()).then_some(cores.len() as u32);
    cpu
}

/// `/proc/meminfo` → RAM totale en Mo.
pub fn parse_meminfo(text: &str) -> Option<u64> {
    let line = text.lines().find(|l| l.starts_with("MemTotal:"))?;
    let kb: u64 = line["MemTotal:".len()..].trim().trim_end_matches("kB").trim().parse().ok()?;
    (kb > 0).then_some(kb / 1024)
}

/// Identifiant PCI tel qu'écrit dans sysfs (`0x1002`).
pub fn parse_pci_id(text: &str) -> Option<u32> {
    u32::from_str_radix(text.trim().trim_start_matches("0x").trim_start_matches("0X"), 16).ok()
}

fn read(root: &Path, rel: &str) -> Option<String> {
    std::fs::read_to_string(root.join(rel)).ok()
}

/// GPU exposés par DRM : uniquement les nœuds `cardN` (les connecteurs
/// `cardN-eDP-1` sont ignorés), dans l'ordre des numéros.
fn gpus(root: &Path) -> Vec<GpuInfo> {
    let Ok(entries) = std::fs::read_dir(root.join("sys/class/drm")) else { return Vec::new() };
    let mut cards: Vec<(u32, std::path::PathBuf)> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let n: u32 = name.strip_prefix("card")?.parse().ok()?;
            Some((n, e.path().join("device")))
        })
        .collect();
    cards.sort();
    let mut out = Vec::new();
    for (_, dev) in cards {
        let Some(vendor_id) = std::fs::read_to_string(dev.join("vendor")).ok().as_deref().and_then(parse_pci_id) else { continue };
        let device_id = std::fs::read_to_string(dev.join("device")).ok().as_deref().and_then(parse_pci_id);
        let vendor = GpuVendor::from_pci(vendor_id);
        // nom factuel : constructeur + identifiants PCI (aucun nom commercial deviné)
        let name = match device_id {
            Some(d) => format!("{} GPU [{vendor_id:04x}:{d:04x}]", vendor.label()),
            None => format!("{} GPU [{vendor_id:04x}]", vendor.label()),
        };
        // amdgpu publie la mémoire vidéo ; pour un GPU intégré c'est une réservation
        let vram = std::fs::read_to_string(dev.join("mem_info_vram_total")).ok().and_then(|t| t.trim().parse::<u64>().ok()).map(|b| b / (1024 * 1024)).filter(|m| *m > 0);
        if !out.iter().any(|g: &GpuInfo| g.name == name) {
            out.push(GpuInfo { name, vendor, dedicated_vram_mb: vram, integrated: None, driver_version: None, software: false });
        }
    }
    out
}

fn has_battery(root: &Path) -> Option<bool> {
    let entries = std::fs::read_dir(root.join("sys/class/power_supply")).ok()?;
    Some(entries.flatten().any(|e| std::fs::read_to_string(e.path().join("type")).is_ok_and(|t| t.trim() == "Battery")))
}

const LIB_DIRS: &[&str] = &["usr/lib", "usr/lib64", "usr/lib/x86_64-linux-gnu", "usr/lib/aarch64-linux-gnu", "lib", "lib64"];

/// Détection sous la racine `root` (lecture seule).
pub fn detect_at(root: &Path) -> HardwareInfo {
    let release = read(root, "etc/os-release").map(|t| parse_os_release(&t)).unwrap_or_default();
    let mut hw = HardwareInfo {
        os: OsInfo { family: "linux".into(), version: release.pretty_name.clone(), arch: std::env::consts::ARCH.into() },
        cpu: read(root, "proc/cpuinfo").map(|t| parse_cpuinfo(&t)).unwrap_or_default(),
        ram_mb: read(root, "proc/meminfo").and_then(|t| parse_meminfo(&t)),
        gpus: gpus(root),
        ..Default::default()
    };
    let sys_vendor = read(root, "sys/class/dmi/id/sys_vendor").unwrap_or_default();
    let product = read(root, "sys/class/dmi/id/product_name").unwrap_or_default();
    let deck = steam_deck_model(&sys_vendor, &product);
    hw.device_model = deck.map(str::to_string).or_else(|| {
        let p = product.trim();
        let generic = ["", "System Product Name", "To be filled by O.E.M.", "Default string"];
        (!generic.contains(&p)).then(|| p.chars().take(80).collect())
    });
    if deck.is_some() {
        // APU AMD du Steam Deck : GPU intégré, connu par le modèle et non deviné
        for g in hw.gpus.iter_mut().filter(|g| g.vendor == GpuVendor::Amd) {
            g.integrated = Some(true);
        }
    }
    hw.primary_gpu = (!hw.gpus.is_empty()).then_some(0);
    hw.apis = GraphicsApis {
        d3d11: Some(false),
        d3d12: Some(false),
        // trouvé = présent ; non trouvé = inconnu (autres dispositions, Flatpak, Nix…)
        vulkan_loader: LIB_DIRS.iter().any(|d| root.join(d).join("libvulkan.so.1").exists()).then_some(true),
        opengl: None,
        metal: Some(false),
    };
    hw.device = device_type(hw.device_model.as_deref(), has_battery(root));
    hw
}

/// Détection sur la machine Linux courante.
#[cfg(target_os = "linux")]
pub fn detect() -> HardwareInfo {
    detect_at(Path::new("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DECK_CPUINFO: &str = "processor\t: 0\nvendor_id\t: AuthenticAMD\nmodel name\t: AMD Custom APU 0405\nphysical id\t: 0\ncore id\t\t: 0\n\nprocessor\t: 1\nvendor_id\t: AuthenticAMD\nmodel name\t: AMD Custom APU 0405\nphysical id\t: 0\ncore id\t\t: 0\n\nprocessor\t: 2\nphysical id\t: 0\ncore id\t\t: 1\n\nprocessor\t: 3\nphysical id\t: 0\ncore id\t\t: 1\n";

    #[test]
    fn analyseurs_purs() {
        let cpu = parse_cpuinfo(DECK_CPUINFO);
        assert_eq!(cpu.brand.as_deref(), Some("AMD Custom APU 0405"));
        assert_eq!(cpu.vendor.as_deref(), Some("AuthenticAMD"));
        assert_eq!((cpu.threads, cpu.physical_cores), (Some(4), Some(2)));
        // ARM sans « physical id » : cœurs inconnus, pas devinés
        let arm = parse_cpuinfo("processor\t: 0\nCPU implementer\t: 0x41\n\nprocessor\t: 1\n");
        assert_eq!((arm.threads, arm.physical_cores), (Some(2), None));

        assert_eq!(parse_meminfo("MemTotal:       16033112 kB\nMemFree: 1 kB\n"), Some(15657));
        assert_eq!(parse_meminfo("MemFree: 1 kB"), None);
        assert_eq!(parse_pci_id("0x1002\n"), Some(0x1002));
        assert_eq!(parse_pci_id("zz"), None);

        let r = parse_os_release("NAME=\"SteamOS\"\nPRETTY_NAME=\"SteamOS\"\nID=steamos\nID_LIKE=arch\nVERSION_ID=3.6.19\n");
        assert!(r.is_steamos());
        assert_eq!(r.id_like, vec!["arch".to_string()]);
        assert!(!parse_os_release("ID=ubuntu\nID_LIKE=debian").is_steamos());

        assert_eq!(steam_deck_model("Valve\n", "Jupiter\n"), Some("Steam Deck (LCD)"));
        assert_eq!(steam_deck_model("Valve", "Galileo"), Some("Steam Deck OLED"));
        assert_eq!(steam_deck_model("Other", "Jupiter"), None);
    }

    fn put(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    #[test]
    fn steam_deck_complet_depuis_une_arborescence() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        put(r, "proc/cpuinfo", DECK_CPUINFO);
        put(r, "proc/meminfo", "MemTotal:       16033112 kB\n");
        put(r, "etc/os-release", "PRETTY_NAME=\"SteamOS\"\nID=steamos\n");
        put(r, "sys/class/dmi/id/sys_vendor", "Valve\n");
        put(r, "sys/class/dmi/id/product_name", "Galileo\n");
        put(r, "sys/class/drm/card0/device/vendor", "0x1002\n");
        put(r, "sys/class/drm/card0/device/device", "0x1435\n");
        put(r, "sys/class/drm/card0-eDP-1/status", "connected\n");
        put(r, "sys/class/power_supply/BAT1/type", "Battery\n");
        put(r, "usr/lib/libvulkan.so.1", "");
        let hw = detect_at(r);
        assert_eq!(hw.os.family, "linux");
        assert_eq!(hw.os.version.as_deref(), Some("SteamOS"));
        assert_eq!(hw.device_model.as_deref(), Some("Steam Deck OLED"));
        assert_eq!(hw.device, DeviceType::Handheld);
        assert_eq!(hw.gpus.len(), 1);
        assert_eq!(hw.gpus[0].vendor, GpuVendor::Amd);
        assert_eq!(hw.gpus[0].name, "AMD GPU [1002:1435]");
        assert_eq!(hw.gpus[0].integrated, Some(true));
        assert_eq!(hw.apis.vulkan_loader, Some(true));
        assert_eq!(hw.apis.d3d11, Some(false));
        assert_eq!(classify(&hw).gpu, Tier::Mid);
    }

    #[test]
    fn arborescence_vide_rien_de_suppose() {
        let dir = tempfile::tempdir().unwrap();
        let hw = detect_at(dir.path());
        assert_eq!(hw.cpu, CpuInfo::default());
        assert!(hw.gpus.is_empty() && hw.primary_gpu.is_none() && hw.ram_mb.is_none());
        assert_eq!(hw.apis.vulkan_loader, None);
        assert_eq!(hw.device, DeviceType::Unknown);
    }
}
