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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginList {
    pub plugins: Vec<PluginView>,
    pub catalog_error: Option<String>,
    pub platform_supported: bool,
}

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
        out.push(PluginView {
            id: id.clone(),
            name: m.name.clone(),
            description: m.description.clone(),
            author: catalog::Author { name: entry.map(|e| e.author.name.clone()).unwrap_or_else(|| m.author.name.clone()), inetbox: m.author.inetbox.clone().or_else(|| entry.and_then(|e| e.author.inetbox.clone())), username: m.author.username.clone() },
            permissions: m.permissions.clone(),
            icon: dir.as_deref().and_then(icon_of).or_else(|| entry.and_then(|e| e.icon.clone())),
            installed: Some(InstalledView { version: p.version.clone(), enabled: p.enabled, granted: p.granted.clone() }),
            update: entry.is_some_and(|e| newer(&e.version, &p.version) && compatible(e)),
            available: entry.map(|e| AvailableView { version: e.version.clone(), notes: e.notes.clone(), size: e.size, compatible: compatible(e) }),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_order() {
        assert!(newer("1.0.10", "1.0.9"));
        assert!(!newer("1.0.0", "1.0.0"));
        assert!(!newer("x", "1.0.0"));
    }
}
