//! Consoles Android (docs/ANDROID.md §9) : la puce donne le palier de performance de l'interface,
//! dans le même système que les consoles portables PC (`platform::GpuClass`, `services/device.ts`).
//!
//! La puce se lit dans les propriétés système (`ro.soc.model`, `ro.soc.manufacturer`,
//! `ro.board.platform`, `ro.hardware`), sans lancer `getprop` : `__system_property_get` de la libc
//! d'Android répond sans processus. Une table de puces connues donne la classe ; une puce inconnue
//! reçoit une classe d'après la mémoire, que l'interface affine avec le GPU vu par WebGL
//! (`known: false`). La mémoire plafonne aussi la classe (consoles à 2 ou 3 Go).
//!
//! C'est aussi la seule lecture de l'appareil pour SmartConfig (`smartconfig/hardware/android.rs`) :
//! modèle exact (comparé aux appareils d'EmuReady), puce, GPU (`gpu_model`), pilotes graphiques
//! déclarés et version d'Android.
//!
//! Pur et testable sous Windows ; seule la lecture des propriétés est propre à Android.

use crate::platform::{GpuClass, HandheldDevice};
use serde::Serialize;

/// Ce que le système dit de l'appareil. Jamais de numéro de série.
#[derive(Debug, Clone, Default)]
pub struct AndroidProps {
    pub manufacturer: String,
    pub model: String,
    pub soc_manufacturer: String,
    pub soc_model: String,
    pub board_platform: String,
    pub hardware: String,
    /// Mémoire totale (`/proc/meminfo`), en Mo.
    pub memory_mb: u64,
    /// Pilote Vulkan déclaré par le fabricant (`ro.hardware.vulkan`, « adreno », « mali »), vide sinon.
    pub vulkan: String,
    /// Pilote OpenGL ES (`ro.hardware.egl`).
    pub egl: String,
    /// Version d'Android (`ro.build.version.release`, « 13 ») et niveau d'API (`ro.build.version.sdk`).
    pub release: String,
    pub sdk: String,
}

/// Puce reconnue, exposée à l'interface (Paramètres, diagnostic).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Chip {
    /// Code de la puce tel que le système le donne (`SM8550`, `MT6893`, `T618`, `kona`…).
    pub soc: String,
    /// Nom commercial (`Snapdragon 8 Gen 2`), si la puce est dans la table.
    pub name: Option<&'static str>,
    /// Puce dans la table : la classe vient d'elle. Sinon, classe provisoire d'après la mémoire.
    pub known: bool,
    pub memory_mb: u64,
}

/// Puces connues : (clés reconnues, nom commercial, classe). Clés en minuscules, comparées au code
/// de la puce (`ro.soc.model`) puis à la plateforme (`ro.board.platform`) et au matériel.
///
/// Classes (puissance du GPU, ordre de grandeur) :
/// - `Mid` (≥ 2 TFLOPS : Snapdragon 8 Gen 1 et suivants, Dimensity 9000) : palier `handheld`, tous
///   les effets, 3D affinée, fréquence d'écran élevée permise ;
/// - `Low` (0,8 à 1,5 TFLOPS : Snapdragon 855 à 888, Dimensity 1100 à 8200) : palier `lite`,
///   comme le Steam Deck ;
/// - `Weak` (0,2 à 0,8 : Snapdragon 720G, Dimensity 900, Unisoc T820, Helio G99) : palier `low`,
///   3D allégée à 30 im/s ;
/// - `Minimal` (< 0,2 : Unisoc T618, Helio G85, Snapdragon 6xx, RK3566) : palier `minimal`, vue en
///   jaquettes d'office (la 3D reste possible au choix).
const CHIPS: &[(&[&str], &str, GpuClass)] = &[
    // Qualcomm (code SM…, plateforme)
    (&["sm8750", "sun"], "Snapdragon 8 Elite", GpuClass::Mid),
    (&["sm8650", "pineapple"], "Snapdragon 8 Gen 3", GpuClass::Mid),
    (&["sm8635", "cliffs"], "Snapdragon 8s Gen 3", GpuClass::Mid),
    (&["sm8550", "kalama"], "Snapdragon 8 Gen 2", GpuClass::Mid),
    (&["sm8475", "cape"], "Snapdragon 8+ Gen 1", GpuClass::Mid),
    (&["sm8450", "taro"], "Snapdragon 8 Gen 1", GpuClass::Mid),
    (&["g3x"], "Snapdragon G3x", GpuClass::Mid),
    (&["sm7675", "sm7550", "volcano"], "Snapdragon 7+ Gen 3", GpuClass::Low),
    (&["sm7475", "ukee"], "Snapdragon 7+ Gen 2", GpuClass::Low),
    (&["sm8350", "lahaina"], "Snapdragon 888", GpuClass::Low),
    (&["sm8250", "kona"], "Snapdragon 865 / 870", GpuClass::Low),
    (&["sm8150", "msmnile"], "Snapdragon 855 / 860", GpuClass::Low),
    // AYN Odin (Base, Pro)
    (&["sdm845"], "Snapdragon 845", GpuClass::Low),
    (&["sm7325", "sm7350", "yupik"], "Snapdragon 778G", GpuClass::Low),
    (&["sm7450", "sm6450", "parrot"], "Snapdragon 7 Gen 1 / 6 Gen 1", GpuClass::Weak),
    (&["sm7250", "sm7225", "lito"], "Snapdragon 765G / 750G", GpuClass::Weak),
    (&["sm6350"], "Snapdragon 690", GpuClass::Weak),
    (&["sm7125", "sm7150", "atoll", "sm6150"], "Snapdragon 720G / 730G", GpuClass::Weak),
    (&["sm6375", "sm4350", "holi", "blair"], "Snapdragon 695 / 480", GpuClass::Weak),
    (&["sm6225", "sm6125", "sm6115", "sm4250", "bengal", "khaje", "trinket"], "Snapdragon 6xx", GpuClass::Minimal),
    (&["sdm660", "sdm636", "sdm630", "msm8953", "msm8937", "sdm450", "sdm439"], "Snapdragon 4xx / 6xx", GpuClass::Minimal),
    // MediaTek (code MT…, plateforme)
    (&["mt6991"], "Dimensity 9400", GpuClass::Mid),
    (&["mt6989"], "Dimensity 9300", GpuClass::Mid),
    (&["mt6985"], "Dimensity 9200", GpuClass::Mid),
    (&["mt6983"], "Dimensity 9000", GpuClass::Mid),
    (&["mt6897"], "Dimensity 8300", GpuClass::Low),
    (&["mt6895", "mt6896"], "Dimensity 8100 / 8200", GpuClass::Low),
    (&["mt6893"], "Dimensity 1200", GpuClass::Low),
    (&["mt6891"], "Dimensity 1100", GpuClass::Low),
    (&["mt6886", "mt6878"], "Dimensity 7200 / 7300", GpuClass::Weak),
    (&["mt6877"], "Dimensity 900 / 1080", GpuClass::Weak),
    (&["mt6873", "mt6875", "mt6853", "mt6855"], "Dimensity 800 / 820 / 720", GpuClass::Weak),
    (&["mt6789"], "Helio G99", GpuClass::Weak),
    (&["mt6785"], "Helio G90T / G95", GpuClass::Weak),
    (&["mt6833"], "Dimensity 700", GpuClass::Minimal),
    (&["mt6781", "mt6769", "mt6768", "mt6765", "mt6762", "mt6771"], "Helio G85 / G80 / P60", GpuClass::Minimal),
    // Unisoc (Anbernic, Retroid Pocket 2S / 3+, consoles d'entrée de gamme)
    (&["t820", "t770", "t760", "ums9620"], "Unisoc T820", GpuClass::Weak),
    (&["t618", "t616", "t610", "t606", "t612", "t310", "ums512", "ums9230", "ums312"], "Unisoc T618", GpuClass::Minimal),
    // Samsung, Google
    (&["s5e9945", "s5e9935", "s5e9925"], "Exynos 2200 / 2400", GpuClass::Mid),
    (&["exynos2100", "exynos990"], "Exynos 2100", GpuClass::Low),
    (&["s5e8835", "s5e8825", "exynos1080"], "Exynos 1280 / 1380", GpuClass::Weak),
    (&["zuma", "gs201", "gs101"], "Google Tensor", GpuClass::Low),
    // Rockchip, Amlogic, Allwinner (consoles rétro, boîtiers TV)
    (&["rk3588"], "Rockchip RK3588", GpuClass::Weak),
    (&["rk3566", "rk3568", "rk3399", "rk3326"], "Rockchip RK3566", GpuClass::Minimal),
    (&["s922x", "g12b", "sm1", "s905"], "Amlogic S922X", GpuClass::Minimal),
    (&["h700", "a133", "sun50iw"], "Allwinner H700", GpuClass::Minimal),
];

/// GPU des puces de la table, d'après leur nom commercial (fiches publiques des fondeurs). Les
/// entrées qui regroupent plusieurs puces au GPU différent (« Snapdragon 6xx »…) sont absentes.
const GPUS: &[(&str, &str)] = &[
    ("Snapdragon 8 Elite", "Adreno 830"),
    ("Snapdragon 8 Gen 3", "Adreno 750"),
    ("Snapdragon 8s Gen 3", "Adreno 735"),
    ("Snapdragon 8 Gen 2", "Adreno 740"),
    ("Snapdragon 8+ Gen 1", "Adreno 730"),
    ("Snapdragon 8 Gen 1", "Adreno 730"),
    ("Snapdragon 888", "Adreno 660"),
    ("Snapdragon 865 / 870", "Adreno 650"),
    ("Snapdragon 855 / 860", "Adreno 640"),
    ("Snapdragon 845", "Adreno 630"),
    ("Snapdragon 778G", "Adreno 642L"),
    ("Dimensity 1200", "Mali-G77 MC9"),
    ("Dimensity 1100", "Mali-G77 MC9"),
    ("Helio G99", "Mali-G57 MC2"),
];

/// GPU de l'appareil : modèle exact si la puce est connue, sinon la famille d'après le pilote
/// déclaré (« Adreno », « Mali », « PowerVR ») ; `None` si rien ne le dit.
pub fn gpu_model(p: &AndroidProps) -> Option<String> {
    if let Some(g) = lookup(p).and_then(|(name, _)| GPUS.iter().find(|(n, _)| *n == name)).map(|(_, g)| *g) {
        return Some(g.to_string());
    }
    let driver = format!("{} {}", p.vulkan, p.egl).to_lowercase();
    [("adreno", "Adreno"), ("mali", "Mali"), ("powervr", "PowerVR")].iter().find(|(k, _)| driver.contains(k)).map(|(_, n)| n.to_string())
}

/// Classe d'une puce inconnue, d'après la mémoire : provisoire, l'interface l'affine par WebGL.
pub fn class_from_memory(memory_mb: u64) -> GpuClass {
    match memory_mb {
        m if m >= 11_000 => GpuClass::Low,
        m if m >= 5_500 => GpuClass::Weak,
        _ => GpuClass::Minimal,
    }
}

/// Plafond imposé par la mémoire : 3 Go (et moins) au plus `Weak`, 2 Go `Minimal`. Avec 3 Go, le
/// système, la WebView et l'émulateur lancé ensuite se partagent la mémoire avec les textures.
pub fn memory_cap(memory_mb: u64) -> GpuClass {
    match memory_mb {
        0 => GpuClass::Mid,
        m if m < 2_600 => GpuClass::Minimal,
        m if m < 3_600 => GpuClass::Weak,
        _ => GpuClass::Mid,
    }
}

const fn rank(c: GpuClass) -> u8 {
    match c {
        GpuClass::Minimal => 0,
        GpuClass::Weak => 1,
        GpuClass::Low => 2,
        GpuClass::Mid => 3,
    }
}

/// Puce de la table d'après le code, la plateforme puis le matériel (dans cet ordre).
fn lookup(p: &AndroidProps) -> Option<(&'static str, GpuClass)> {
    let fields = [&p.soc_model, &p.board_platform, &p.hardware];
    for field in fields {
        let v = field.trim().to_lowercase();
        if v.is_empty() {
            continue;
        }
        // code exact d'abord, puis préfixe (« sm8550-ab », « mt6893z », « ums512_1h10 »)
        let hit = CHIPS.iter().find(|(keys, ..)| keys.iter().any(|k| v == *k)).or_else(|| CHIPS.iter().find(|(keys, ..)| keys.iter().any(|k| k.len() >= 4 && v.starts_with(k))));
        if let Some((_, name, class)) = hit {
            return Some((name, *class));
        }
    }
    None
}

/// Émulateur Android (AVD) : `ranchu` / `goldfish`.
pub fn is_emulator(p: &AndroidProps) -> bool {
    let h = p.hardware.to_lowercase();
    h.contains("ranchu") || h.contains("goldfish") || p.board_platform.eq_ignore_ascii_case("ranchu")
}

/// Console Android : nom, puce et classe. Toujours une fiche (une console Android est une
/// console portable) ; sans écran, que l'interface lit elle-même (définition, densité, fréquence).
pub fn identify(p: &AndroidProps) -> HandheldDevice {
    let found = lookup(p);
    let class = found.map(|(_, c)| c).unwrap_or_else(|| class_from_memory(p.memory_mb));
    let cap = memory_cap(p.memory_mb);
    let gpu = if rank(cap) < rank(class) { cap } else { class };
    let soc = [&p.soc_model, &p.board_platform, &p.hardware].into_iter().map(|s| s.trim()).find(|s| !s.is_empty()).unwrap_or("").chars().take(40).collect::<String>();
    let maker = p.manufacturer.trim();
    let model = p.model.trim();
    // « AYN Thor », pas « AYN AYN Thor »
    let name = if is_emulator(p) {
        "Émulateur Android".to_string()
    } else if model.is_empty() {
        "Console Android".to_string()
    } else if maker.is_empty() || model.to_lowercase().starts_with(&maker.to_lowercase()) {
        model.chars().take(60).collect()
    } else {
        format!("{maker} {model}").chars().take(60).collect()
    };
    HandheldDevice {
        id: "android",
        name,
        screen: None,
        gpu,
        chip: Some(Chip { soc, name: found.map(|(n, _)| n), known: found.is_some(), memory_mb: p.memory_mb }),
    }
}

/// Propriété système Android, sans processus (`__system_property_get`).
#[cfg(target_os = "android")]
pub fn system_property(key: &str) -> String {
    let Ok(name) = std::ffi::CString::new(key) else { return String::new() };
    // PROP_VALUE_MAX = 92 octets, zéro final compris
    let mut buf = [0u8; 92];
    // SAFETY: tampon de PROP_VALUE_MAX octets, nom terminé par zéro
    let len = unsafe { libc::__system_property_get(name.as_ptr(), buf.as_mut_ptr().cast()) };
    String::from_utf8_lossy(&buf[..(len.max(0) as usize).min(buf.len())]).trim().to_string()
}

/// Mémoire totale d'après `/proc/meminfo` (`MemTotal: 7845123 kB`), en Mo.
pub fn meminfo_total_mb(text: &str) -> u64 {
    text.lines()
        .find_map(|l| l.strip_prefix("MemTotal:"))
        .and_then(|v| v.split_whitespace().next()?.parse::<u64>().ok())
        .map(|kb| kb / 1024)
        .unwrap_or(0)
}

/// Propriétés de cet appareil (lues une fois par `platform::device`).
#[cfg(target_os = "android")]
pub fn props() -> AndroidProps {
    AndroidProps {
        manufacturer: system_property("ro.product.manufacturer"),
        model: system_property("ro.product.model"),
        soc_manufacturer: system_property("ro.soc.manufacturer"),
        soc_model: system_property("ro.soc.model"),
        board_platform: system_property("ro.board.platform"),
        hardware: system_property("ro.hardware"),
        memory_mb: std::fs::read_to_string("/proc/meminfo").map(|t| meminfo_total_mb(&t)).unwrap_or(0),
        vulkan: system_property("ro.hardware.vulkan"),
        egl: system_property("ro.hardware.egl"),
        release: system_property("ro.build.version.release"),
        sdk: system_property("ro.build.version.sdk"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn props(soc: &str, platform: &str, memory_gb: u64) -> AndroidProps {
        AndroidProps { manufacturer: "AYN".into(), model: "Thor".into(), soc_model: soc.into(), board_platform: platform.into(), memory_mb: memory_gb * 1024 - 300, ..Default::default() }
    }

    #[test]
    fn gpu_de_la_puce_ou_du_pilote() {
        assert_eq!(gpu_model(&props("SM8550", "kalama", 12)).as_deref(), Some("Adreno 740"));
        assert_eq!(gpu_model(&props("SM8250", "kona", 8)).as_deref(), Some("Adreno 650"));
        // puce inconnue : famille d'après le pilote, sinon rien
        assert_eq!(gpu_model(&AndroidProps { soc_model: "X1".into(), vulkan: "adreno".into(), ..Default::default() }).as_deref(), Some("Adreno"));
        assert_eq!(gpu_model(&AndroidProps { hardware: "ranchu".into(), egl: "emulation".into(), ..Default::default() }), None);
        // groupe de puces au GPU différent : pas de modèle inventé
        assert_eq!(gpu_model(&props("SM6115", "bengal", 4)), None);
        // chaque modèle de GPU désigne une puce de la table
        for (name, _) in GPUS {
            assert!(CHIPS.iter().any(|(_, n, _)| n == name), "{name} absente de la table des puces");
        }
    }

    #[test]
    fn puces_connues() {
        let class = |soc: &str, platform: &str, gb: u64| identify(&props(soc, platform, gb)).gpu;
        // haut de gamme : Thor, Odin 2 (8 Gen 2), Odin 3 (8 Elite)
        assert_eq!(class("SM8550", "kalama", 12), GpuClass::Mid);
        assert_eq!(class("SM8750", "sun", 16), GpuClass::Mid);
        assert_eq!(class("", "taro", 8), GpuClass::Mid);
        // milieu : Retroid Pocket 5 / Mini (865), RP4 Pro (Dimensity 1100)
        assert_eq!(class("SM8250", "kona", 8), GpuClass::Low);
        assert_eq!(class("MT6891", "mt6891", 8), GpuClass::Low);
        // modestes : 720G, Dimensity 900, T820
        assert_eq!(class("SM7125", "atoll", 6), GpuClass::Weak);
        assert_eq!(class("MT6877", "mt6877", 8), GpuClass::Weak);
        assert_eq!(class("T820", "ums9620", 8), GpuClass::Weak);
        // entrée de gamme : T618 (RG405M, RP3+), reconnue aussi par sa seule plateforme
        assert_eq!(class("T618", "ums512", 4), GpuClass::Minimal);
        assert_eq!(class("", "ums512", 4), GpuClass::Minimal);
        let thor = identify(&props("SM8550", "kalama", 12));
        assert_eq!(thor.name, "AYN Thor");
        assert_eq!(thor.chip.as_ref().map(|c| (c.name, c.known)), Some((Some("Snapdragon 8 Gen 2"), true)));
    }

    #[test]
    fn variantes_de_codes() {
        // suffixes de révision, casse
        assert_eq!(identify(&props("SM8550-AB", "", 12)).gpu, GpuClass::Mid);
        assert_eq!(identify(&props("", "MT6893Z", 8)).gpu, GpuClass::Low);
        assert_eq!(identify(&AndroidProps { hardware: "ums512_1h10".into(), memory_mb: 4000, ..Default::default() }).gpu, GpuClass::Minimal);
        // « sun » seul ne doit pas reconnaître un « sunxi » d'Allwinner comme un 8 Elite
        assert_eq!(identify(&props("", "sun50iw9", 2)).gpu, GpuClass::Minimal);
    }

    #[test]
    fn memoire_plafonne_la_classe() {
        // 865 avec 3 Go : plafonné à Weak ; 2 Go : Minimal
        assert_eq!(identify(&props("SM8250", "kona", 3)).gpu, GpuClass::Weak);
        assert_eq!(identify(&props("SM8550", "kalama", 2)).gpu, GpuClass::Minimal);
        assert_eq!(identify(&props("SM8550", "kalama", 4)).gpu, GpuClass::Mid);
    }

    #[test]
    fn puce_inconnue() {
        let d = identify(&AndroidProps { manufacturer: "Google".into(), model: "sdk_gphone64_x86_64".into(), hardware: "ranchu".into(), board_platform: "".into(), memory_mb: 3900, ..Default::default() });
        assert_eq!(d.name, "Émulateur Android");
        assert_eq!(d.gpu, GpuClass::Minimal);
        assert!(!d.chip.unwrap().known);
        assert_eq!(identify(&AndroidProps { soc_model: "X1".into(), memory_mb: 12 * 1024, ..Default::default() }).gpu, GpuClass::Low);
        assert_eq!(identify(&AndroidProps { soc_model: "X1".into(), memory_mb: 8 * 1024 - 300, ..Default::default() }).gpu, GpuClass::Weak);
    }

    #[test]
    fn noms() {
        let named = |m: &str, model: &str| identify(&AndroidProps { manufacturer: m.into(), model: model.into(), soc_model: "SM8550".into(), memory_mb: 12_000, ..Default::default() }).name;
        assert_eq!(named("AYN", "Odin2"), "AYN Odin2");
        assert_eq!(named("Retroid", "Retroid Pocket 5"), "Retroid Pocket 5");
        assert_eq!(named("", ""), "Console Android");
    }

    #[test]
    fn memoire_lue() {
        assert_eq!(meminfo_total_mb("MemTotal:        7845124 kB\nMemFree: 1 kB\n"), 7661);
        assert_eq!(meminfo_total_mb(""), 0);
    }
}
