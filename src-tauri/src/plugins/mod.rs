//! Plugins iBox (plan : `docs/PLUGINS.md`) : paquets `.iboxplugin` signés, publiés à part,
//! installés depuis Paramètres › Plugins.
//!
//! - `catalog` : catalogue iNetbox (`GET /plugins`) et téléchargement ;
//! - `trust` : SHA-256 et signature ed25519 de l'éditeur ;
//! - `install` : vérification et extraction sûre dans `<données>/plugins/<id>/<version>/` ;
//! - `registry` : plugins installés et activés (`plugins.json`) ;
//! - `protocol` : `iboxplugin://` sert les fichiers du plugin à sa seule fenêtre ;
//! - `host` : le socle natif (overlay, raccourci, manette, médias, WebView), endormi tant
//!   qu'aucun plugin activé ne le demande.

pub mod catalog;
pub mod host;
pub mod install;
pub mod manifest;
pub mod panel;
pub mod protocol;
pub mod registry;
pub mod trust;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

use manifest::Manifest;
use registry::Registry;

/// Un plugin installé et activé, tel que le socle le sert.
#[derive(Debug, Clone)]
pub struct Active {
    pub id: String,
    pub dir: PathBuf,
    pub manifest: Manifest,
    pub granted: Vec<String>,
}

impl Active {
    pub fn allows(&self, perm: &str) -> bool {
        self.granted.iter().any(|g| g == perm) && self.manifest.has(perm)
    }
}

static ACTIVE: Mutex<Option<HashMap<String, Arc<Active>>>> = Mutex::new(None);
/// Dernier catalogue lu (l'installation reprend son entrée).
static CATALOG: Mutex<Vec<catalog::Entry>> = Mutex::new(Vec::new());
/// Une seule installation à la fois.
static BUSY: Mutex<()> = Mutex::new(());
/// Langue et thème d'iBox (`plugins_look`), passés aux pages des plugins à leur ouverture.
static LOOK: Mutex<Option<(&'static str, bool)>> = Mutex::new(None);

pub fn look() -> (&'static str, bool) {
    LOOK.lock().ok().and_then(|l| *l).unwrap_or(("en", true))
}

/// Langue passée aux plugins : le français s'il est demandé, l'anglais sinon (langue par défaut).
pub fn plugin_lang(lang: Option<&str>) -> &'static str {
    if lang == Some("fr") {
        "fr"
    } else {
        "en"
    }
}

/// L'interface d'iBox donne sa langue et son thème (au démarrage et à chaque changement).
#[tauri::command]
pub async fn plugins_look(app: AppHandle, lang: Option<String>, dark: Option<bool>) {
    let next = (plugin_lang(lang.as_deref()), dark.unwrap_or(true));
    let before = LOOK.lock().ok().and_then(|mut l| l.replace(next));
    // langue ou thème changés : les fenêtres de plugin déjà ouvertes suivent (`look://changed`)
    if before.is_some_and(|b| b != next) {
        let detail = serde_json::json!({ "event": "look://changed", "payload": { "lang": next.0, "scheme": if next.1 { "dark" } else { "light" } } }).to_string();
        for (label, w) in app.webview_windows() {
            if protocol::is_plugin_label(&label) {
                let _ = w.eval(format!("window.dispatchEvent(new CustomEvent(\"ibox:host\", {{ detail: {detail} }}))"));
            }
        }
    }
}

pub fn root<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    Some(app.path().app_local_data_dir().ok()?.join("plugins"))
}

fn load_manifest(dir: &std::path::Path) -> Option<Manifest> {
    Manifest::parse(&std::fs::read(dir.join("manifest.json")).ok()?).ok()
}

/// Relit le registre et les manifestes des plugins activés.
fn reload<R: Runtime>(app: &AppHandle<R>) -> HashMap<String, Arc<Active>> {
    let mut map = HashMap::new();
    if let Some(root) = root(app) {
        for (id, p) in Registry::load(&root).enabled() {
            let dir = install::version_dir(&root, id, &p.version);
            match load_manifest(&dir) {
                Some(m) if &m.id == id && m.version == p.version => {
                    map.insert(id.clone(), Arc::new(Active { id: id.clone(), dir, manifest: m, granted: p.granted.clone() }));
                }
                _ => eprintln!("iBox : plugin {id} illisible, ignoré"),
            }
        }
    }
    if let Ok(mut g) = ACTIVE.lock() {
        *g = Some(map.clone());
    }
    map
}

pub fn active<R: Runtime>(app: AppHandle<R>, id: &str) -> Option<Arc<Active>> {
    let cached = ACTIVE.lock().ok().and_then(|g| g.as_ref().map(|m| m.get(id).cloned()));
    match cached {
        Some(found) => found,
        None => reload(&app).get(id).cloned(),
    }
}

pub fn all_active<R: Runtime>(app: &AppHandle<R>) -> Vec<Arc<Active>> {
    let cached = ACTIVE.lock().ok().and_then(|g| g.as_ref().map(|m| m.values().cloned().collect::<Vec<_>>()));
    cached.unwrap_or_else(|| reload(app).into_values().collect())
}

/// Au démarrage d'iBox : réveille le socle des plugins activés (rien sinon).
pub fn start(app: AppHandle) {
    panel::start(app.clone());
    std::thread::spawn(move || {
        reload(&app);
        host::apply(&app);
    });
}

fn changed(app: &AppHandle) {
    reload(app);
    host::apply(app);
}

// ——— Vue pour Paramètres › Plugins ———

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledView {
    pub version: String,
    pub enabled: bool,
    pub granted: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableView {
    pub version: String,
    pub notes: String,
    pub size: u64,
    pub compatible: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginView {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: catalog::Author,
    pub permissions: Vec<String>,
    pub icon: Option<String>,
    pub installed: Option<InstalledView>,
    pub available: Option<AvailableView>,
    pub update: bool,
    /// Titre de l'écran plein du plugin installé (bouton « Ouvrir »), s'il en a un.
    pub screen: Option<String>,
    /// Nom, description, notes et titre d'écran dans d'autres langues : l'interface prend
    /// `i18n[langue]`, puis `i18n.en`, puis la base (voir `manifest::Texts`).
    #[serde(skip_serializing_if = "manifest::Locales::is_empty")]
    pub i18n: manifest::Locales,
}

/// Titre de la fenêtre de l'écran plein, dans la langue d'iBox.
fn screen_title(m: &Manifest, lang: &str) -> String {
    let base = m.screen.as_ref().and_then(|s| s.title.as_deref());
    manifest::localized(&m.i18n, lang, |t| t.screen.as_ref())
        .or(base)
        .or_else(|| manifest::localized(&m.i18n, lang, |t| t.name.as_ref()))
        .unwrap_or(&m.name)
        .to_string()
}

/// Textes d'un plugin installé. La source la plus traduite l'emporte : l'entrée du catalogue
/// (textes à jour) si elle a des traductions ou si le manifeste n'en a pas, sinon le manifeste.
/// Un plugin installé avant les traductions s'affiche ainsi dans la langue d'iBox dès que le
/// catalogue les donne. Les notes viennent du catalogue, le titre d'écran du manifeste.
fn installed_texts(m: &Manifest, entry: Option<&catalog::Entry>) -> (String, String, manifest::Locales) {
    let (name, description, source) = match entry.filter(|e| !e.i18n.is_empty() || m.i18n.is_empty()) {
        Some(e) => (e.name.clone(), e.description.clone(), &e.i18n),
        None => (m.name.clone(), m.description.clone(), &m.i18n),
    };
    let notes = entry.map(|e| &e.i18n);
    let mut out = manifest::Locales::new();
    for lang in source.keys().chain(m.i18n.keys()).chain(notes.into_iter().flat_map(|n| n.keys())) {
        let t = manifest::Texts {
            name: source.get(lang).and_then(|t| t.name.clone()),
            description: source.get(lang).and_then(|t| t.description.clone()),
            notes: notes.and_then(|n| n.get(lang)).and_then(|t| t.notes.clone()),
            screen: m.i18n.get(lang).and_then(|t| t.screen.clone()),
        };
        if t != manifest::Texts::default() {
            out.insert(lang.clone(), t);
        }
    }
    (name, description, out)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginList {
    pub plugins: Vec<PluginView>,
    pub catalog_error: Option<String>,
    pub platform_supported: bool,
}

/// Icône d'un plugin pour sa fenêtre (barre des tâches, Alt+Tab) : son `icon.png`, en RGBA.
fn window_icon(dir: &std::path::Path) -> Option<tauri::image::Image<'static>> {
    let bytes = std::fs::read(dir.join("icon.png")).ok().filter(|b| b.len() <= 256 * 1024)?;
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND);
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buf).ok()?;
    if info.bit_depth != png::BitDepth::Eight {
        return None;
    }
    buf.truncate(info.buffer_size());
    let rgba = rgba(info.color_type, buf)?;
    Some(tauri::image::Image::new_owned(rgba, info.width, info.height))
}

/// Pixels 8 bits d'un PNG décodé → RGBA.
fn rgba(color: png::ColorType, buf: Vec<u8>) -> Option<Vec<u8>> {
    Some(match color {
        png::ColorType::Rgba => buf,
        png::ColorType::Rgb => buf.chunks_exact(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
        png::ColorType::GrayscaleAlpha => buf.chunks_exact(2).flat_map(|p| [p[0], p[0], p[0], p[1]]).collect(),
        png::ColorType::Grayscale => buf.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::Indexed => return None,
    })
}

/// Identité Windows de la fenêtre d'un plugin : son propre bouton dans la barre des tâches, avec
/// son icône, au lieu de se ranger sous celui d'iBox.
#[cfg(windows)]
fn own_taskbar_button(w: &tauri::WebviewWindow, id: &str) {
    use windows::Win32::Foundation::{HWND, PROPERTYKEY};
    use windows::Win32::System::Com::CoTaskMemAlloc;
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};
    // PKEY_AppUserModel_ID
    const KEY: PROPERTYKEY = PROPERTYKEY { fmtid: windows::core::GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3), pid: 5 };
    let Ok(h) = w.hwnd() else { return };
    let name: Vec<u16> = format!("atzski.iBox.plugin.{id}").encode_utf16().chain(Some(0)).collect();
    unsafe {
        let Ok(store) = SHGetPropertyStoreForWindow::<IPropertyStore>(HWND(h.0 as _)) else { return };
        // chaîne allouée par COM : PropVariantClear (Drop) la libère
        let text = CoTaskMemAlloc(name.len() * 2) as *mut u16;
        if text.is_null() {
            return;
        }
        std::ptr::copy_nonoverlapping(name.as_ptr(), text, name.len());
        let mut value = PROPVARIANT::default();
        (*value.Anonymous.Anonymous).vt = VT_LPWSTR;
        (*value.Anonymous.Anonymous).Anonymous.pwszVal = windows::core::PWSTR(text);
        if store.SetValue(&KEY, &value).is_ok() {
            let _ = store.Commit();
        }
    }
}
#[cfg(not(windows))]
fn own_taskbar_button(_: &tauri::WebviewWindow, _: &str) {}

fn icon_of(dir: &std::path::Path) -> Option<String> {
    let bytes = std::fs::read(dir.join("icon.png")).ok().filter(|b| b.len() <= 256 * 1024 && b.starts_with(b"\x89PNG"))?;
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

fn compatible(e: &catalog::Entry) -> bool {
    manifest::ibox_satisfies(e.ibox.as_deref(), env!("CARGO_PKG_VERSION"))
        && (e.platforms.is_empty() || e.platforms.iter().any(|p| p == manifest::current_platform()))
}

fn newer(a: &str, b: &str) -> bool {
    matches!((manifest::parse_version(a), manifest::parse_version(b)), (Some(x), Some(y)) if x > y)
}

fn list_view(app: &AppHandle, entries: &[catalog::Entry], catalog_error: Option<String>) -> PluginList {
    let root = root(app);
    let reg = root.as_deref().map(Registry::load).unwrap_or_default();
    let mut out: Vec<PluginView> = Vec::new();
    for (id, p) in &reg.plugins {
        let dir = root.as_ref().map(|r| install::version_dir(r, id, &p.version));
        let m = dir.as_deref().and_then(load_manifest);
        let entry = entries.iter().find(|e| &e.id == id);
        let Some(m) = m else { continue };
        let (name, description, i18n) = installed_texts(&m, entry);
        out.push(PluginView {
            id: id.clone(),
            name,
            description,
            i18n,
            author: catalog::Author { name: entry.map(|e| e.author.name.clone()).unwrap_or_else(|| m.author.name.clone()), inetbox: m.author.inetbox.clone().or_else(|| entry.and_then(|e| e.author.inetbox.clone())), username: m.author.username.clone() },
            permissions: m.permissions.clone(),
            icon: dir.as_deref().and_then(icon_of).or_else(|| entry.and_then(|e| e.icon.clone())),
            installed: Some(InstalledView { version: p.version.clone(), enabled: p.enabled, granted: p.granted.clone() }),
            update: entry.is_some_and(|e| newer(&e.version, &p.version) && compatible(e)),
            available: entry.map(|e| AvailableView { version: e.version.clone(), notes: e.notes.clone(), size: e.size, compatible: compatible(e) }),
            screen: m.screen.as_ref().map(|s| s.title.clone().unwrap_or_else(|| m.name.clone())),
        });
    }
    for e in entries.iter().filter(|e| !reg.plugins.contains_key(&e.id)) {
        out.push(PluginView {
            id: e.id.clone(),
            name: e.name.clone(),
            description: e.description.clone(),
            author: e.author.clone(),
            permissions: e.permissions.clone(),
            icon: e.icon.clone(),
            installed: None,
            available: Some(AvailableView { version: e.version.clone(), notes: e.notes.clone(), size: e.size, compatible: compatible(e) }),
            update: false,
            screen: None,
            i18n: e.i18n.clone(),
        });
    }
    PluginList { plugins: out, catalog_error, platform_supported: cfg!(windows) }
}

fn cached_catalog() -> Vec<catalog::Entry> {
    CATALOG.lock().map(|c| c.clone()).unwrap_or_default()
}

/// Plugins installés et catalogue. `refresh` relit le catalogue en ligne.
#[tauri::command]
pub async fn plugins_list(app: AppHandle, refresh: Option<bool>) -> Result<PluginList, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut error = None;
        if refresh.unwrap_or(true) || cached_catalog().is_empty() {
            match catalog::fetch() {
                Ok(list) => {
                    if let Ok(mut c) = CATALOG.lock() {
                        *c = list;
                    }
                }
                Err(e) => error = Some(e),
            }
        }
        list_view(&app, &cached_catalog(), error)
    })
    .await
    .map_err(|e| e.to_string())
}

/// Installe (ou met à jour) un plugin du catalogue : téléchargement, vérification, extraction,
/// puis activation avec les permissions du manifeste (affichées avant par l'interface).
#[tauri::command]
pub async fn plugins_install(app: AppHandle, id: String) -> Result<PluginList, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = BUSY.lock().map_err(|_| "Installation déjà en cours.")?;
        let entry = cached_catalog().into_iter().find(|e| e.id == id).ok_or("Plugin absent du catalogue.")?;
        let root = root(&app).ok_or("Dossier des plugins indisponible.")?;
        let bytes = catalog::download(&entry)?;
        let exp = install::Expected { id: &entry.id, version: &entry.version, sha256: &entry.sha256, signature: &entry.signature, publisher: &entry.publisher };
        let m = install::install(&root, &bytes, &exp, env!("CARGO_PKG_VERSION"))?;
        let mut reg = Registry::load(&root);
        let was_enabled = reg.plugins.get(&m.id).map(|p| p.enabled).unwrap_or(true);
        reg.plugins.insert(
            m.id.clone(),
            registry::Installed { version: m.version.clone(), enabled: was_enabled, granted: m.permissions.clone(), publisher: entry.publisher.clone(), installed_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) },
        );
        // le plugin en place est arrêté avant la bascule de version
        host::stop(&app, &m.id);
        reg.save(&root)?;
        install::prune(&root, &m.id, &m.version);
        changed(&app);
        Ok(list_view(&app, &cached_catalog(), None))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plugins_set_enabled(app: AppHandle, id: String, enabled: bool) -> Result<PluginList, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = root(&app).ok_or("Dossier des plugins indisponible.")?;
        let mut reg = Registry::load(&root);
        let p = reg.plugins.get_mut(&id).ok_or("Plugin non installé.")?;
        p.enabled = enabled;
        reg.save(&root)?;
        if !enabled {
            host::stop(&app, &id);
        }
        changed(&app);
        Ok(list_view(&app, &cached_catalog(), None))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plugins_uninstall(app: AppHandle, id: String) -> Result<PluginList, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = BUSY.lock().map_err(|_| "Installation en cours.")?;
        let root = root(&app).ok_or("Dossier des plugins indisponible.")?;
        host::stop(&app, &id);
        let mut reg = Registry::load(&root);
        reg.plugins.remove(&id);
        reg.save(&root)?;
        install::uninstall(&root, &id)?;
        changed(&app);
        Ok(list_view(&app, &cached_catalog(), None))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Ouvre (ou ramène devant) l'écran plein d'un plugin activé, dans sa propre fenêtre
/// `plugin-<id>:screen`, sans aucune commande d'iBox (lib.rs). La fenêtre se crée par la boucle
/// d'événements, depuis un autre fil (jamais dans une commande synchrone : WebView2 bloquerait).
#[cfg(mobile)]
#[tauri::command]
pub async fn plugins_open_screen(app: AppHandle, id: String, lang: Option<String>, dark: Option<bool>) -> Result<(), String> {
    let _ = (app, id, lang, dark);
    Err(crate::platform::UNAVAILABLE.into())
}

#[cfg(desktop)]
#[tauri::command]
pub async fn plugins_open_screen(app: AppHandle, id: String, lang: Option<String>, dark: Option<bool>) -> Result<(), String> {
    let a = active(app.clone(), &id).ok_or("Plugin absent ou désactivé.")?;
    let screen = a.manifest.screen.clone().ok_or("Ce plugin n'a pas d'écran.")?;
    // langue et thème d'iBox, seules valeurs passées à la page
    let lang = plugin_lang(lang.as_deref());
    let scheme = if dark.unwrap_or(true) { "dark" } else { "light" };
    let url: tauri::Url = format!("{}?lang={lang}&scheme={scheme}", protocol::url(&id, &screen.entry)).parse().map_err(|_| "Adresse invalide.")?;
    let home = protocol::url(&id, "");
    let title = screen_title(&a.manifest, lang);
    let label = protocol::screen_label(&id);
    let icon = window_icon(&a.dir);
    std::thread::spawn(move || {
        let ui = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(w) = ui.get_webview_window(&label) {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
                return;
            }
            let make = || {
                let home = home.clone();
                tauri::WebviewWindowBuilder::new(&ui, &label, tauri::WebviewUrl::CustomProtocol(url.clone()))
                    .title(title.clone())
                    .inner_size(1280.0, 800.0)
                    .min_inner_size(960.0, 600.0)
                    .maximized(true)
                    .background_color(tauri::webview::Color(12, 11, 18, 255))
                    // le plugin reste chez lui : ni autre site, ni fenêtre surgissante
                    .on_navigation(move |u| u.as_str().starts_with(&home))
                    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            };
            // l'icône du plugin, pas celle d'iBox ; refusée, la fenêtre s'ouvre quand même
            let built = match icon.and_then(|i| make().icon(i).ok()) {
                Some(b) => b.build(),
                None => make().build(),
            };
            match built {
                Ok(w) => {
                    own_taskbar_button(&w, &id);
                    let _ = w.set_focus();
                }
                Err(e) => eprintln!("iBox : écran du plugin indisponible : {e}"),
            }
        });
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icone_du_plugin_en_rgba() {
        assert_eq!(rgba(png::ColorType::Rgb, vec![1, 2, 3]), Some(vec![1, 2, 3, 255]));
        assert_eq!(rgba(png::ColorType::GrayscaleAlpha, vec![9, 7]), Some(vec![9, 9, 9, 7]));
        assert_eq!(rgba(png::ColorType::Indexed, vec![0]), None);
        // le vrai logo d'un plugin, s'il est là (dossier du dépôt iClips voisin)
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../iclips");
        if dir.join("icon.png").is_file() {
            let icon = window_icon(&dir).expect("icon.png d'iClips lisible");
            assert_eq!(icon.rgba().len() as u32, icon.width() * icon.height() * 4);
        }
    }

    #[test]
    fn textes_traduits_d_un_plugin_installe() {
        // manifeste d'avant les traductions (base en français), catalogue traduit
        let m = Manifest::parse(br#"{ "id": "iclips", "name": "iClips", "version": "0.9.2", "author": { "name": "atzski" },
            "description": "Le studio de vos clips.", "permissions": ["clips"], "screen": { "entry": "ui/studio.html", "title": "iClips Studio" } }"#).unwrap();
        let entry: catalog::Entry = serde_json::from_value(serde_json::json!({ "id": "iclips", "name": "iClips", "version": "0.9.3",
            "author": { "name": "atzski" }, "url": "https://x/y", "sha256": "a".repeat(64), "signature": "s",
            "description": "Your game clip studio.", "notes": "Fixes.", "i18n": { "fr": { "description": "Le studio de vos clips de jeu.", "notes": "Corrections." } } })).unwrap();
        let (_, description, i18n) = installed_texts(&m, Some(&entry));
        assert_eq!(description, "Your game clip studio.");
        assert_eq!(i18n["fr"].description.as_deref(), Some("Le studio de vos clips de jeu."));
        assert_eq!(i18n["fr"].notes.as_deref(), Some("Corrections."));
        // hors ligne, sans catalogue : le manifeste tel quel
        assert_eq!(installed_texts(&m, None).1, "Le studio de vos clips.");
        // un manifeste traduit l'emporte sur une entrée de catalogue qui ne l'est pas
        let mut tm = m.clone();
        tm.i18n.insert("fr".into(), manifest::Texts { screen: Some("Studio iClips".into()), ..Default::default() });
        let mut plain = entry.clone();
        plain.i18n.clear();
        assert_eq!(installed_texts(&tm, Some(&plain)).1, "Le studio de vos clips.");
        assert_eq!(screen_title(&tm, "fr"), "Studio iClips");
        assert_eq!(screen_title(&tm, "en"), "iClips Studio");
        assert_eq!(plugin_lang(None), "en");
        assert_eq!(plugin_lang(Some("de")), "en");
    }

    #[test]
    fn version_order() {
        assert!(newer("1.0.10", "1.0.9"));
        assert!(!newer("1.0.0", "1.0.0"));
        assert!(!newer("x", "1.0.0"));
    }
}
