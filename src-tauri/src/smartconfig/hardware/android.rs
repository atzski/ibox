//! Détection matérielle sur Android : modèle, puce, GPU, mémoire, version du système.
//!
//! **Aucune lecture propre à SmartConfig** : tout vient du profil d'appareil commun
//! (`crate::android_chip` : propriétés système lues sans processus, table des puces, GPU), le même
//! qui donne le palier de performance de l'interface. Ce module ne fait que le traduire dans le
//! modèle matériel de SmartConfig (`HardwareInfo`), sans rien deviner.
//!
//! Gardé tel quel pour EmuReady : le fabricant et le modèle **exacts** (`ro.product.manufacturer`,
//! `ro.product.model`), comparés aux appareils des rapports (`providers::emuready::DeviceHint`) ;
//! le nom affiché par le profil commun (« Émulateur Android » dans un AVD) n'y sert pas.
//! Jamais collectés : numéro de série, identifiant Android, comptes.

use super::{CpuInfo, DeviceType, GpuInfo, GpuVendor, GraphicsApis, HardwareInfo, OsInfo};
use crate::android_chip::{self, AndroidProps};
use serde::{Deserialize, Serialize};

/// Ce qu'Android dit de l'appareil, tel quel (affiché, et comparé aux appareils d'EmuReady).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidDevice {
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    /// Code de la puce (`ro.soc.model`, sinon plateforme ou matériel).
    pub soc_code: Option<String>,
    /// Nom commercial de la puce (« Snapdragon 8 Gen 2 »), si elle est dans la table commune.
    pub soc_name: Option<String>,
    pub sdk: Option<u32>,
    /// Relevé simulé (builds de débogage, essais dans l'émulateur du PC).
    #[serde(default)]
    pub simulated: bool,
}

impl AndroidDevice {
    /// Nom à afficher et à comparer : « AYN Thor » (le fabricant n'est pas répété s'il figure déjà dans le modèle).
    pub fn label(&self) -> Option<String> {
        let model = self.model.as_deref()?.trim();
        match self.manufacturer.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
            Some(m) if !model.to_lowercase().starts_with(&m.to_lowercase()) => Some(format!("{m} {model}")),
            _ => Some(model.to_string()),
        }
    }
}

/// Profil commun de l'appareil, plus ce que le profil ne porte pas (fils, architecture).
#[derive(Debug, Clone, Default)]
pub struct Snapshot {
    pub props: AndroidProps,
    pub threads: Option<u32>,
    pub arch: String,
    pub simulated: bool,
}

/// Fabricants et modèles de consoles portables Android connus (sans casse).
const HANDHELD_MAKERS: &[&str] = &["ayn", "retroid", "ayaneo", "anbernic", "powkiddy", "abxylute", "gpd", "miyoo"];
const HANDHELD_MODELS: &[&str] = &["odin", "thor", "retroid pocket", "g cloud", "razer edge", "ayaneo pocket"];

pub fn is_handheld(manufacturer: Option<&str>, model: Option<&str>) -> bool {
    let maker = manufacturer.unwrap_or_default().to_lowercase();
    let model = model.unwrap_or_default().to_lowercase();
    HANDHELD_MAKERS.iter().any(|m| maker == *m || maker.starts_with(&format!("{m} "))) || HANDHELD_MODELS.iter().any(|m| model.contains(m))
}

fn some(v: &str) -> Option<String> {
    let v = v.trim();
    (!v.is_empty()).then(|| v.chars().take(80).collect())
}

/// Traduction du profil commun (pure, testée sous Windows).
pub fn from_snapshot(s: &Snapshot) -> HardwareInfo {
    let p = &s.props;
    let chip = android_chip::identify(p).chip.unwrap_or_else(|| android_chip::Chip { soc: String::new(), name: None, known: false, memory_mb: p.memory_mb });
    let sdk = p.sdk.trim().parse().ok();
    let device = AndroidDevice {
        manufacturer: some(&p.manufacturer),
        model: some(&p.model),
        soc_code: some(&chip.soc),
        soc_name: chip.name.map(str::to_string),
        sdk,
        simulated: s.simulated,
    };
    let gpus: Vec<GpuInfo> = android_chip::gpu_model(p)
        .map(|name| vec![GpuInfo { integrated: Some(true), vendor: GpuVendor::from_name(&name).unwrap_or_default(), name, dedicated_vram_mb: None, driver_version: None, software: false }])
        .unwrap_or_default();
    let version = match (some(&p.release), sdk) {
        (Some(r), Some(n)) => Some(format!("Android {r} (API {n})")),
        (Some(r), None) => Some(format!("Android {r}")),
        (None, Some(n)) => Some(format!("API {n}")),
        (None, None) => None,
    };
    let soc_vendor = some(&p.soc_manufacturer).map(|v| if v.eq_ignore_ascii_case("QTI") { "Qualcomm".to_string() } else { v });
    let handheld = is_handheld(device.manufacturer.as_deref(), device.model.as_deref());
    HardwareInfo {
        os: OsInfo { family: "android".into(), version, arch: s.arch.clone() },
        cpu: CpuInfo { brand: device.soc_name.clone().or(device.soc_code.clone()), vendor: soc_vendor, physical_cores: None, threads: s.threads },
        primary_gpu: (!gpus.is_empty()).then_some(0),
        gpus,
        ram_mb: (p.memory_mb > 0).then_some(p.memory_mb),
        displays: Vec::new(),
        apis: GraphicsApis {
            // un pilote Vulkan déclaré par le fabricant (`ro.hardware.vulkan`) ; sans lui, inconnu
            vulkan_loader: some(&p.vulkan).map(|_| true),
            // OpenGL ES est exigé de tout appareil Android (Android CDD, § 7.1.4.1)
            opengl: Some(true),
            d3d11: Some(false),
            d3d12: Some(false),
            metal: Some(false),
        },
        device: if handheld { DeviceType::Handheld } else { DeviceType::Unknown },
        device_model: device.label(),
        android: Some(device),
    }
}

/// Relevé simulé (`clé=valeur` par ligne, noms des propriétés Android, plus `arch`, `threads`,
/// `ram_mb`) : sert aux essais dans l'émulateur Android du PC, builds de débogage seulement.
pub fn parse_simulation(text: &str) -> Snapshot {
    let mut s = Snapshot { simulated: true, arch: std::env::consts::ARCH.into(), ..Default::default() };
    for line in text.lines() {
        let Some((k, v)) = line.split_once('=') else { continue };
        let v: String = v.trim().chars().take(80).collect();
        let p = &mut s.props;
        match k.trim() {
            "arch" => s.arch = v,
            "threads" => s.threads = v.parse().ok(),
            "ram_mb" => p.memory_mb = v.parse().unwrap_or(0),
            "ro.product.manufacturer" => p.manufacturer = v,
            "ro.product.model" => p.model = v,
            "ro.soc.manufacturer" => p.soc_manufacturer = v,
            "ro.soc.model" => p.soc_model = v,
            "ro.board.platform" => p.board_platform = v,
            "ro.hardware" => p.hardware = v,
            "ro.hardware.vulkan" => p.vulkan = v,
            "ro.hardware.egl" => p.egl = v,
            "ro.build.version.release" => p.release = v,
            "ro.build.version.sdk" => p.sdk = v,
            _ => {}
        }
    }
    s
}

/// Relevé de l'appareil : le profil commun (`android_chip::props`), ou le relevé simulé (débogage).
#[cfg(target_os = "android")]
pub fn read(simulation: Option<&str>) -> Snapshot {
    #[cfg(debug_assertions)]
    if let Some(text) = simulation {
        return parse_simulation(text);
    }
    let _ = simulation;
    Snapshot {
        props: android_chip::props(),
        threads: std::thread::available_parallelism().ok().map(|n| n.get() as u32),
        arch: std::env::consts::ARCH.into(),
        simulated: false,
    }
}

#[cfg(target_os = "android")]
pub fn detect(simulation: Option<&str>) -> HardwareInfo {
    from_snapshot(&read(simulation))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(p: AndroidProps) -> Snapshot {
        Snapshot { props: p, threads: Some(8), arch: "aarch64".into(), simulated: false }
    }

    fn thor() -> AndroidProps {
        AndroidProps {
            manufacturer: "AYN".into(),
            model: "AYN Thor".into(),
            soc_manufacturer: "QTI".into(),
            soc_model: "SM8550".into(),
            board_platform: "kalama".into(),
            vulkan: "adreno".into(),
            release: "13".into(),
            sdk: "33".into(),
            memory_mb: 11_534,
            ..Default::default()
        }
    }

    #[test]
    fn thor_reconnue() {
        let hw = from_snapshot(&snap(thor()));
        assert_eq!(hw.os.family, "android");
        assert_eq!(hw.os.version.as_deref(), Some("Android 13 (API 33)"));
        assert_eq!(hw.device_model.as_deref(), Some("AYN Thor"));
        assert_eq!(hw.device, DeviceType::Handheld);
        assert_eq!(hw.cpu.brand.as_deref(), Some("Snapdragon 8 Gen 2"));
        assert_eq!(hw.cpu.vendor.as_deref(), Some("Qualcomm"));
        let g = hw.primary().unwrap();
        assert_eq!((g.name.as_str(), g.vendor, g.integrated), ("Adreno 740", GpuVendor::Qualcomm, Some(true)));
        assert_eq!(hw.apis.vulkan_loader, Some(true));
        assert_eq!(hw.ram_mb, Some(11_534));
        assert_eq!(hw.android.as_ref().unwrap().soc_code.as_deref(), Some("SM8550"));
        // même puce, même nom que le palier de performance de l'interface (une seule table)
        assert_eq!(android_chip::identify(&thor()).chip.unwrap().name, Some("Snapdragon 8 Gen 2"));
        // APU de console portable → intermédiaire
        let rp5 = AndroidProps { manufacturer: "Retroid".into(), model: "Retroid Pocket 5".into(), soc_model: "SM8250".into(), ..Default::default() };
        assert_eq!(super::super::classify(&from_snapshot(&snap(rp5))).gpu, super::super::Tier::Mid);
    }

    #[test]
    fn rien_n_est_devine() {
        // AVD : le profil commun l'appelle « Émulateur Android », SmartConfig garde le modèle exact
        let avd = AndroidProps { manufacturer: "Google".into(), model: "sdk_gphone64_x86_64".into(), hardware: "ranchu".into(), egl: "emulation".into(), ..Default::default() };
        let hw = from_snapshot(&snap(avd));
        assert_eq!(hw.device_model.as_deref(), Some("Google sdk_gphone64_x86_64"));
        assert_eq!(hw.cpu.brand.as_deref(), Some("ranchu"));
        assert!(hw.gpus.is_empty());
        assert_eq!(hw.apis.vulkan_loader, None);
        assert_eq!(hw.ram_mb, None);
        assert_eq!(hw.device, DeviceType::Unknown);
        // puce inconnue, pilote Adreno déclaré : constructeur seulement
        let hw = from_snapshot(&snap(AndroidProps { soc_model: "SM9999".into(), vulkan: "adreno".into(), ..Default::default() }));
        assert_eq!(hw.primary().unwrap().name, "Adreno");
        assert_eq!(hw.primary().unwrap().vendor, GpuVendor::Qualcomm);
        assert_eq!(hw.android.unwrap().soc_name, None);
    }

    #[test]
    fn libelle_et_simulation() {
        let d = |m: &str, model: &str| AndroidDevice { manufacturer: Some(m.into()), model: Some(model.into()), ..Default::default() }.label();
        assert_eq!(d("AYN", "Odin2").as_deref(), Some("AYN Odin2"));
        assert_eq!(d("Retroid", "Retroid Pocket 5").as_deref(), Some("Retroid Pocket 5"));
        let s = parse_simulation("ro.product.manufacturer=AYN\nro.product.model=Thor\nro.soc.model=SM8550\nro.hardware.vulkan=adreno\narch=aarch64\nthreads=8\nram_mb=12288\nautre=x\n");
        let hw = from_snapshot(&s);
        assert!(hw.android.as_ref().unwrap().simulated);
        assert_eq!(hw.os.arch, "aarch64");
        assert_eq!(hw.ram_mb, Some(12_288));
        assert_eq!(hw.device_model.as_deref(), Some("AYN Thor"));
        assert_eq!(hw.primary().unwrap().name, "Adreno 740");
        assert!(is_handheld(Some("Logitech"), Some("G Cloud")));
        assert!(!is_handheld(Some("samsung"), Some("SM-S918B")));
    }
}
