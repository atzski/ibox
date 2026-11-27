//! Détection matérielle locale et classification explicable.
//!
//! Le modèle et la classification sont indépendants du système ; seule la
//! collecte l'est : `win.rs` (Windows), `linux.rs` (Linux, SteamOS, Steam
//! Deck ; analyseurs purs compilés aussi pour les tests sur Windows), `android.rs`
//! (propriétés système, docs/SMARTCONFIG.md §16.2). Une information
//! impossible à obtenir reste `None` : rien n'est deviné. Rien ne quitte la
//! machine : la seule vue partageable est `PublicSummary`, présentée à
//! l'utilisateur avant toute contribution (phase 5).

use serde::{Deserialize, Serialize};

#[cfg(windows)]
mod win;

#[cfg(any(target_os = "linux", test))]
pub mod linux;

pub mod android;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInfo {
    pub os: OsInfo,
    pub cpu: CpuInfo,
    pub gpus: Vec<GpuInfo>,
    /// Index dans `gpus` de l'adaptateur principal (premier énuméré par le système).
    pub primary_gpu: Option<usize>,
    pub ram_mb: Option<u64>,
    pub displays: Vec<DisplayInfo>,
    pub apis: GraphicsApis,
    pub device: DeviceType,
    /// Modèle annoncé par le micrologiciel (ex. « ROG Ally RC71L ») : jamais un numéro de série.
    pub device_model: Option<String>,
    /// Android : appareil et puce tels que le système les annonce (comparés aux appareils d'EmuReady).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub android: Option<android::AndroidDevice>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OsInfo {
    /// `windows`, `linux`, `macos`, `android`.
    pub family: String,
    pub version: Option<String>,
    /// `x86_64`, `aarch64`…
    pub arch: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    pub brand: Option<String>,
    pub vendor: Option<String>,
    pub physical_cores: Option<u32>,
    pub threads: Option<u32>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GpuVendor {
    Nvidia,
    Amd,
    Intel,
    Qualcomm,
    Arm,
    Apple,
    Microsoft,
    #[default]
    Other,
}

impl GpuVendor {
    /// Identifiant PCI du constructeur.
    pub fn from_pci(id: u32) -> Self {
        match id {
            0x10DE => GpuVendor::Nvidia,
            0x1002 | 0x1022 => GpuVendor::Amd,
            0x8086 => GpuVendor::Intel,
            0x5143 | 0x4D4F4351 => GpuVendor::Qualcomm,
            0x13B5 => GpuVendor::Arm,
            0x106B => GpuVendor::Apple,
            0x1414 => GpuVendor::Microsoft,
            _ => GpuVendor::Other,
        }
    }

    /// Constructeur d'après un nom de GPU tel qu'écrit par une source ou par
    /// un pilote mobile (« Adreno 740 », « Mali-G710 », « GeForce RTX 3060 »).
    /// Sert à comparer le matériel de référence d'un profil au nôtre ; sur
    /// Android (pas d'ID PCI), ce sera la seule façon de connaître le constructeur.
    pub fn from_name(name: &str) -> Option<Self> {
        let n = name.to_lowercase();
        let has = |words: &[&str]| words.iter().any(|w| n.contains(w));
        Some(if has(&["nvidia", "geforce", "quadro", "rtx ", "gtx "]) {
            GpuVendor::Nvidia
        } else if has(&["amd", "radeon"]) {
            GpuVendor::Amd
        } else if has(&["intel", "iris", "uhd graphics", "arc a", "arc b", "arc(tm)"]) {
            GpuVendor::Intel
        } else if has(&["adreno", "qualcomm", "snapdragon"]) {
            GpuVendor::Qualcomm
        } else if has(&["mali", "immortalis"]) {
            GpuVendor::Arm
        } else if has(&["apple m", "apple gpu"]) {
            GpuVendor::Apple
        } else {
            return None;
        })
    }

    pub fn label(self) -> &'static str {
        match self {
            GpuVendor::Nvidia => "NVIDIA",
            GpuVendor::Amd => "AMD",
            GpuVendor::Intel => "Intel",
            GpuVendor::Qualcomm => "Qualcomm",
            GpuVendor::Arm => "Arm",
            GpuVendor::Apple => "Apple",
            GpuVendor::Microsoft => "Microsoft",
            GpuVendor::Other => "Autre",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub name: String,
    pub vendor: GpuVendor,
    /// Mémoire dédiée annoncée par le pilote. Pour un GPU intégré, ce n'est
    /// qu'une réservation : elle ne mesure pas la puissance.
    pub dedicated_vram_mb: Option<u64>,
    /// `Some(true)` = intégré au processeur ; `None` = indéterminé.
    pub integrated: Option<bool>,
    pub driver_version: Option<String>,
    /// Rendu logiciel (Microsoft Basic Render Driver…).
    pub software: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub width: u32,
    pub height: u32,
    pub refresh_hz: Option<u32>,
    pub primary: bool,
}

/// API graphiques. `None` = non vérifiée (jamais supposée).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphicsApis {
    pub d3d11: Option<bool>,
    pub d3d12: Option<bool>,
    /// Chargeur Vulkan présent : nécessaire, pas suffisant (le pilote décide).
    pub vulkan_loader: Option<bool>,
    pub opengl: Option<bool>,
    pub metal: Option<bool>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceType {
    Desktop,
    Laptop,
    Handheld,
    #[default]
    Unknown,
}

/// Paliers grossiers, utilisés seulement pour pondérer la proximité matérielle.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Tier {
    #[default]
    Unknown,
    Entry,
    Mid,
    High,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareClass {
    pub cpu: Tier,
    pub gpu: Tier,
    /// Raisons lisibles de chaque déduction (affichées dans l'univers SmartConfig).
    pub reasons: Vec<String>,
}

/// Seules informations destinées à être partagées, après aperçu et consentement.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSummary {
    pub os: String,
    pub arch: String,
    pub cpu: Option<String>,
    pub gpu: Option<String>,
    /// Arrondi au Go pour ne pas servir d'empreinte.
    pub ram_gb: Option<u64>,
    pub device: DeviceType,
}

impl HardwareInfo {
    pub fn primary(&self) -> Option<&GpuInfo> {
        self.primary_gpu.and_then(|i| self.gpus.get(i))
    }

    pub fn has_multiple_gpus(&self) -> bool {
        self.gpus.iter().filter(|g| !g.software).count() > 1
    }

    pub fn public_summary(&self) -> PublicSummary {
        PublicSummary {
            os: self.os.family.clone(),
            arch: self.os.arch.clone(),
            cpu: self.cpu.brand.clone(),
            gpu: self.primary().map(|g| g.name.clone()),
            ram_gb: self.ram_mb.map(|m| (m + 512) / 1024),
            device: self.device,
        }
    }
}

/// Détection sur la plateforme courante (lente : DXGI, registre, sysfs) — à appeler hors du fil principal.
pub fn detect() -> HardwareInfo {
    #[cfg(any(windows, target_os = "linux"))]
    {
        #[cfg(windows)]
        let mut hw = win::detect();
        #[cfg(target_os = "linux")]
        let mut hw = linux::detect();
        // console portable reconnue par sa fiche (`platform::identify`) : la Legion Go, par
        // exemple, ne se nomme que « 83E1 » dans `SystemProductName`
        if crate::platform::device().is_some() {
            hw.device = DeviceType::Handheld;
        }
        hw
    }
    // Android : relevé des propriétés système (simulation éventuelle : `commands::hardware_of`)
    #[cfg(target_os = "android")]
    {
        android::detect(None)
    }
    // macOS : aucun collecteur — rien n'est deviné
    #[cfg(not(any(windows, target_os = "linux", target_os = "android")))]
    {
        HardwareInfo { os: OsInfo { family: std::env::consts::OS.into(), version: None, arch: std::env::consts::ARCH.into() }, ..Default::default() }
    }
}

/// Modèles de consoles portables PC reconnus (nom produit du micrologiciel, sans casse).
const HANDHELDS: &[&str] = &["rog ally", "legion go", "steam deck", "jupiter", "galileo", "claw", "ayaneo", "gpd win", "onexplayer", "onexfly", "zotac zone"];

pub fn is_handheld_model(model: &str) -> bool {
    let m = model.to_lowercase();
    HANDHELDS.iter().any(|h| m.contains(h))
}

/// Type d'appareil : modèle de console portable connu, sinon présence d'une
/// batterie (`None` = inconnue). Commun à tous les collecteurs.
pub fn device_type(model: Option<&str>, battery: Option<bool>) -> DeviceType {
    if model.is_some_and(is_handheld_model) {
        return DeviceType::Handheld;
    }
    match battery {
        Some(true) => DeviceType::Laptop,
        Some(false) => DeviceType::Desktop,
        None => DeviceType::Unknown,
    }
}

/// GPU intégré ? Déduction par nom et constructeur (la mémoire dédiée des
/// iGPU varie selon le BIOS et ne permet pas de conclure).
pub fn integrated_guess(vendor: GpuVendor, name: &str) -> Option<bool> {
    let n = name.to_lowercase();
    match vendor {
        GpuVendor::Nvidia => Some(false),
        GpuVendor::Intel => Some(!n.contains("arc a") && !n.contains("arc b") && !n.contains("arc(tm) a") && !n.contains("arc(tm) b")),
        GpuVendor::Amd => {
            let discrete = n.contains(" rx ") || n.contains("rx ") || n.contains("radeon pro") || n.contains("vega 56") || n.contains("vega 64");
            if discrete { Some(false) } else if n.contains("radeon(tm) graphics") || n.contains("radeon graphics") || n.contains("780m") || n.contains("760m") || n.contains("680m") || n.contains("890m") || n.contains("880m") { Some(true) } else { None }
        }
        GpuVendor::Qualcomm | GpuVendor::Arm | GpuVendor::Apple => Some(true),
        _ => None,
    }
}

/// Classification prudente : plusieurs indices croisés, jamais la seule RAM/VRAM.
/// Les seuils sont volontairement larges ; un palier `Unknown` est préférable à un faux.
pub fn classify(hw: &HardwareInfo) -> HardwareClass {
    let mut reasons = Vec::new();
    let cpu = match hw.cpu.threads {
        None => {
            reasons.push("Processeur : nombre de fils inconnu.".into());
            Tier::Unknown
        }
        Some(t) => {
            // les émulateurs de consoles 6e génération s'appuient sur 2–4 fils rapides
            let tier = if t >= 12 { Tier::High } else if t >= 6 { Tier::Mid } else { Tier::Entry };
            reasons.push(format!("Processeur : {t} fils d'exécution ({}).", tier_label(tier)));
            if hw.device == DeviceType::Handheld || hw.device == DeviceType::Laptop {
                reasons.push("Appareil mobile : fréquences limitées par la batterie et la chaleur.".into());
            }
            tier
        }
    };
    let gpu = match hw.primary() {
        None => {
            reasons.push("Carte graphique non détectée.".into());
            Tier::Unknown
        }
        Some(g) if g.software => {
            reasons.push("Rendu logiciel uniquement : pas d'accélération graphique.".into());
            Tier::Entry
        }
        Some(g) => {
            let tier = match (g.integrated, g.vendor, g.dedicated_vram_mb) {
                (Some(true), _, _) if hw.device == DeviceType::Handheld => Tier::Mid,
                (Some(true), _, _) => Tier::Entry,
                (Some(false), _, Some(v)) if v >= 8 * 1024 => Tier::High,
                (Some(false), _, Some(v)) if v >= 4 * 1024 => Tier::Mid,
                (Some(false), _, Some(_)) => Tier::Entry,
                _ => Tier::Unknown,
            };
            let kind = match g.integrated {
                Some(true) => "intégrée",
                Some(false) => "dédiée",
                None => "de type indéterminé",
            };
            reasons.push(format!("Carte graphique {kind} : {} ({}).", g.name, tier_label(tier)));
            tier
        }
    };
    if hw.has_multiple_gpus() {
        reasons.push("Plusieurs cartes graphiques : l'émulateur peut ne pas utiliser la plus puissante.".into());
    }
    HardwareClass { cpu, gpu, reasons }
}

fn tier_label(t: Tier) -> &'static str {
    match t {
        Tier::Unknown => "palier inconnu",
        Tier::Entry => "palier modeste",
        Tier::Mid => "palier intermédiaire",
        Tier::High => "palier élevé",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pc(threads: u32, gpu: &str, vendor: GpuVendor, vram: u64) -> HardwareInfo {
        HardwareInfo {
            os: OsInfo { family: "windows".into(), version: None, arch: "x86_64".into() },
            cpu: CpuInfo { brand: Some("CPU".into()), vendor: None, physical_cores: None, threads: Some(threads) },
            gpus: vec![GpuInfo { name: gpu.into(), vendor, dedicated_vram_mb: Some(vram), integrated: integrated_guess(vendor, gpu), driver_version: None, software: false }],
            primary_gpu: Some(0),
            ram_mb: Some(65_000),
            ..Default::default()
        }
    }

    #[test]
    fn la_ram_et_la_vram_seules_ne_font_pas_un_palier() {
        // iGPU Intel avec une grosse réservation : reste « modeste »
        let c = classify(&pc(16, "Intel(R) UHD Graphics 770", GpuVendor::Intel, 16 * 1024));
        assert_eq!(c.gpu, Tier::Entry);
        assert_eq!(c.cpu, Tier::High);
        // GPU dédié de 12 Go : élevé
        assert_eq!(classify(&pc(8, "NVIDIA GeForce RTX 4070", GpuVendor::Nvidia, 12 * 1024)).gpu, Tier::High);
    }

    #[test]
    fn inconnu_reste_inconnu() {
        let c = classify(&HardwareInfo::default());
        assert_eq!((c.cpu, c.gpu), (Tier::Unknown, Tier::Unknown));
        // GPU AMD au nom non reconnu : type indéterminé → palier inconnu
        assert_eq!(classify(&pc(8, "AMD Radeon Mystery", GpuVendor::Amd, 2048)).gpu, Tier::Unknown);
    }

    #[test]
    fn portables_et_constructeurs() {
        assert!(is_handheld_model("ROG Ally RC71L_RC71L"));
        assert!(is_handheld_model("Jupiter"));
        assert!(!is_handheld_model("B650 AORUS ELITE"));
        assert_eq!(GpuVendor::from_pci(0x10DE), GpuVendor::Nvidia);
        assert_eq!(integrated_guess(GpuVendor::Amd, "AMD Radeon RX 7800 XT"), Some(false));
        assert_eq!(integrated_guess(GpuVendor::Amd, "AMD Radeon(TM) Graphics"), Some(true));
        assert_eq!(integrated_guess(GpuVendor::Intel, "Intel(R) Arc(TM) A770 Graphics"), Some(false));
        assert_eq!(device_type(Some("Steam Deck OLED"), Some(true)), DeviceType::Handheld);
        assert_eq!(device_type(None, Some(true)), DeviceType::Laptop);
        assert_eq!(device_type(Some("B650"), None), DeviceType::Unknown);
    }

    #[test]
    fn constructeur_depuis_le_nom() {
        assert_eq!(GpuVendor::from_name("Adreno 740"), Some(GpuVendor::Qualcomm));
        assert_eq!(GpuVendor::from_name("Mali-G710 MC10"), Some(GpuVendor::Arm));
        assert_eq!(GpuVendor::from_name("NVIDIA GeForce RTX 3060"), Some(GpuVendor::Nvidia));
        assert_eq!(GpuVendor::from_name("AMD Custom GPU 0405"), Some(GpuVendor::Amd));
        assert_eq!(GpuVendor::from_name("Intel(R) UHD Graphics 770"), Some(GpuVendor::Intel));
        assert_eq!(GpuVendor::from_name("PowerVR BXM-8-256"), None);
    }

    #[test]
    fn resume_public_sans_details_identifiants() {
        let mut hw = pc(8, "NVIDIA GeForce RTX 3060", GpuVendor::Nvidia, 12 * 1024);
        hw.device_model = Some("MS-7D25".into());
        hw.ram_mb = Some(32_605);
        let s = hw.public_summary();
        assert_eq!(s.ram_gb, Some(32));
        let json = serde_json::to_string(&s).unwrap();
        assert!(!json.contains("MS-7D25"));
    }
}

/// Détection réelle sur cette machine : `cargo test --lib detection_reelle -- --ignored --nocapture`.
#[cfg(test)]
#[test]
#[ignore]
fn detection_reelle() {
    let hw = detect();
    eprintln!("{}", serde_json::to_string_pretty(&hw).unwrap());
    eprintln!("{:#?}", classify(&hw));
    assert!(hw.cpu.threads.is_some());
}
