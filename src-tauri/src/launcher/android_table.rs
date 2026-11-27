//! Table des émulateurs Android et traduction des commandes d'ES-DE en intents.
//!
//! Données : `android-emulators.json`, produit par `scripts/android-emulators.mjs` depuis la table
//! publique d'ES-DE pour Android (paquets/activités de `es_find_rules.xml`, commandes de
//! `es_systems.xml`). Une commande ES-DE ressemble à :
//!
//! ```text
//! %EMULATOR_DUCKSTATION% %ACTIVITY_CLEAR_TASK% %ACTIVITY_CLEAR_TOP% %EXTRABOOL_resumeState%=false %EXTRA_bootPath%=%ROMSAF%
//! ```
//!
//! Ce module est pur (compilé et testé partout) ; le lancement lui-même est dans `android.rs`.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::sync::OnceLock;
use tauri_plugin_ibox_android::{Extra, Intent};

const TABLE_JSON: &str = include_str!("android-emulators.json");

#[derive(Debug, Clone, Deserialize)]
pub struct Command {
    pub label: String,
    pub command: String,
}

#[derive(Debug, Deserialize)]
pub struct Table {
    pub source: String,
    /// Émulateur ES-DE (« RETROARCH ») → activités possibles (« paquet/activité »), par ordre de préférence.
    pub emulators: BTreeMap<String, Vec<String>>,
    /// Console iBox → commandes, la première étant le choix par défaut d'ES-DE.
    pub platforms: BTreeMap<String, Vec<Command>>,
}

pub fn table() -> &'static Table {
    static TABLE: OnceLock<Table> = OnceLock::new();
    TABLE.get_or_init(|| serde_json::from_str(TABLE_JSON).expect("launcher/android-emulators.json invalide"))
}

/// Toutes les activités connues (pour une seule question à Android : lesquelles sont installées ?).
pub fn all_components() -> Vec<String> {
    table().emulators.values().flatten().cloned().collect()
}

/// Commande ES-DE découpée.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Template {
    pub emulator: String,
    pub action: Option<String>,
    pub category: Option<String>,
    pub data: Option<String>,
    pub mime_type: Option<String>,
    /// (type, clé, valeur avec variables)
    pub extras: Vec<(String, String, String)>,
    pub flags: Vec<String>,
}

/// Découpe aux espaces, sauf entre guillemets (`%EXTRA_cli_params%="-rompath '…' %BASENAME%"`).
fn tokens(command: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    for c in command.chars() {
        match c {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

pub fn parse(command: &str) -> Result<Template, String> {
    let mut t = Template::default();
    for token in tokens(command) {
        if let Some(name) = token.strip_prefix("%EMULATOR_").and_then(|r| r.strip_suffix('%')) {
            t.emulator = name.to_string();
            continue;
        }
        let flag = match token.as_str() {
            "%ACTIVITY_CLEAR_TASK%" => Some("clearTask"),
            "%ACTIVITY_CLEAR_TOP%" => Some("clearTop"),
            "%ACTIVITY_NO_HISTORY%" => Some("noHistory"),
            _ => None,
        };
        if let Some(f) = flag {
            t.flags.push(f.to_string());
            continue;
        }
        let (name, value) = token
            .strip_prefix('%')
            .and_then(|r| r.split_once("%="))
            .ok_or_else(|| format!("élément de commande inconnu : {token}"))?;
        let value = value.to_string();
        match name {
            "ACTION" => t.action = Some(value),
            "CATEGORY" => t.category = Some(value),
            "DATA" => t.data = Some(value),
            "MIMETYPE" => t.mime_type = Some(value),
            _ => {
                let (kind, key) = if let Some(k) = name.strip_prefix("EXTRABOOL_") {
                    ("bool", k)
                } else if let Some(k) = name.strip_prefix("EXTRAINTEGER_") {
                    ("int", k)
                } else if let Some(k) = name.strip_prefix("EXTRAARRAY_") {
                    ("stringArray", k)
                } else if let Some(k) = name.strip_prefix("EXTRA_") {
                    ("string", k)
                } else {
                    return Err(format!("variable inconnue : %{name}%"));
                };
                t.extras.push((kind.into(), key.into(), value));
            }
        }
    }
    if t.emulator.is_empty() {
        return Err("commande sans émulateur".into());
    }
    Ok(t)
}

impl Template {
    fn values(&self) -> impl Iterator<Item = &str> {
        self.data.iter().map(String::as_str).chain(self.extras.iter().map(|(_, _, v)| v.as_str()))
    }
    /// La ROM doit être donnée par une adresse SAF (`%ROMSAF%`).
    pub fn needs_saf(&self) -> bool {
        self.values().any(|v| v.contains("%ROMSAF%"))
    }
    /// … ou par le FileProvider d'iBox (`%ROMPROVIDER%`).
    pub fn needs_provider(&self) -> bool {
        self.values().any(|v| v.contains("%ROMPROVIDER%"))
    }
}

impl Template {
    /// Cœur RetroArch demandé (`%EXTRA_LIBRETRO%=…/cores/gambatte_libretro_android.so`).
    pub fn core_file(&self) -> Option<String> {
        let (_, _, value) = self.extras.iter().find(|(_, key, _)| key == "LIBRETRO")?;
        value.rsplit('/').next().filter(|f| f.ends_with(".so")).map(str::to_string)
    }
}

/// Ce qui remplit les variables d'une commande.
pub struct Context<'a> {
    pub rom: &'a Path,
    /// Paquet de l'émulateur choisi (`%ANDROIDPACKAGE%`).
    pub package: &'a str,
    pub saf: Option<&'a str>,
    pub provider: Option<&'a str>,
}

fn fill(value: &str, ctx: &Context) -> String {
    let rom = ctx.rom.to_string_lossy();
    let dir = ctx.rom.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
    let base = ctx.rom.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    value
        .replace("%ROMSAF%", ctx.saf.or(ctx.provider).unwrap_or(&rom))
        .replace("%ROMPROVIDER%", ctx.provider.or(ctx.saf).unwrap_or(&rom))
        .replace("%ROMRAW%", &rom)
        .replace("%ROM%", &rom)
        .replace("%GAMEDIRRAW%", &dir)
        .replace("%BASENAME%", &base)
        .replace("%EXTERNALDATA%", "/storage/emulated/0")
        .replace("%INTERNALDATA%", "/data/data")
        .replace("%ANDROIDPACKAGE%", ctx.package)
}

/// Intent complet pour une activité installée (`component` : « paquet/activité »).
pub fn resolve(t: &Template, component: &str, ctx: &Context) -> Intent {
    let extras = t
        .extras
        .iter()
        .map(|(kind, key, value)| {
            let v = fill(value, ctx);
            let mut e = Extra::new(kind, key, v.clone());
            if kind == "stringArray" {
                e.values = Some(v.split(',').map(str::to_string).collect());
            }
            e
        })
        .collect();
    let mut grant_uris: Vec<String> = Vec::new();
    for uri in [t.needs_saf().then_some(ctx.saf.or(ctx.provider)), t.needs_provider().then_some(ctx.provider.or(ctx.saf))].into_iter().flatten().flatten() {
        if !grant_uris.iter().any(|u| u == uri) {
            grant_uris.push(uri.to_string());
        }
    }
    // ROM donnée par adresse : l'émulateur reçoit aussi le dossier du jeu (fichiers voisins :
    // homebrew « dossier + EBOOT.PBP », `.cue` et ses `.bin`, sauvegardes à côté du jeu)
    let grant_folders = if grant_uris.is_empty() { Vec::new() } else { ctx.rom.parent().map(|d| d.to_string_lossy().to_string()).into_iter().collect() };
    Intent {
        component: Some(component.to_string()),
        grant_folders,
        action: t.action.clone(),
        data: t.data.as_deref().map(|d| fill(d, ctx)),
        mime_type: t.mime_type.clone(),
        categories: t.category.iter().cloned().collect(),
        extras,
        flags: t.flags.clone(),
        grant_uris,
        ..Default::default()
    }
}

/// Nom affiché : « RetroArch (Snes9x - Current) », « DuckStation ».
pub fn display_name(emulator: &str, label: &str) -> String {
    if emulator == "RETROARCH" {
        format!("RetroArch ({label})")
    } else {
        label.trim_end_matches(" (Standalone)").to_string()
    }
}

/// Une façon de lancer les jeux d'une console.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    /// Libellé ES-DE (clé du choix enregistré).
    pub label: String,
    pub name: String,
    pub emulator: String,
    /// Activité installée (None : émulateur absent).
    pub component: Option<String>,
    pub command: String,
    /// Émulateur autonome (pas un cœur de RetroArch).
    pub standalone: bool,
}

/// Options d'une console, dans l'ordre d'ES-DE, avec l'activité installée de chacune.
pub fn options(platform: &str, installed: &HashSet<String>) -> Vec<Choice> {
    let t = table();
    t.platforms
        .get(platform)
        .map(|commands| {
            commands
                .iter()
                .filter_map(|c| {
                    let emulator = parse(&c.command).ok()?.emulator;
                    let component = t.emulators.get(&emulator)?.iter().find(|a| installed.contains(*a)).cloned();
                    Some(Choice {
                        label: c.label.clone(),
                        name: display_name(&emulator, &c.label),
                        standalone: emulator != "RETROARCH",
                        emulator,
                        component,
                        command: c.command.clone(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Choix effectif : celui de l'utilisateur s'il est installé ; sinon le premier émulateur autonome
/// installé (dans l'ordre d'ES-DE), et RetroArch en dernier. ES-DE met les cœurs de RetroArch en
/// tête, mais iBox ne peut pas savoir lesquels sont installés (ils sont dans le dossier privé de
/// RetroArch) : un émulateur autonome installé pour cette console est un choix plus sûr.
pub fn choose(platform: &str, installed: &HashSet<String>, preferred: Option<&str>) -> Option<Choice> {
    let opts = options(platform, installed);
    let usable = |c: &&Choice| c.component.is_some();
    preferred
        .and_then(|p| opts.iter().filter(usable).find(|c| c.label == p))
        .or_else(|| opts.iter().filter(usable).find(|c| c.standalone))
        .or_else(|| opts.iter().find(usable))
        .cloned()
}

/// Message quand rien n'est installé : les émulateurs proposés par ES-DE pour la console.
pub fn missing_message(platform: &str, platform_name: &str) -> String {
    let mut names: Vec<String> = Vec::new();
    for c in options(platform, &HashSet::new()) {
        let n = if c.emulator == "RETROARCH" { "RetroArch".to_string() } else { c.name.clone() };
        if !names.contains(&n) {
            names.push(n);
        }
        if names.len() == 3 {
            break;
        }
    }
    if names.is_empty() {
        format!("Aucun émulateur Android connu pour la console « {platform_name} ».")
    } else {
        format!("Aucun émulateur Android installé pour la console « {platform_name} ». Installez par exemple {}.", names.join(", "))
    }
}

/// Nom d'une console pour les messages.
pub fn platform_name(platform: &str) -> &str {
    match platform {
        "gamecube" => "GameCube", "wii" => "Wii", "wiiu" => "Wii U", "ds" => "Nintendo DS", "3ds" => "Nintendo 3DS",
        "n64" => "Nintendo 64", "gb" => "Game Boy", "gbc" => "Game Boy Color", "gba" => "Game Boy Advance",
        "snes" => "Super Nintendo", "nes" => "NES", "switch" => "Switch", "ps1" => "PlayStation", "ps2" => "PlayStation 2",
        "ps3" => "PlayStation 3", "psp" => "PSP", "mastersystem" => "Master System", "megadrive" => "Mega Drive",
        "gamegear" => "Game Gear", "saturn" => "Saturn", "dreamcast" => "Dreamcast", "atari2600" => "Atari 2600",
        "jaguar" => "Jaguar", "xbox" => "Xbox", "xbox360" => "Xbox 360",
        other => other,
    }
}

/// Choix de l'utilisateur, console → libellé (fichier `android-emulators.json` des données d'iBox).
pub type Choices = BTreeMap<String, String>;

pub fn load_choices(path: &Path) -> Choices {
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn save_choices(path: &Path, choices: &Choices) -> std::io::Result<()> {
    std::fs::write(path, serde_json::to_string_pretty(choices).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn installed(list: &[&str]) -> HashSet<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn table_lue_et_complete() {
        let t = table();
        assert!(t.source.contains("ES-DE"));
        for id in ["gamecube", "wii", "ds", "3ds", "ps1", "ps2", "psp", "snes", "gba", "dreamcast", "n64"] {
            assert!(!t.platforms[id].is_empty(), "{id}");
        }
        // toutes les commandes se découpent et visent un émulateur connu
        for (platform, commands) in &t.platforms {
            for c in commands {
                let p = parse(&c.command).unwrap_or_else(|e| panic!("{platform} {} : {e}", c.label));
                assert!(t.emulators.contains_key(&p.emulator), "{platform} {}", c.label);
            }
        }
        assert!(t.emulators["RETROARCH"].iter().any(|a| a.starts_with("com.retroarch.aarch64/")));
    }

    #[test]
    fn commande_duckstation() {
        let t = parse("%EMULATOR_DUCKSTATION% %ACTIVITY_CLEAR_TASK% %ACTIVITY_CLEAR_TOP% %EXTRABOOL_resumeState%=false %EXTRA_bootPath%=%ROMSAF%").unwrap();
        assert_eq!(t.emulator, "DUCKSTATION");
        assert_eq!(t.flags, ["clearTask", "clearTop"]);
        assert!(t.needs_saf() && !t.needs_provider());
        let ctx = Context { rom: Path::new("/storage/emulated/0/Roms/psx/Jeu.chd"), package: "com.github.stenzek.duckstation", saf: Some("content://saf/x"), provider: None };
        let i = resolve(&t, "com.github.stenzek.duckstation/.EmulationActivity", &ctx);
        assert_eq!(i.extras[0], Extra::new("bool", "resumeState", "false"));
        assert_eq!(i.extras[1], Extra::new("string", "bootPath", "content://saf/x"));
        assert_eq!(i.grant_uris, ["content://saf/x"]);
        assert_eq!(i.grant_folders, ["/storage/emulated/0/Roms/psx"]);
    }

    #[test]
    fn commande_retroarch() {
        let t = parse("%EMULATOR_RETROARCH% %EXTRA_CONFIGFILE%=%EXTERNALDATA%/Android/data/%ANDROIDPACKAGE%/files/retroarch.cfg %EXTRA_LIBRETRO%=%INTERNALDATA%/%ANDROIDPACKAGE%/cores/snes9x_libretro_android.so %EXTRA_ROM%=%ROM%").unwrap();
        let ctx = Context { rom: Path::new("/storage/1A2B-3C4D/snes/Jeu.sfc"), package: "com.retroarch", saf: None, provider: None };
        let i = resolve(&t, "com.retroarch/com.retroarch.browser.retroactivity.RetroActivityFuture", &ctx);
        let v: Vec<&str> = i.extras.iter().map(|e| e.value.as_str()).collect();
        assert_eq!(v, ["/storage/emulated/0/Android/data/com.retroarch/files/retroarch.cfg", "/data/data/com.retroarch/cores/snes9x_libretro_android.so", "/storage/1A2B-3C4D/snes/Jeu.sfc"]);
        assert!(i.grant_uris.is_empty() && i.grant_folders.is_empty() && i.action.is_none());
    }

    #[test]
    fn coeur_retroarch_de_la_commande() {
        let t = parse("%EMULATOR_RETROARCH% %EXTRA_LIBRETRO%=%INTERNALDATA%/%ANDROIDPACKAGE%/cores/gambatte_libretro_android.so %EXTRA_ROM%=%ROM%").unwrap();
        assert_eq!(t.core_file().as_deref(), Some("gambatte_libretro_android.so"));
        assert_eq!(parse("%EMULATOR_PPSSPP% %DATA%=%ROMSAF%").unwrap().core_file(), None);
    }

    #[test]
    fn guillemets_et_donnees() {
        let t = parse(r#"%EMULATOR_X% %ACTION%=android.intent.action.VIEW %EXTRA_cli_params%="-rompath '%GAMEDIRRAW%' %BASENAME%" %DATA%=%ROMPROVIDER%"#).unwrap();
        let ctx = Context { rom: Path::new("/r/arcade/pacman.zip"), package: "p", saf: None, provider: Some("content://app.ibox.android.fileprovider/root/r/arcade/pacman.zip") };
        let i = resolve(&t, "p/.A", &ctx);
        assert_eq!(i.extras[0].value, "-rompath '/r/arcade' pacman");
        assert_eq!(i.data.as_deref(), Some("content://app.ibox.android.fileprovider/root/r/arcade/pacman.zip"));
        assert_eq!(i.grant_uris.len(), 1);
        assert!(parse("%EMULATOR_X% %INCONNU%").is_err());
    }

    #[test]
    fn choix_de_l_emulateur() {
        let none = installed(&[]);
        assert_eq!(choose("ps1", &none, None), None);
        let duck = installed(&["com.github.stenzek.duckstation/.EmulationActivity"]);
        let c = choose("ps1", &duck, None).unwrap();
        assert_eq!((c.emulator.as_str(), c.name.as_str()), ("DUCKSTATION", "DuckStation"));
        // RetroArch et un émulateur autonome installés : l'autonome d'abord, sauf préférence enregistrée
        let both = installed(&["com.github.stenzek.duckstation/.EmulationActivity", "com.retroarch/com.retroarch.browser.retroactivity.RetroActivityFuture"]);
        assert_eq!(choose("ps1", &both, None).unwrap().emulator, "DUCKSTATION");
        assert_eq!(choose("ps1", &both, Some("Beetle PSX")).unwrap().emulator, "RETROARCH");
        // RetroArch seul : son premier cœur dans l'ordre d'ES-DE
        let ra = installed(&["com.retroarch/com.retroarch.browser.retroactivity.RetroActivityFuture"]);
        assert_eq!(choose("ps1", &ra, None).unwrap().label, "Beetle PSX");
        // préférence dont l'émulateur a été désinstallé : on revient au premier installé
        assert_eq!(choose("ps1", &duck, Some("Beetle PSX")).unwrap().emulator, "DUCKSTATION");
        assert!(missing_message("ps1", "PlayStation").contains("RetroArch"));
    }
}
