//! SmartConfig sur Android (docs/SMARTCONFIG.md §16.2).
//!
//! L'émulateur d'un jeu est celui que le lanceur Android choisira (`launcher/android_table.rs`,
//! table d'ES-DE, préférence par console) : SmartConfig suit la même règle, en lecture seule.
//!
//! Deux façons d'appliquer, selon ce qu'Android permet :
//!
//! - **RetroArch** : iBox écrit un fichier de configuration par jeu dans **son** dossier du
//!   stockage partagé (`/storage/emulated/0/iBox/SmartConfig/RetroArch/<jeu>.cfg`) et le passe au
//!   lancement à la place de la configuration principale, par l'extra d'intent `CONFIGFILE`
//!   (seul extra de configuration lu par RetroArch Android : `frontend_unix_get_env`,
//!   `frontend/drivers/platform_unix.c`, v1.22.2 ; il n'existe pas d'équivalent Android de
//!   `--appendconfig`, l'activité appelant `rarch_main` avec un seul argument). Le fichier
//!   reprend la configuration principale par `#include` **en dernière ligne** : dans
//!   `libretro-common/file/config_file.c`, une clé déjà présente l'emporte sur celle d'un fichier
//!   inclus (la table de hachage garde la première entrée), les entrées incluses sont marquées
//!   `readonly` et ne sont pas réécrites à l'enregistrement, et `config_file_dump` replace les
//!   `#include` après les entrées. La configuration principale de l'utilisateur n'est jamais
//!   modifiée (elle est d'ailleurs dans `Android/data`, inaccessible aux autres applications
//!   depuis Android 11).
//! - **Émulateurs autonomes** (Dolphin, NetherSX2, DuckStation, PPSSPP, Azahar…) : leurs
//!   réglages sont dans `Android/data/<paquet>` ou dans un dossier choisi par l'utilisateur
//!   dans l'émulateur, qu'iBox ne peut ni connaître ni écrire de façon documentée. SmartConfig
//!   présente une **fiche** des réglages recommandés, à appliquer à la main, avec ce qui reste à
//!   faire coché (`Sheet`, `sheet_save`), journalisée dans `sc_applications`.

use super::adapters::retroarch::RetroArch;
use super::adapters::{Adapter, Change, Install, KeyContext, Location};
use super::model::{GameQuery, Setting};
use super::validation::{Kind, Risk, SettingSpec};
use std::path::{Path, PathBuf};

/// Racine du stockage partagé (même valeur que `%EXTERNALDATA%` du lanceur).
pub const EXTERNAL: &str = "/storage/emulated/0";
/// Dossier d'iBox pour les fichiers de configuration passés à RetroArch.
pub const RETROARCH_DIR: &str = "/storage/emulated/0/iBox/SmartConfig/RetroArch";

/// Un émulateur Android connu de SmartConfig.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Emulator {
    /// Clé ES-DE (`%EMULATOR_X%` de la table du lanceur).
    pub key: &'static str,
    /// Identifiant SmartConfig : `retroarch` (application par fichier), `android.*` (fiche).
    pub id: &'static str,
    pub name: &'static str,
    /// Noms chez EmuReady (`emulators.get`, relevé le 2026-11-27).
    pub emuready: &'static [&'static str],
    /// Consoles iBox pour lesquelles EmuReady a des rapports de cet émulateur.
    pub platforms: &'static [&'static str],
}

impl Emulator {
    pub fn manual(&self) -> bool {
        self.id != "retroarch"
    }
}

const fn emu(key: &'static str, id: &'static str, name: &'static str, emuready: &'static [&'static str], platforms: &'static [&'static str]) -> Emulator {
    Emulator { key, id, name, emuready, platforms }
}

/// Émulateurs Android couverts. Les consoles suivent les systèmes qu'EmuReady rattache à chaque
/// émulateur (RetroArch : N64, DS, PSP, PS1 seulement).
pub const EMULATORS: &[Emulator] = &[
    emu("RETROARCH", "retroarch", "RetroArch", &["RetroArch"], &["ps1", "n64", "ds", "psp"]),
    emu("DOLPHIN", "android.dolphin", "Dolphin", &["Dolphin"], &["gamecube", "wii"]),
    emu("DOLPHIN-MMJR", "android.dolphin", "Dolphin", &["Dolphin"], &["gamecube", "wii"]),
    emu("DOLPHIN-MMJR2", "android.dolphin", "Dolphin", &["Dolphin"], &["gamecube", "wii"]),
    emu("NETHERSX2", "android.nethersx2", "NetherSX2", &["NethersX2", "AetherSX2"], &["ps2"]),
    emu("NETHERSX2-TURNIP", "android.nethersx2", "NetherSX2", &["NethersX2", "AetherSX2"], &["ps2"]),
    emu("NETHERSX2-TURNIP-CLASSIC", "android.nethersx2", "NetherSX2", &["NethersX2", "AetherSX2"], &["ps2"]),
    emu("ARMSX2", "android.armsx2", "ARMSX2", &["ARMSX2"], &["ps2"]),
    emu("DUCKSTATION", "android.duckstation", "DuckStation", &["DuckStation"], &["ps1"]),
    emu("PPSSPP", "android.ppsspp", "PPSSPP", &["PPSSPP"], &["psp"]),
    emu("AZAHAR", "android.azahar", "Azahar", &["Azahar"], &["3ds"]),
    emu("LIME3DS", "android.lime3ds", "Lime3DS", &["Lime3DS"], &["3ds"]),
    emu("CITRA", "android.citra", "Citra", &["Citra"], &["3ds"]),
    emu("EDEN", "android.eden", "Eden", &["Eden"], &["switch"]),
    emu("EDEN-NIGHTLY", "android.eden", "Eden", &["Eden"], &["switch"]),
    emu("MELONDS", "android.melonds", "melonDS", &["melonDS"], &["ds"]),
    emu("DRASTIC", "android.drastic", "DraStic", &["DraStic"], &["ds"]),
    emu("FLYCAST", "android.flycast", "Flycast", &["Flycast"], &["dreamcast"]),
    emu("REDREAM", "android.redream", "Redream", &["Redream"], &["dreamcast"]),
    emu("CEMU", "android.cemu", "Cemu", &["Cemu"], &["wiiu"]),
    emu("APS3E", "android.aps3e", "aPS3e", &["aPS3e"], &["ps3"]),
    emu("YABASANSHIRO-2", "android.yabasanshiro", "Yaba Sanshiro", &["Yaba Sanshiro"], &["saturn"]),
];

pub fn emulator(es_key: &str) -> Option<&'static Emulator> {
    EMULATORS.iter().find(|e| e.key == es_key)
}

pub fn by_id(id: &str) -> Option<&'static Emulator> {
    EMULATORS.iter().find(|e| e.id == id)
}

/// Console iBox → système EmuReady (consoles des émulateurs Android ci-dessus).
pub fn system_key(platform: &str) -> Option<&'static str> {
    if let Some(k) = super::providers::emuready::system_key(platform) {
        return Some(k);
    }
    Some(match platform {
        "n64" => "nintendo_64",
        "ds" => "nintendo_ds",
        "dreamcast" => "sega_dreamcast",
        "saturn" => "sega_saturn",
        "wiiu" => "nintendo_wii_u",
        _ => return None,
    })
}

/// Variables d'ES-DE qu'une valeur d'extra de configuration peut contenir (mêmes valeurs que
/// `launcher/android_table.rs`).
fn fill(value: &str, package: &str) -> String {
    value.replace("%EXTERNALDATA%", EXTERNAL).replace("%INTERNALDATA%", "/data/data").replace("%ANDROIDPACKAGE%", package)
}

/// Chemin sûr pour une ligne `#include "…"` : absolu, sans guillemet ni caractère de contrôle.
fn includable(path: &str) -> bool {
    path.starts_with('/') && path.len() < 512 && !path.chars().any(|c| c.is_control() || c == '"') && !path.split('/').any(|c| c == "..")
}

/// Ce que la commande de lancement donne à SmartConfig.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Launch {
    pub emulator: &'static Emulator,
    /// Paquet de l'activité choisie.
    pub package: String,
    /// Configuration principale passée par la commande (`CONFIGFILE`), variables remplies.
    pub config_file: Option<String>,
    /// Cœur libretro (`pcsx_rearmed`), d'après `LIBRETRO`.
    pub core: Option<String>,
}

/// Commande ES-DE + activité installée → émulateur SmartConfig (`None` : non couvert).
pub fn from_command(command: &str, component: &str) -> Option<Launch> {
    let t = crate::launcher::android_table::parse(command).ok()?;
    let emulator = emulator(&t.emulator)?;
    let package = component.split('/').next().unwrap_or_default().to_string();
    let extra = |k: &str| t.extras.iter().find(|(kind, key, _)| kind == "string" && key == k).map(|(_, _, v)| fill(v, &package));
    let core = extra("LIBRETRO").and_then(|p| Path::new(&p).file_name().and_then(|f| f.to_str()).map(|f| f.trim_end_matches(".so").trim_end_matches("_libretro_android").to_string()));
    let config_file = extra("CONFIGFILE").filter(|p| includable(p));
    Some(Launch { emulator, package, config_file, core })
}

const RA_SPECS: &[SettingSpec] = super::adapters::retroarch::SPECS;

/// RetroArch Android : fichier par jeu d'iBox, passé par `CONFIGFILE`, qui inclut la
/// configuration principale de RetroArch (`include`).
pub struct RetroArchAndroid {
    pub include: String,
    pub dir: PathBuf,
}

impl RetroArchAndroid {
    pub fn new(include: &str) -> Self {
        Self { include: include.into(), dir: PathBuf::from(RETROARCH_DIR) }
    }

    /// Ligne d'inclusion, toujours la dernière (les clés au-dessus l'emportent).
    fn include_line(&self) -> String {
        format!("#include \"{}\"", self.include)
    }
}

/// Retire les `#include` et les replace, avec la configuration principale, en dernière ligne.
fn with_include(bytes: &[u8], line: &str) -> Vec<u8> {
    let text = String::from_utf8_lossy(bytes);
    let mut out = String::new();
    if !text.lines().any(|l| l.starts_with("# iBox SmartConfig")) {
        out.push_str("# iBox SmartConfig : réglages de ce jeu, puis la configuration principale de RetroArch.\n");
    }
    for l in text.lines().filter(|l| !l.trim_start().starts_with("#include")) {
        out.push_str(l);
        out.push('\n');
    }
    out.push_str(line);
    out.push('\n');
    out.into_bytes()
}

impl Adapter for RetroArchAndroid {
    fn id(&self) -> &'static str {
        "retroarch"
    }
    fn name(&self) -> &'static str {
        "RetroArch"
    }
    fn platforms(&self) -> &'static [&'static str] {
        EMULATORS[0].platforms
    }
    fn specs(&self) -> &'static [SettingSpec] {
        RA_SPECS
    }
    fn locate(&self, install: &Install) -> Result<Location, String> {
        if !includable(&self.include) {
            return Err("configuration principale de RetroArch inconnue pour ce lancement".into());
        }
        std::fs::create_dir_all(&self.dir).map_err(|e| format!("dossier d'iBox impossible à créer ({}) : {e}", self.dir.display()))?;
        Ok(Location { config_root: self.dir.clone(), portable: false, version: install.version.clone() })
    }
    fn game_key(&self, game: &GameQuery, _ctx: &KeyContext) -> Result<String, String> {
        if !self.platforms().contains(&game.platform.as_str()) {
            return Err("EmuReady n'a pas de réglages RetroArch pour cette console".into());
        }
        Ok(format!("game-{}", game.game_id))
    }
    fn target(&self, loc: &Location, key: &str) -> (PathBuf, PathBuf, PathBuf) {
        (loc.config_root.clone(), loc.config_root.clone(), loc.config_root.join(format!("{key}.cfg")))
    }
    fn read(&self, current: Option<&[u8]>) -> Result<Vec<Setting>, String> {
        RetroArch.read(current)
    }
    fn builtin_overrides(&self, _install: &Install, _key: &str) -> Vec<String> {
        Vec::new()
    }
    fn render(&self, current: Option<&[u8]>, settings: &[Setting]) -> Result<(Vec<u8>, Vec<Change>), String> {
        let (bytes, changes) = RetroArch.render(current, settings)?;
        Ok((with_include(&bytes, &self.include_line()), changes))
    }
}

/// Paramètres d'une fiche manuelle : tout champ réglé du rapport (texte, nombre, booléen).
const SHEET_SPECS: &[SettingSpec] = &[SettingSpec { key: "sheet.*", label: "Réglage", kind: Kind::Text, risk: Risk::Low, check: None }];

/// Émulateur autonome : fiche de réglages à appliquer à la main, jamais d'écriture.
pub struct Sheet(pub &'static Emulator);

const MANUAL: &str = "réglages à appliquer à la main dans l'émulateur (Android ne permet pas à iBox de les écrire)";

impl Adapter for Sheet {
    fn id(&self) -> &'static str {
        self.0.id
    }
    fn name(&self) -> &'static str {
        self.0.name
    }
    fn platforms(&self) -> &'static [&'static str] {
        self.0.platforms
    }
    fn specs(&self) -> &'static [SettingSpec] {
        SHEET_SPECS
    }
    fn locate(&self, _install: &Install) -> Result<Location, String> {
        Err(MANUAL.into())
    }
    fn game_key(&self, game: &GameQuery, _ctx: &KeyContext) -> Result<String, String> {
        Ok(format!("game-{}", game.game_id))
    }
    fn target(&self, loc: &Location, _key: &str) -> (PathBuf, PathBuf, PathBuf) {
        (loc.config_root.clone(), loc.config_root.clone(), loc.config_root.clone())
    }
    fn read(&self, _current: Option<&[u8]>) -> Result<Vec<Setting>, String> {
        Err(MANUAL.into())
    }
    fn builtin_overrides(&self, _install: &Install, _key: &str) -> Vec<String> {
        Vec::new()
    }
    fn render(&self, _current: Option<&[u8]>, _settings: &[Setting]) -> Result<(Vec<u8>, Vec<Change>), String> {
        Err(MANUAL.into())
    }
}

/// Adaptateur SmartConfig pour un lancement Android.
pub fn adapter(l: &Launch) -> Box<dyn Adapter> {
    match (l.emulator.manual(), l.config_file.as_deref()) {
        (false, Some(cfg)) => Box::new(RetroArchAndroid::new(cfg)),
        _ => Box::new(Sheet(l.emulator)),
    }
}

/// Lignes d'une fiche manuelle (clé, libellé, valeur affichable), dans l'ordre du profil.
pub fn sheet_lines(settings: &[Setting], labels: &[(String, String)]) -> Vec<Change> {
    settings
        .iter()
        .filter(|s| s.key.starts_with("sheet."))
        .map(|s| {
            let label = labels.iter().find(|(k, _)| *k == s.key).map(|(_, l)| l.clone()).unwrap_or_else(|| humanize(&s.key["sheet.".len()..]));
            Change { key: s.key.clone(), label, before: None, after: s.value.to_string() }
        })
        .collect()
}

/// `resolution_scale` → « Resolution scale ».
fn humanize(field: &str) -> String {
    let t = field.replace('_', " ");
    let mut c = t.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

/// Cible d'une fiche dans le journal (aucun fichier : identifie l'émulateur et le jeu).
pub fn sheet_target(emulator: &str, game_id: i64) -> String {
    format!("{}{emulator}:{game_id}", super::backup::SHEET_PREFIX)
}

/// Fichier SmartConfig à passer à RetroArch pour ce jeu : l'optimisation active de ce jeu,
/// encore présente et toujours reliée à la configuration principale du lancement (`main`).
pub fn retroarch_config(history: &[super::backup::Entry], main: &str) -> Option<PathBuf> {
    let ours = |t: &Path| t.starts_with(RETROARCH_DIR) || std::fs::canonicalize(RETROARCH_DIR).is_ok_and(|d| t.starts_with(d));
    let entry = history.iter().find(|e| e.adapter == "retroarch" && e.status == "applied" && ours(Path::new(&e.target)))?;
    let path = PathBuf::from(&entry.target);
    let text = std::fs::read_to_string(&path).ok()?;
    let line = format!("#include \"{main}\"");
    text.lines().any(|l| l.trim() == line).then_some(path)
}

/// **Point d'accroche du lancement Android** (`launcher/android.rs`, juste avant
/// `plugin.launch`) : si SmartConfig a appliqué des réglages RetroArch à ce jeu, l'extra
/// `CONFIGFILE` désigne le fichier d'iBox (qui inclut la configuration d'origine). Sinon, rien ne
/// change. Ne bloque jamais le lancement.
pub fn prepare_launch(app: &tauri::AppHandle, game_id: i64, intent: &mut tauri_plugin_ibox_android::Intent) {
    use tauri::Manager;
    let Some(extra) = intent.extras.iter_mut().find(|e| e.key == "CONFIGFILE" && e.kind == "string") else { return };
    let lib = app.state::<crate::library::commands::LibraryState>();
    let Ok(history) = lib.with(|c| super::backup::history(c, Some(game_id), 20).map_err(|e| crate::library::LibraryError::Media(e.to_string()))) else { return };
    if let Some(path) = retroarch_config(&history, &extra.value) {
        extra.value = path.to_string_lossy().to_string();
    }
}

/// Émulateur Android choisi pour ce jeu, selon la règle du lanceur (`launcher::android::choice` :
/// préférence enregistrée si installée, sinon le premier installé dans l'ordre d'ES-DE).
#[cfg(target_os = "android")]
/// `None` : aucun émulateur installé ; `Some(None)` : émulateur installé mais non couvert.
pub fn resolve(app: &tauri::AppHandle, platform: &str) -> Result<Option<Option<Launch>>, String> {
    use crate::launcher::android_table as table;
    use tauri::Manager;
    use tauri_plugin_ibox_android::IboxAndroidExt;
    let found = app.ibox_android().installed(&table::all_components()).map_err(|e| e.to_string())?;
    let installed: std::collections::HashSet<String> = found.components.into_iter().collect();
    let choices = app.path().app_data_dir().ok().map(|d| table::load_choices(&d.join("android-emulators.json"))).unwrap_or_default();
    let Some(c) = table::choose(platform, &installed, choices.get(platform).map(String::as_str)) else { return Ok(None) };
    Ok(Some(from_command(&c.command, c.component.as_deref().unwrap_or_default())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::smartconfig::model::Value;

    const RA: &str = "%EMULATOR_RETROARCH% %EXTRA_CONFIGFILE%=%EXTERNALDATA%/Android/data/%ANDROIDPACKAGE%/files/retroarch.cfg %EXTRA_LIBRETRO%=%INTERNALDATA%/%ANDROIDPACKAGE%/cores/pcsx_rearmed_libretro_android.so %EXTRA_ROM%=%ROM%";

    #[test]
    fn commande_de_lancement() {
        let l = from_command(RA, "com.retroarch.aarch64/com.retroarch.browser.retroactivity.RetroActivityFuture").unwrap();
        assert_eq!(l.emulator.id, "retroarch");
        assert_eq!(l.config_file.as_deref(), Some("/storage/emulated/0/Android/data/com.retroarch.aarch64/files/retroarch.cfg"));
        assert_eq!(l.core.as_deref(), Some("pcsx_rearmed"));
        assert!(!l.emulator.manual());
        let d = from_command("%EMULATOR_DUCKSTATION% %ACTIVITY_CLEAR_TASK% %EXTRABOOL_resumeState%=false %EXTRA_bootPath%=%ROMSAF%", "com.github.stenzek.duckstation/.EmulationActivity").unwrap();
        assert_eq!((d.emulator.id, d.config_file, d.emulator.manual()), ("android.duckstation", None, true));
        assert!(from_command("%EMULATOR_NESOID% %DATA%=%ROMSAF%", "x/y").is_none());
        // chaque émulateur de la table du lanceur couvert ici y existe
        let table = crate::launcher::android_table::table();
        for e in EMULATORS {
            assert!(table.emulators.contains_key(e.key), "{} absent de la table d'ES-DE", e.key);
            for p in e.platforms {
                assert!(system_key(p).is_some(), "{p} sans système EmuReady");
            }
        }
    }

    #[test]
    fn fichier_retroarch_inclut_la_configuration_principale_en_dernier() {
        let a = RetroArchAndroid::new("/storage/emulated/0/Android/data/com.retroarch/files/retroarch.cfg");
        let s = [Setting { key: "retroarch.vsync".into(), value: Value::Bool(false) }, Setting { key: "retroarch.rewind".into(), value: Value::Bool(true) }];
        let (bytes, changes) = a.render(None, &s).unwrap();
        let text = String::from_utf8(bytes.clone()).unwrap();
        let last = text.lines().last().unwrap();
        assert_eq!(last, "#include \"/storage/emulated/0/Android/data/com.retroarch/files/retroarch.cfg\"");
        assert!(text.contains("video_vsync = \"false\"") && text.contains("rewind_enable = \"true\""));
        assert_eq!(changes.len(), 2);
        // relu : mêmes valeurs ; second rendu : une seule inclusion, toujours en dernier
        assert_eq!(a.read(Some(&bytes)).unwrap().len(), 2);
        let s2 = [Setting { key: "retroarch.frame_delay".into(), value: Value::Int(4) }];
        let (again, _) = a.render(Some(&bytes), &s2).unwrap();
        let again = String::from_utf8(again).unwrap();
        assert_eq!(again.matches("#include").count(), 1);
        assert!(again.trim_end().ends_with("retroarch.cfg\""));
        assert_eq!(again.matches("# iBox SmartConfig").count(), 1);
        // fichier réécrit par RetroArch (clés ajoutées après l'inclusion) : l'inclusion revient en dernier
        let by_ra = format!("{again}menu_driver = \"ozone\"\n");
        let (fixed, _) = a.render(Some(by_ra.as_bytes()), &s2).unwrap();
        assert!(String::from_utf8(fixed).unwrap().trim_end().ends_with("retroarch.cfg\""));
        assert!(!includable("/a/\"b"));
        assert!(!includable("relatif.cfg"));
        assert!(!includable("/storage/../x.cfg"));
    }

    #[test]
    fn fiche_et_point_d_accroche() {
        let lines = sheet_lines(
            &[Setting { key: "sheet.resolution_scale".into(), value: Value::Choice("2x".into()) }, Setting { key: "sheet.fast_mem".into(), value: Value::Bool(true) }],
            &[("sheet.resolution_scale".into(), "Resolution Scale".into())],
        );
        assert_eq!(lines[0].label, "Resolution Scale");
        assert_eq!(lines[1].label, "Fast mem");
        assert_eq!(lines[1].after, "true");

        let dir = std::env::temp_dir().join(format!("ibox-sc-android-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let main = "/storage/emulated/0/Android/data/com.retroarch/files/retroarch.cfg";
        let file = dir.join("game-7.cfg");
        std::fs::write(&file, format!("video_vsync = \"false\"\n#include \"{main}\"\n")).unwrap();
        let entry = |target: &Path, status: &str| super::super::backup::Entry {
            id: 1,
            game_id: 7,
            adapter: "retroarch".into(),
            emulator_version: None,
            target: target.to_string_lossy().to_string(),
            source: "emuready".into(),
            source_ref: "r".into(),
            mode: None,
            changes: "[]".into(),
            before_sha: None,
            after_sha: String::new(),
            status: status.into(),
            created_at: String::new(),
            restored_at: None,
        };
        // hors du dossier d'iBox : jamais passé
        assert_eq!(retroarch_config(&[entry(&file, "applied")], main), None);
        assert_eq!(retroarch_config(&[entry(Path::new("/storage/emulated/0/iBox/SmartConfig/RetroArch/absent.cfg"), "applied")], main), None);
        assert_eq!(retroarch_config(&[entry(&file, "restored")], main), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// Moteur sur Android : fiche validée, votre appareil et votre puce en tête.
#[cfg(test)]
mod engine_tests {
    use super::*;
    use crate::smartconfig::hardware::android::{from_snapshot, parse_simulation};
    use crate::smartconfig::model::*;
    use crate::smartconfig::recommend::{self, Context, GameMatch};

    fn thor() -> crate::smartconfig::hardware::HardwareInfo {
        from_snapshot(&parse_simulation("ro.product.manufacturer=AYN\nro.product.model=Thor Max\nro.soc.model=SM8550\nro.hardware.vulkan=adreno\narch=aarch64\nthreads=8\n"))
    }

    fn report(id: &str, device: &str, soc: &str, rank: u8, settings: Vec<Setting>) -> Profile {
        Profile {
            source: SourceId::EmuReady,
            source_ref: id.into(),
            source_url: None,
            kind: ProfileKind::Configuration,
            emulator: "android.nethersx2".into(),
            emulator_version: None,
            emulator_fork: None,
            game: GameRef::default(),
            hardware: ReferenceHardware { arch: Some("aarch64".into()), label: Some(device.into()), cpu: Some(soc.into()), gpu: Some("Adreno 740".into()), handheld: true, ..Default::default() },
            performance: Some(ReportedPerformance { label: "Great".into(), rank, scale: 8 }),
            settings,
            labels: vec![],
            ignored: vec![],
            notes: None,
            votes_up: 0,
            votes_down: 0,
            verified_by_developer: false,
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn votre_appareil_d_abord() {
        let hw = thor();
        let game = GameQuery { game_id: 1, platform: "ps2".into(), title: "Jeu".into(), ..Default::default() };
        let ctx = Context { game: &game, game_match: GameMatch::Title, hw: &hw, emulator_version: None, preferred: Mode::Balanced, today: "2026-11-27", local: &[] };
        let s = |k: &str, v: Value| Setting { key: k.into(), value: v };
        let profiles = vec![
            report("autre", "Retroid Pocket 5", "Snapdragon 865", 1, vec![s("sheet.renderer", Value::Choice("Vulkan".into()))]),
            report("puce", "AYN Odin 2", "Snapdragon 8 Gen 2", 2, vec![s("sheet.renderer", Value::Choice("Vulkan".into()))]),
            report("thor", "AYN Thor Max", "Snapdragon 8 Gen 2", 2, vec![s("sheet.renderer", Value::Choice("Vulkan".into())), s("sheet.upscale", Value::Int(2)), s("sheet.x", Value::Choice("a\nb".into()))]),
        ];
        let emu = by_id("android.nethersx2").unwrap();
        let out = recommend::recommend(&Sheet(emu), &profiles, &ctx);
        let order: Vec<&str> = out.recommendations.iter().map(|r| r.profile.source_ref.as_str()).collect();
        assert_eq!(order, vec!["thor", "puce", "autre"]);
        let top = &out.recommendations[0];
        assert_eq!(top.device, Some(crate::smartconfig::providers::emuready::DeviceMatch::SameDevice));
        assert_eq!(top.kind, MatchKind::SimilarHardware);
        // texte avec saut de ligne refusé, le reste accepté
        assert_eq!(top.validated.accepted.len(), 2);
        assert_eq!(top.validated.rejected.len(), 1);
        assert_eq!(out.recommendations[1].device, Some(crate::smartconfig::providers::emuready::DeviceMatch::SameSoc));
        assert_eq!(out.suggested, Some(0));
        // le relevé d'un PC ne compare jamais d'appareil Android
        assert!(recommend::recommend(&Sheet(emu), &profiles, &Context { hw: &Default::default(), ..ctx }).recommendations.iter().all(|r| r.device.is_none()));
    }
}
