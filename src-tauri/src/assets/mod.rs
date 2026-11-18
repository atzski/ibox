//! iBox Asset Manager — illustrations des consoles.
//!
//! Séparation des rôles :
//! - `iidb` : accès au fournisseur (clé, requêtes, limites) ;
//! - ici : correspondances console ↔ plateforme, choix des images, téléchargement,
//!   cache local (`<media>/platforms/<console>/<emplacement>.<ext>`) et préférences.
//!
//! Ordre de priorité d'un emplacement : fichier importé par l'utilisateur, puis image
//! iiDB choisie à la main, puis image iiDB recommandée ; sans rien, l'interface
//! affiche son propre habillage. Une synchronisation ne remplace jamais un choix manuel.

pub mod games;
pub mod sounds;
pub mod music;
pub mod iidb;

use crate::library::time::now_iso;
use crate::metadata::media::{sniff, MAX_IMAGE_BYTES};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub type Result<T> = std::result::Result<T, String>;

/// Ligne du catalogue local d'une illustration de console.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlatformArt {
    pub platform_id: String,
    pub slot: String,
    pub provider: String,
    pub asset_id: Option<i64>,
    pub revision: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub choice: String,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlatformLink {
    pub platform_id: String,
    pub status: String,
    pub remote_id: Option<i64>,
    pub remote_name: Option<String>,
    pub candidates: Vec<(i64, String)>,
}

fn valid_slot(slot: &str) -> Result<()> {
    if iidb::PLATFORM_SLOTS.contains(&slot) {
        Ok(())
    } else {
        Err(format!("Emplacement inconnu : {slot}"))
    }
}

fn valid_platform(id: &str) -> Result<()> {
    if !id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        Ok(())
    } else {
        Err("Console inconnue.".into())
    }
}

/// Taille minimale utile d'une image selon l'emplacement (une image trop petite
/// ne doit pas être étirée sur une grande surface).
fn min_size(slot: &str) -> (u32, u32) {
    match slot {
        "platform_hero" => (960, 240),
        "platform_logo" => (160, 40),
        _ => (64, 64),
    }
}

/// Valide une image (format réel, poids, dimensions) et l'enregistre dans le cache.
#[allow(clippy::too_many_arguments)]
pub fn save(
    conn: &Connection,
    media_root: &Path,
    platform_id: &str,
    slot: &str,
    bytes: &[u8],
    provider: &str,
    choice: &str,
    asset: Option<&iidb::Artwork>,
) -> Result<PlatformArt> {
    valid_platform(platform_id)?;
    valid_slot(slot)?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("Image trop volumineuse (25 Mo maximum).".into());
    }
    let ext = sniff(bytes).ok_or("Ce n'est pas une image PNG, JPEG, WebP ou GIF.")?;
    let size = imagesize::blob_size(bytes).map_err(|_| "Image illisible.".to_string())?;
    let (mw, mh) = min_size(slot);
    if size.width < mw as usize || size.height < mh as usize || size.width > 12_000 || size.height > 12_000 {
        return Err(format!("Image trop petite pour cet emplacement ({}×{}).", size.width, size.height));
    }
    let dir = media_root.join("platforms").join(platform_id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let rel = format!("platforms/{platform_id}/{slot}.{ext}");
    let tmp = dir.join(format!("{slot}.tmp"));
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    for other in ["png", "jpg", "webp", "gif"] {
        if other != ext {
            let _ = std::fs::remove_file(dir.join(format!("{slot}.{other}")));
        }
    }
    std::fs::rename(&tmp, media_root.join(&rel)).map_err(|e| e.to_string())?;
    let now = now_iso();
    conn.execute(
        "INSERT INTO platform_assets (platform_id, slot, provider, asset_id, revision, source_url, file, width, height, format, region, choice, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT (platform_id, slot) DO UPDATE SET
           provider = excluded.provider, asset_id = excluded.asset_id, revision = excluded.revision,
           source_url = excluded.source_url, file = excluded.file, width = excluded.width, height = excluded.height,
           format = excluded.format, region = excluded.region, choice = excluded.choice, added_at = excluded.added_at",
        params![
            platform_id,
            slot,
            provider,
            asset.map(|a| a.id),
            asset.map(|a| a.revision.clone()),
            asset.map(|a| a.url.clone()),
            rel,
            size.width as i64,
            size.height as i64,
            ext,
            asset.and_then(|a| a.region.clone()),
            choice,
            now
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(PlatformArt {
        platform_id: platform_id.into(),
        slot: slot.into(),
        provider: provider.into(),
        asset_id: asset.map(|a| a.id),
        revision: asset.map(|a| a.revision.clone()),
        width: Some(size.width as i64),
        height: Some(size.height as i64),
        choice: choice.into(),
        added_at: now,
    })
}

pub fn list(conn: &Connection) -> Result<Vec<PlatformArt>> {
    let mut stmt = conn
        .prepare("SELECT platform_id, slot, provider, asset_id, revision, width, height, choice, added_at FROM platform_assets ORDER BY platform_id, slot")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(PlatformArt {
                platform_id: r.get(0)?,
                slot: r.get(1)?,
                provider: r.get(2)?,
                asset_id: r.get(3)?,
                revision: r.get(4)?,
                width: r.get(5)?,
                height: r.get(6)?,
                choice: r.get(7)?,
                added_at: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())
}

pub fn links(conn: &Connection) -> Result<Vec<PlatformLink>> {
    let mut stmt = conn
        .prepare("SELECT platform_id, status, remote_id, remote_name, candidates FROM platform_links ORDER BY platform_id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let cands: Option<String> = r.get(4)?;
            Ok(PlatformLink {
                platform_id: r.get(0)?,
                status: r.get(1)?,
                remote_id: r.get(2)?,
                remote_name: r.get(3)?,
                candidates: cands.and_then(|c| serde_json::from_str(&c).ok()).unwrap_or_default(),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())
}

/// Chemin du fichier d'un emplacement (jamais en dehors du cache).
pub fn file_of(conn: &Connection, media_root: &Path, platform_id: &str, slot: &str) -> Result<Option<PathBuf>> {
    let rel: Option<String> = conn
        .query_row("SELECT file FROM platform_assets WHERE platform_id = ?1 AND slot = ?2", params![platform_id, slot], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    match rel {
        Some(r) if !r.contains("..") && r.starts_with("platforms/") => Ok(Some(media_root.join(r))),
        Some(_) => Err("Chemin d'image invalide.".into()),
        None => Ok(None),
    }
}

/// Retire l'image d'un emplacement (la prochaine synchronisation reprend la recommandation).
pub fn reset(conn: &Connection, media_root: &Path, platform_id: &str, slot: &str) -> Result<()> {
    valid_slot(slot)?;
    if let Some(p) = file_of(conn, media_root, platform_id, slot)? {
        let _ = std::fs::remove_file(p);
    }
    conn.execute("DELETE FROM platform_assets WHERE platform_id = ?1 AND slot = ?2", params![platform_id, slot])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn save_link(conn: &Connection, platform_id: &str, m: &iidb::PlatformMatch) -> Result<()> {
    let (remote_id, remote_name) = m.platform.clone().map(|(i, n)| (Some(i), Some(n))).unwrap_or((None, None));
    let status = match m.status.as_str() {
        "matched" | "needs_choice" | "not_found" => m.status.as_str(),
        _ => "not_found",
    };
    let cands = (!m.candidates.is_empty()).then(|| serde_json::to_string(&m.candidates).unwrap_or_default());
    conn.execute(
        "INSERT INTO platform_links (platform_id, provider, status, remote_id, remote_name, candidates, resolved_at, console_id)
         VALUES (?1, 'iidb', ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (platform_id) DO UPDATE SET
           status = CASE WHEN platform_links.status = 'manual' AND excluded.status <> 'matched' THEN 'manual' ELSE excluded.status END,
           remote_id = coalesce(excluded.remote_id, platform_links.remote_id),
           remote_name = coalesce(excluded.remote_name, platform_links.remote_name),
           candidates = excluded.candidates, resolved_at = excluded.resolved_at,
           console_id = coalesce(excluded.console_id, platform_links.console_id)",
        params![platform_id, status, remote_id, remote_name, cands, now_iso(), m.console_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Associe à la main une console iBox à une plateforme iiDB.
pub fn choose_link(conn: &Connection, platform_id: &str, remote_id: i64, remote_name: &str) -> Result<()> {
    valid_platform(platform_id)?;
    conn.execute(
        "INSERT INTO platform_links (platform_id, provider, status, remote_id, remote_name, candidates, resolved_at)
         VALUES (?1, 'iidb', 'manual', ?2, ?3, NULL, ?4)
         ON CONFLICT (platform_id) DO UPDATE SET status = 'manual', remote_id = excluded.remote_id,
           remote_name = excluded.remote_name, candidates = NULL, resolved_at = excluded.resolved_at",
        params![platform_id, remote_id, remote_name, now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn remote_id_of(conn: &Connection, platform_id: &str) -> Option<i64> {
    conn.query_row(
        "SELECT remote_id FROM platform_links WHERE platform_id = ?1 AND status IN ('matched', 'manual')",
        [platform_id],
        |r| r.get(0),
    )
    .optional()
    .ok()
    .flatten()
}

/// Ce qu'une synchronisation doit faire pour un emplacement.
#[derive(Debug, PartialEq)]
pub enum SlotPlan {
    /// Choix de l'utilisateur : on n'y touche pas.
    KeepManual,
    /// Déjà à jour (même asset, même révision).
    UpToDate,
    Download,
}

pub fn plan_slot(current: Option<(&str, Option<i64>, Option<&str>)>, best: &iidb::Artwork) -> SlotPlan {
    match current {
        Some((choice, _, _)) if choice != "auto" => SlotPlan::KeepManual,
        Some((_, Some(id), rev)) if id == best.id && rev.unwrap_or("") == best.revision => SlotPlan::UpToDate,
        _ => SlotPlan::Download,
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub platforms: usize,
    pub matched: usize,
    pub needs_choice: usize,
    pub not_found: usize,
    pub downloaded: usize,
    pub up_to_date: usize,
    pub kept_manual: usize,
    pub failed: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress {
    pub done: usize,
    pub total: usize,
    pub current: String,
}

/// Synchronise les illustrations des consoles : résolution groupée (25 par requête),
/// puis téléchargement progressif, une image à la fois.
pub fn sync_platforms(
    db_path: &Path,
    media_root: &Path,
    client: &iidb::Client,
    download: &dyn Fn(&str) -> Result<Vec<u8>>,
    lookups: &[iidb::PlatformLookup],
    progress: &dyn Fn(SyncProgress),
) -> Result<SyncReport> {
    let conn = crate::db::open(db_path).map_err(|e| e.to_string())?;
    let mut report = SyncReport { platforms: lookups.len(), ..Default::default() };
    let mut todo: Vec<(String, String, iidb::Artwork, Vec<iidb::Artwork>)> = Vec::new();

    for chunk in lookups.chunks(iidb::BATCH_MAX) {
        let rows: Vec<_> = chunk
            .iter()
            .filter(|l| valid_platform(&l.id).is_ok())
            .map(|l| iidb::lookup_body(remote_id_of(&conn, &l.id), l))
            .collect();
        let results = client.resolve_platforms(&rows).map_err(|e| e.to_string())?;
        for (l, m) in chunk.iter().zip(results) {
            save_link(&conn, &l.id, &m)?;
            match m.status.as_str() {
                "matched" => report.matched += 1,
                "needs_choice" => report.needs_choice += 1,
                _ => report.not_found += 1,
            }
            if m.platform.is_none() {
                continue;
            }
            for (slot, cands) in m.artwork {
                // images fixes uniquement : l'interface reste calme
                let mut cands: Vec<_> = cands.into_iter().filter(|a| !a.is_animated).collect();
                if cands.is_empty() {
                    continue;
                }
                let best = cands.remove(0);
                let current: Option<(String, Option<i64>, Option<String>)> = conn
                    .query_row(
                        "SELECT choice, asset_id, revision FROM platform_assets WHERE platform_id = ?1 AND slot = ?2",
                        params![l.id, slot],
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?;
                match plan_slot(current.as_ref().map(|(c, i, r)| (c.as_str(), *i, r.as_deref())), &best) {
                    SlotPlan::KeepManual => report.kept_manual += 1,
                    SlotPlan::UpToDate => report.up_to_date += 1,
                    SlotPlan::Download => todo.push((l.id.clone(), slot, best, cands)),
                }
            }
        }
    }

    let total = todo.len();
    for (i, (pid, slot, best, rest)) in todo.into_iter().enumerate() {
        progress(SyncProgress { done: i, total, current: format!("{pid} · {slot}") });
        // la recommandation, puis les suivantes si elle est indisponible ou trop petite
        let mut ok = false;
        let mut last_err = String::new();
        for a in std::iter::once(&best).chain(rest.iter()) {
            match download(&a.url).and_then(|b| save(&conn, media_root, &pid, &slot, &b, "iidb", "auto", Some(a))) {
                Ok(_) => {
                    ok = true;
                    break;
                }
                Err(e) => last_err = e,
            }
        }
        if ok {
            report.downloaded += 1;
        } else {
            report.failed += 1;
            if report.errors.len() < 5 {
                report.errors.push(format!("{pid} ({slot}) : {last_err}"));
            }
        }
    }
    progress(SyncProgress { done: total, total, current: String::new() });
    Ok(report)
}

// ——— Commandes ———

pub mod commands {
    use super::*;
    use crate::library::commands::LibraryState;
    use crate::metadata::commands::MetadataState;
    use crate::metadata::keys;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri::{AppHandle, Emitter, Manager, State};

    static SYNCING: AtomicBool = AtomicBool::new(false);

    fn client() -> Result<iidb::Client> {
        let key = keys::get(iidb::KEY).map_err(|e| e.to_string())?.ok_or("Connectez d'abord iiDB (Paramètres › Sources graphiques).")?;
        iidb::Client::new(&key).map_err(|e| e.to_string())
    }

    async fn run<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
        tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct AssetsStatus {
        connected: bool,
        linked: usize,
        assets: usize,
        cache_bytes: u64,
    }

    #[tauri::command]
    pub fn assets_status(lib: State<LibraryState>, meta: State<MetadataState>) -> Result<AssetsStatus> {
        let (linked, assets) = lib
            .with(|c| {
                let l: i64 = c.query_row("SELECT count(*) FROM platform_links WHERE status IN ('matched','manual')", [], |r| r.get(0))?;
                let a: i64 = c.query_row("SELECT count(*) FROM platform_assets", [], |r| r.get(0))?;
                Ok((l as usize, a as usize))
            })
            .map_err(|e| e.to_string())?;
        let dir = meta.media.root().join("platforms");
        Ok(AssetsStatus { connected: keys::has(iidb::KEY), linked, assets, cache_bytes: dir_size(&dir) })
    }

    fn dir_size(p: &Path) -> u64 {
        std::fs::read_dir(p)
            .map(|it| {
                it.flatten()
                    .map(|e| match e.metadata() {
                        Ok(m) if m.is_dir() => dir_size(&e.path()),
                        Ok(m) => m.len(),
                        Err(_) => 0,
                    })
                    .sum()
            })
            .unwrap_or(0)
    }

    /// Vérifie la clé (`GET /me/access`) puis la range dans le coffre Windows.
    #[tauri::command]
    pub async fn iidb_connect(key: String) -> Result<iidb::Access> {
        run(move || {
            let c = iidb::Client::new(&key).map_err(|e| e.to_string())?;
            let access = c.access().map_err(|e| e.to_string())?;
            keys::set(iidb::KEY, key.trim()).map_err(|e| e.to_string())?;
            Ok(access)
        })
        .await
    }

    #[tauri::command]
    pub async fn iidb_access() -> Result<iidb::Access> {
        run(|| client()?.access().map_err(|e| e.to_string())).await
    }

    #[tauri::command]
    pub fn iidb_disconnect() -> Result<()> {
        keys::delete(iidb::KEY).map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub async fn platform_art_sync(app: AppHandle, lookups: Vec<iidb::PlatformLookup>) -> Result<SyncReport> {
        if SYNCING.swap(true, Ordering::SeqCst) {
            return Err("Une synchronisation est déjà en cours.".into());
        }
        let out = run(move || {
            let c = client()?;
            let db_path = app.state::<LibraryState>().db_path().to_path_buf();
            let meta = app.state::<MetadataState>();
            let root = meta.media.root().to_path_buf();
            let http = meta.http.clone();
            let download = move |url: &str| -> Result<Vec<u8>> {
                let u = crate::metadata::commands::check_image_link(url).map_err(|e| e.to_string())?;
                http.bytes(u.as_str(), MAX_IMAGE_BYTES, "l'illustration").map_err(|e| e.to_string())
            };
            let emit = |p: SyncProgress| {
                let _ = app.emit("platform-art-progress", p);
            };
            sync_platforms(&db_path, &root, &c, &download, &lookups, &emit)
        })
        .await;
        SYNCING.store(false, Ordering::SeqCst);
        out
    }

    #[tauri::command]
    pub fn platform_art_list(lib: State<LibraryState>) -> Result<(Vec<PlatformArt>, Vec<PlatformLink>)> {
        lib.with(|c| Ok((list(c), links(c)))).map_err(|e| e.to_string()).and_then(|(a, l)| Ok((a?, l?)))
    }

    #[tauri::command]
    pub fn platform_art_read(lib: State<LibraryState>, meta: State<MetadataState>, platform_id: String, slot: String) -> Result<tauri::ipc::Response> {
        let path = lib
            .with(|c| Ok(file_of(c, meta.media.root(), &platform_id, &slot)))
            .map_err(|e| e.to_string())??
            .ok_or("Aucune image.")?;
        std::fs::read(path).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub async fn platform_art_gallery(app: AppHandle, platform_id: String, slot: String, cursor: Option<String>) -> Result<iidb::GalleryPage> {
        valid_slot(&slot)?;
        run(move || {
            let remote = app
                .state::<LibraryState>()
                .with(|c| Ok(remote_id_of(c, &platform_id)))
                .map_err(|e| e.to_string())?
                .ok_or("Cette console n'est pas encore associée à iiDB.")?;
            let mut page = client()?.platform_gallery(remote, &slot, cursor.as_deref()).map_err(|e| e.to_string())?;
            page.items.retain(|a| !a.is_animated);
            Ok(page)
        })
        .await
    }

    /// Choix manuel dans une galerie : prioritaire sur les synchronisations suivantes.
    #[tauri::command]
    pub async fn platform_art_choose(app: AppHandle, platform_id: String, slot: String, asset: iidb::Artwork) -> Result<PlatformArt> {
        run(move || {
            let meta = app.state::<MetadataState>();
            let u = crate::metadata::commands::check_image_link(&asset.url).map_err(|e| e.to_string())?;
            let bytes = meta.http.bytes(u.as_str(), MAX_IMAGE_BYTES, "l'illustration").map_err(|e| e.to_string())?;
            let root = meta.media.root().to_path_buf();
            app.state::<LibraryState>()
                .with(|c| Ok(save(c, &root, &platform_id, &slot, &bytes, "iidb", "manual", Some(&asset))))
                .map_err(|e| e.to_string())?
        })
        .await
    }

    /// Fichier local choisi par l'utilisateur (copié dans le cache, l'original reste intact).
    #[tauri::command]
    pub fn platform_art_import(lib: State<LibraryState>, meta: State<MetadataState>, platform_id: String, slot: String, path: String) -> Result<PlatformArt> {
        let len = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
        if len as usize > MAX_IMAGE_BYTES {
            return Err("Image trop volumineuse (25 Mo maximum).".into());
        }
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        lib.with(|c| Ok(save(c, meta.media.root(), &platform_id, &slot, &bytes, "user", "user", None)))
            .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub fn platform_art_reset(lib: State<LibraryState>, meta: State<MetadataState>, platform_id: String, slot: String) -> Result<()> {
        lib.with(|c| Ok(reset(c, meta.media.root(), &platform_id, &slot))).map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn iidb_search_platforms(q: String) -> Result<Vec<(i64, String)>> {
        let q = q.trim().chars().take(80).collect::<String>();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        run(move || client()?.search_platforms(&q).map_err(|e| e.to_string())).await
    }

    static GAMES_SYNCING: AtomicBool = AtomicBool::new(false);
    static GAMES_CANCEL: AtomicBool = AtomicBool::new(false);

    /// Illustrations des jeux : correspondances puis emplacements vides complétés.
    #[tauri::command]
    pub async fn games_art_sync(app: AppHandle) -> Result<games::GameSyncReport> {
        if GAMES_SYNCING.swap(true, Ordering::SeqCst) {
            return Err("Une récupération est déjà en cours.".into());
        }
        GAMES_CANCEL.store(false, Ordering::SeqCst);
        let out = run(move || {
            let c = client()?;
            let db_path = app.state::<LibraryState>().db_path().to_path_buf();
            let meta = app.state::<MetadataState>();
            let http = meta.http.clone();
            let download = move |url: &str| -> Result<Vec<u8>> {
                let u = crate::metadata::commands::check_image_link(url).map_err(|e| e.to_string())?;
                http.bytes(u.as_str(), MAX_IMAGE_BYTES, "l'illustration").map_err(|e| e.to_string())
            };
            let emit = |p: games::GameSyncProgress| {
                let _ = app.emit("games-art-progress", p);
            };
            games::sync_games(&games::SyncCtx {
                db_path: &db_path,
                media: &meta.media,
                client: &c,
                download: &download,
                progress: &emit,
                cancel: &GAMES_CANCEL,
            })
        })
        .await;
        GAMES_SYNCING.store(false, Ordering::SeqCst);
        out
    }

    fn sounds_dir(app: &AppHandle) -> std::path::PathBuf {
        app.state::<MetadataState>().media.root().join("sounds")
    }

    /// Télécharge les jingles des jeux de la bibliothèque (accord de l'utilisateur requis côté interface).
    #[tauri::command]
    pub async fn sounds_sync(app: AppHandle) -> Result<sounds::SoundReport> {
        if GAMES_SYNCING.swap(true, Ordering::SeqCst) {
            return Err("Une récupération est déjà en cours.".into());
        }
        GAMES_CANCEL.store(false, Ordering::SeqCst);
        let out = run(move || {
            let c = client()?;
            let db_path = app.state::<LibraryState>().db_path().to_path_buf();
            let meta = app.state::<MetadataState>();
            let http = meta.http.clone();
            let download = move |url: &str| -> Result<Vec<u8>> {
                let u = crate::metadata::commands::check_image_link(url).map_err(|e| e.to_string())?;
                http.bytes(u.as_str(), sounds::MAX_SOUND_BYTES, "le son").map_err(|e| e.to_string())
            };
            let emit = |p: games::GameSyncProgress| {
                let _ = app.emit("games-art-progress", p);
            };
            let ctx = games::SyncCtx { db_path: &db_path, media: &meta.media, client: &c, download: &download, progress: &emit, cancel: &GAMES_CANCEL };
            sounds::sync(&ctx, &sounds_dir(&app))
        })
        .await;
        GAMES_SYNCING.store(false, Ordering::SeqCst);
        out
    }

    /// Nombre de jingles et place occupée.
    #[tauri::command]
    pub fn sounds_status(app: AppHandle) -> (usize, u64) {
        let dir = sounds_dir(&app);
        let n = std::fs::read_dir(&dir).map(|it| it.flatten().count()).unwrap_or(0);
        (n, dir_size(&dir))
    }

    /// Retire tous les jingles (le dossier est vidé).
    #[tauri::command]
    pub fn sounds_clear(app: AppHandle) -> Result<()> {
        let dir = sounds_dir(&app);
        if dir.exists() {
            sounds::clear_downloaded(&dir)?;
        }
        Ok(())
    }

    /// Jingle personnel : un fichier audio choisi par l'utilisateur, copié pour ce jeu.
    #[tauri::command]
    pub fn game_sound_import(app: AppHandle, game_id: i64, path: String) -> Result<()> {
        sounds::import(&sounds_dir(&app), game_id, Path::new(&path))
    }

    #[tauri::command]
    pub fn game_sound_remove_custom(app: AppHandle, game_id: i64) -> Result<()> {
        sounds::remove_custom(&sounds_dir(&app), game_id)
    }

    /// (jingle personnel, un jingle disponible)
    #[tauri::command]
    pub fn game_sound_info(app: AppHandle, game_id: i64) -> (bool, bool) {
        let dir = sounds_dir(&app);
        (sounds::find_custom(&dir, game_id).is_some(), sounds::find(&dir, game_id).is_some())
    }

    // ——— Collections : logo (iiDB / SteamGridDB) et fond (SteamGridDB) ———

    #[tauri::command]
    pub async fn collection_iidb_search(q: String) -> Result<Vec<iidb::GameCandidate>> {
        let q = q.trim().chars().take(100).collect::<String>();
        if q.chars().count() < 2 { return Ok(Vec::new()); }
        run(move || client()?.search_parents(&q).map_err(|e| e.to_string())).await
    }

    #[tauri::command]
    pub async fn collection_iidb_collections(q: String) -> Result<Vec<iidb::CollectionCandidate>> {
        let q = q.trim().chars().take(100).collect::<String>();
        if q.is_empty() { return Ok(Vec::new()); }
        run(move || client()?.search_collections(&q).map_err(|e| e.to_string())).await
    }

    #[tauri::command]
    pub async fn collection_iidb_browse(app: AppHandle, offset: u32) -> Result<serde_json::Value> {
        let http = app.state::<MetadataState>().http.clone();
        run(move || {
            let url = format!("https://iidb.iisu.network/api/v1/assets/browse/enriched?asset_type=collection_icon&limit=30&skip={offset}");
            let body = http.bytes(&url, 512 * 1024, "le catalogue iiDB").map_err(|e| e.to_string())?;
            let page: serde_json::Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
            let items = page["items"].as_array().ok_or("Catalogue iiDB illisible.")?;
            let total = page["total"].as_u64().ok_or("Catalogue iiDB illisible.")?;
            let icons: Vec<_> = items.iter().map(|item| serde_json::json!({
                "url": item["raw_url"],
                "thumb": item["preview_url"].as_str().or_else(|| item["raw_url"].as_str()),
            })).collect();
            let end = u64::from(offset) + items.len() as u64;
            Ok(serde_json::json!({
                "icons": icons,
                "nextOffset": (!items.is_empty() && end < total).then_some(end),
            }))
        }).await
    }

    #[tauri::command]
    pub async fn collection_iidb_icons(collection_id: i64) -> Result<Vec<iidb::Artwork>> {
        run(move || Ok(client()?.collection_icons(collection_id).map_err(|e| e.to_string())?.items)).await
    }

    #[tauri::command]
    pub async fn collection_iidb_logos(parent_id: i64) -> Result<Vec<iidb::Artwork>> {
        run(move || Ok(client()?.parent_gallery(parent_id, "logo", None).map_err(|e| e.to_string())?.items)).await
    }

    #[tauri::command]
    pub async fn collection_sgdb_images(app: AppHandle, id: u64, kind: String) -> Result<Vec<crate::metadata::steamgriddb::Image>> {
        let http = app.state::<MetadataState>().http.clone();
        run(move || crate::metadata::steamgriddb::collection_images(&http, id, &kind).map_err(|e| e.to_string())).await
    }

    fn collection_file(app: &AppHandle, id: i64, kind: &str) -> Result<std::path::PathBuf> {
        if !matches!(kind, "logo" | "hero" | "icon") { return Err("Type invalide.".into()); }
        Ok(app.state::<MetadataState>().media.root().join("collections").join(format!("{id}-{kind}")))
    }

    /// Télécharge l'image choisie (hôtes iiDB / SteamGridDB) et la range pour la collection.
    #[tauri::command]
    pub async fn collection_art_set(app: AppHandle, id: i64, kind: String, url: String) -> Result<()> {
        let path = collection_file(&app, id, &kind)?;
        let host_ok = reqwest::Url::parse(&url).ok().and_then(|u| u.host_str().map(str::to_ascii_lowercase))
            .is_some_and(|h| h.ends_with(".iisu.network") || h == "cdn2.steamgriddb.com" || h == "cdn.steamgriddb.com" || h == "play.pokemonshowdown.com");
        // émojis animées Noto (Google Fonts) : seulement ce dossier
        let noto = reqwest::Url::parse(&url).ok()
            .is_some_and(|u| u.host_str() == Some("fonts.gstatic.com") && u.path().starts_with("/s/e/notoemoji/"));
        if !host_ok && !noto { return Err("Adresse d'image refusée.".into()); }
        let http = app.state::<MetadataState>().http.clone();
        run(move || {
            let u = crate::metadata::commands::check_image_link(&url).map_err(|e| e.to_string())?;
            let bytes = http.bytes(u.as_str(), MAX_IMAGE_BYTES, "l'image").map_err(|e| e.to_string())?;
            sniff(&bytes).ok_or("Format d'image incompatible.")?;
            std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
            std::fs::write(&path, &bytes).map_err(|e| e.to_string())
        }).await
    }

    /// Image ou GIF choisi sur le PC : octets bruts dans le corps, `x-id` et `x-kind` en en-têtes.
    #[tauri::command]
    pub fn collection_art_import(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<()> {
        let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_owned);
        let id: i64 = header("x-id").and_then(|v| v.parse().ok()).ok_or("Collection inconnue.")?;
        let kind = header("x-kind").ok_or("Type invalide.")?;
        let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("Image manquante.".into()) };
        if bytes.len() > MAX_IMAGE_BYTES { return Err("Image trop lourde.".into()); }
        sniff(bytes).ok_or("Format d'image incompatible (PNG, JPG, WebP ou GIF).")?;
        let path = collection_file(&app, id, &kind)?;
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::write(&path, bytes).map_err(|e| e.to_string())
    }

    /// Image iiDB / SteamGridDB téléchargée côté natif (redirections et formats gérés).
    #[tauri::command]
    pub async fn image_fetch(app: AppHandle, url: String) -> Result<tauri::ipc::Response> {
        let host_ok = reqwest::Url::parse(&url).ok().and_then(|u| u.host_str().map(str::to_ascii_lowercase))
            .is_some_and(|h| h.ends_with(".iisu.network") || h.ends_with(".steamgriddb.com"));
        if !host_ok { return Err("Adresse d'image refusée.".into()); }
        let http = app.state::<MetadataState>().http.clone();
        run(move || {
            let u = crate::metadata::commands::check_image_link(&url).map_err(|e| e.to_string())?;
            let bytes = http.bytes(u.as_str(), MAX_IMAGE_BYTES, "l'image").map_err(|e| e.to_string())?;
            sniff(&bytes).ok_or("Format d'image incompatible.")?;
            Ok(tauri::ipc::Response::new(bytes))
        }).await
    }

    #[tauri::command]
    pub fn collection_art_get(app: AppHandle, id: i64, kind: String) -> Result<tauri::ipc::Response> {
        let p = collection_file(&app, id, &kind)?;
        std::fs::read(p).map(tauri::ipc::Response::new).map_err(|_| "aucune image".to_string())
    }

    #[tauri::command]
    pub fn collection_art_clear(app: AppHandle, id: i64, kind: String) -> Result<()> {
        let p = collection_file(&app, id, &kind)?;
        if p.exists() { std::fs::remove_file(p).map_err(|e| e.to_string())?; }
        Ok(())
    }

    fn music_dir(app: &AppHandle) -> std::path::PathBuf {
        app.state::<MetadataState>().media.root().join("music")
    }
    #[tauri::command]
    pub fn music_import(app: AppHandle, path: String) -> Result<String> { music::import(&music_dir(&app), Path::new(&path)) }
    #[tauri::command]
    pub fn music_list(app: AppHandle) -> Vec<String> { music::list(&music_dir(&app)) }
    #[tauri::command]
    pub fn music_remove(app: AppHandle, name: String) -> Result<()> { music::remove(&music_dir(&app), &name) }
    #[tauri::command]
    pub fn music_read(app: AppHandle, name: String) -> Result<tauri::ipc::Response> {
        music::read(&music_dir(&app), &name).map(tauri::ipc::Response::new)
    }

    /// Le jingle d'un jeu (octets bruts), s'il a été téléchargé.
    #[tauri::command]
    pub fn game_sound(app: AppHandle, game_id: i64) -> Result<tauri::ipc::Response> {
        let p = sounds::find(&sounds_dir(&app), game_id).ok_or("aucun son")?;
        std::fs::read(p).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn games_art_cancel() {
        GAMES_CANCEL.store(true, Ordering::SeqCst);
    }

    #[tauri::command]
    pub fn games_art_stats(lib: State<LibraryState>) -> Result<games::GameLinkStats> {
        lib.with(|c| Ok(games::stats(c))).map_err(|e| e.to_string())?
    }

    /// Propositions pour associer un jeu : celles d'iiDB en attente, ou une recherche libre.
    #[tauri::command]
    pub async fn game_link_candidates(app: AppHandle, game_id: i64, query: Option<String>) -> Result<Vec<iidb::GameCandidate>> {
        run(move || {
            let q = query.map(|q| q.trim().chars().take(120).collect::<String>()).filter(|q| !q.is_empty());
            match q {
                Some(q) => client()?.search_parents(&q).map_err(|e| e.to_string()),
                None => app.state::<LibraryState>().with(|c| Ok(games::candidates_of(c, game_id))).map_err(|e| e.to_string()),
            }
        })
        .await
    }

    #[tauri::command]
    pub fn game_link_choose(lib: State<LibraryState>, game_id: i64, parent_id: i64, name: String) -> Result<()> {
        lib.with(|c| Ok(games::choose_link(c, game_id, parent_id, &name))).map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub fn platform_link_choose(lib: State<LibraryState>, platform_id: String, remote_id: i64, remote_name: String) -> Result<()> {
        lib.with(|c| Ok(choose_link(c, &platform_id, remote_id, &remote_name))).map_err(|e| e.to_string())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn png(w: u32, h: u32) -> Vec<u8> {
        crate::metadata::media::tests::tiny_png(w, h)
    }

    fn art(id: i64, rev: &str) -> iidb::Artwork {
        iidb::Artwork {
            id,
            kind: "platform_icon".into(),
            url: format!("https://assets.iisu.network/{id}.png"),
            revision: rev.into(),
            region: None,
            thumbnail_url: None,
            resolution: None,
            display_name: None,
            is_animated: false,
            mime_type: None,
        }
    }

    #[test]
    fn cache_priorites_et_reinitialisation() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = db::open_in_memory().unwrap();
        let a = art(11, "r1");
        save(&conn, tmp.path(), "gamecube", "platform_icon", &png(128, 128), "iidb", "auto", Some(&a)).unwrap();
        assert!(tmp.path().join("platforms/gamecube/platform_icon.png").is_file());
        let rows = list(&conn).unwrap();
        assert_eq!((rows[0].asset_id, rows[0].width), (Some(11), Some(128)));

        // même asset, même révision : rien à faire ; nouvelle révision : téléchargement
        assert_eq!(plan_slot(Some(("auto", Some(11), Some("r1"))), &a), SlotPlan::UpToDate);
        assert_eq!(plan_slot(Some(("auto", Some(11), Some("r1"))), &art(11, "r2")), SlotPlan::Download);
        // un choix manuel ou un fichier importé ne sont jamais remplacés
        assert_eq!(plan_slot(Some(("manual", Some(5), None)), &a), SlotPlan::KeepManual);
        assert_eq!(plan_slot(Some(("user", None, None)), &a), SlotPlan::KeepManual);
        assert_eq!(plan_slot(None, &a), SlotPlan::Download);

        // une bannière trop petite est refusée (pas d'image étirée)
        assert!(save(&conn, tmp.path(), "gamecube", "platform_hero", &png(300, 100), "iidb", "auto", None).is_err());
        // pas une image, emplacement ou console douteux
        assert!(save(&conn, tmp.path(), "gamecube", "platform_icon", b"<html>", "iidb", "auto", None).is_err());
        assert!(save(&conn, tmp.path(), "gamecube", "cover", &png(128, 128), "iidb", "auto", None).is_err());
        assert!(save(&conn, tmp.path(), "../x", "platform_icon", &png(128, 128), "iidb", "auto", None).is_err());

        reset(&conn, tmp.path(), "gamecube", "platform_icon").unwrap();
        assert!(list(&conn).unwrap().is_empty());
        assert!(!tmp.path().join("platforms/gamecube/platform_icon.png").exists());
    }

    #[test]
    fn correspondances_de_consoles() {
        let conn = db::open_in_memory().unwrap();
        let m = |status: &str, p: Option<(i64, &str)>| iidb::PlatformMatch {
            status: status.into(),
            platform: p.map(|(i, n)| (i, n.to_string())),
            console_id: None,
            candidates: vec![(3, "Nintendo DS".into())],
            artwork: vec![],
        };
        save_link(&conn, "gamecube", &m("matched", Some((7, "Nintendo GameCube")))).unwrap();
        save_link(&conn, "pc", &m("needs_choice", None)).unwrap();
        assert_eq!(remote_id_of(&conn, "gamecube"), Some(7));
        assert_eq!(remote_id_of(&conn, "pc"), None);
        let l = links(&conn).unwrap();
        assert_eq!(l.iter().find(|x| x.platform_id == "pc").unwrap().candidates.len(), 1);

        // choix manuel : gardé même si une résolution suivante est ambiguë
        choose_link(&conn, "pc", 42, "PC (Windows)").unwrap();
        save_link(&conn, "pc", &m("needs_choice", None)).unwrap();
        let pc = links(&conn).unwrap().into_iter().find(|x| x.platform_id == "pc").unwrap();
        assert_eq!((pc.status.as_str(), pc.remote_id), ("manual", Some(42)));
    }
}
