//! Commandes Tauri des métadonnées. Les opérations réseau tournent dans des
//! fils dédiés ; l'interface reste réactive.

use super::http::Http;
use super::job::{download_image, Job, JobProgress, JobSummary};
use super::matching::{decide, name_key, Decision};
use super::media::{MediaRow, MediaStore};
use super::{gametdb, keys, launchbox, libretro_system, libretro_thumbs, steamgriddb, Candidate, FetchOptions, MediaKind, MetaError};
use crate::library::commands::LibraryState;
use crate::db;
use rusqlite::params;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct MetadataState {
    pub media: Arc<MediaStore>,
    pub http: Arc<Http>,
    running: AtomicBool,
    cancel: Arc<AtomicBool>,
}

impl MetadataState {
    pub fn open(app: &AppHandle) -> Result<Self, String> {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("media");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(Self {
            media: Arc::new(MediaStore::new(dir)),
            http: Arc::new(Http::new().map_err(|e| e.to_string())?),
            running: AtomicBool::new(false),
            cancel: Arc::new(AtomicBool::new(false)),
        })
    }
}

type Res<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Exécute un travail bloquant avec sa propre connexion à la base.
async fn blocking<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce(&rusqlite::Connection, &MetadataState) -> Result<T, MetaError> + Send + 'static,
) -> Res<T> {
    let db_path = app.state::<LibraryState>().db_path().to_path_buf();
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db::open(&db_path).map_err(err)?;
        let state = app2.state::<MetadataState>();
        f(&conn, &state).map_err(err)
    })
    .await
    .map_err(|e| format!("Opération interrompue : {e}"))?
}

/// Récupère informations et images. Sans `game_ids` : seulement les jeux jamais traités.
/// Progression sur l'événement `meta://progress`.
#[tauri::command]
pub async fn metadata_fetch(
    app: AppHandle,
    game_ids: Option<Vec<i64>>,
    force: bool,
    refresh_refs: bool,
    options: FetchOptions,
) -> Res<JobSummary> {
    let state = app.state::<MetadataState>();
    if state.running.swap(true, Ordering::SeqCst) {
        return Err(MetaError::Busy.to_string());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let emitter = app.clone();
    let result = blocking(&app, move |conn, st| {
        let job = Job { http: &st.http, store: &st.media, options: &options, force, refresh_refs, cancel: &st.cancel };
        job.run(conn, game_ids.as_deref(), |p: JobProgress| {
            let _ = emitter.emit("meta://progress", p);
        })
    })
    .await;
    app.state::<MetadataState>().running.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
pub fn metadata_cancel(state: State<MetadataState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

/// Propositions d'images pour le sélecteur (meilleures d'abord).
#[tauri::command]
pub async fn media_candidates(
    app: AppHandle,
    game_id: i64,
    kind: MediaKind,
    options: FetchOptions,
    query: Option<String>,
) -> Res<Vec<Candidate>> {
    blocking(&app, move |conn, st| {
        let pref = options.preferred_region();
        // un dos personnalisé peut venir d'une jaquette SteamGridDB (en attendant le vrai)
        let sg_kind = if kind == MediaKind::Back { MediaKind::Front } else { kind };
        let sg_ok = matches!(kind, MediaKind::Front | MediaKind::Logo | MediaKind::Hero | MediaKind::Back);
        let as_kind = |mut list: Vec<Candidate>| {
            for c in &mut list {
                c.kind = kind;
            }
            list
        };
        let (platform, title, serial, path): (String, String, Option<String>, String) = conn.query_row(
            "SELECT g.platform_id, g.title, g.serial, COALESCE(m.path, '') FROM games g
             LEFT JOIN game_files m ON m.game_id = g.id AND m.role = 'main' WHERE g.id = ?1",
            [game_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
        // Recherche libre (autre nom, ou lien d'une page SteamGridDB) : SteamGridDB et LaunchBox
        if let Some(q) = query.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
            let mut out = Vec::new();
            if options.uses("launchbox") {
                out.extend(launchbox::candidates(conn, &platform, q, kind, true, pref)?);
            }
            if sg_ok {
                if keys::has(steamgriddb::PROVIDER) {
                    out.extend(as_kind(steamgriddb::candidates(&st.http, q, sg_kind)?));
                } else if out.is_empty() {
                    return Err(MetaError::MissingKey("SteamGridDB"));
                }
            }
            return Ok(out);
        }
        let mut out: Vec<Candidate> = Vec::new();
        let mut errors: Vec<String> = Vec::new();

        if options.uses("libretro") && libretro_system(&platform).is_some() && libretro_thumbs::KINDS.contains(&kind) {
            match libretro_thumbs::ensure_index(&st.http, conn, &platform, kind, false) {
                Ok(_) => {
                    let names = libretro_thumbs::names(conn, &platform, kind)?;
                    let stem = std::path::Path::new(&path).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                    let mut picked: Vec<(String, f32)> = match decide(&stem, &title, options.preferred_region(), &names) {
                        Decision::Auto { name, confidence } => {
                            // toutes les variantes régionales du même titre
                            let key = name_key(&name);
                            let mut v: Vec<(String, f32)> = vec![(name.clone(), confidence)];
                            v.extend(names.iter().filter(|n| **n != name && name_key(n) == key).map(|n| (n.clone(), confidence - 0.05)));
                            v
                        }
                        Decision::Choose(list) => list,
                        Decision::None => Vec::new(),
                    };
                    picked.truncate(16);
                    for (name, score) in picked {
                        if let Some(url) = libretro_thumbs::url(&platform, kind, &name) {
                            out.push(Candidate { provider: "libretro", kind, thumb: url.clone(), url, label: name, width: None, height: None, score, source_game: None });
                        }
                    }
                }
                Err(e) => errors.push(format!("libretro : {e}")),
            }
        }
        // vraies faces de la boîte : LaunchBox (toutes régions), scans complets GameTDB
        if options.uses("launchbox") {
            out.extend(launchbox::candidates(conn, &platform, &title, kind, false, pref)?);
        }
        if options.uses("gametdb") && kind == MediaKind::Full {
            for url in gametdb::full_cover_urls(conn, &platform, serial.as_deref(), &title)? {
                let region = url.split('/').rev().nth(1).unwrap_or("").to_string();
                let hd = url.contains("coverfullHQ");
                out.push(Candidate {
                    provider: "gametdb",
                    kind,
                    thumb: url.clone(),
                    url,
                    label: format!("GameTDB · {region}{}", if hd { " · HD" } else { "" }),
                    width: None,
                    height: None,
                    score: 1.0,
                    source_game: None,
                });
            }
        }
        if options.uses("steamgriddb") && sg_ok && keys::has(steamgriddb::PROVIDER) {
            // jeu Steam : d'abord les images du bon jeu, trouvé par son identifiant Steam
            if let Some(appid) = steamgriddb::steam_appid(conn, game_id) {
                if let Ok(Some(hit)) = steamgriddb::game_by_steam(&st.http, &appid) {
                    if let Ok(list) = steamgriddb::candidates(&st.http, &hit.id.to_string(), sg_kind) {
                        out.extend(as_kind(list));
                    }
                }
            }
            match steamgriddb::candidates(&st.http, &title, sg_kind) {
                Ok(list) => {
                    for c in as_kind(list) {
                        if !out.iter().any(|o| o.url == c.url) {
                            out.push(c);
                        }
                    }
                }
                Err(e) => errors.push(format!("SteamGridDB : {e}")),
            }
        }
        if out.is_empty() && !errors.is_empty() {
            return Err(MetaError::Invalid(errors.join(" · ")));
        }
        Ok(out)
    })
    .await
}

/// Télécharge et applique une image choisie dans le sélecteur.
#[tauri::command]
pub async fn media_apply(
    app: AppHandle,
    game_id: i64,
    kind: MediaKind,
    url: String,
    provider: String,
    source_game: Option<u64>,
) -> Res<MediaRow> {
    blocking(&app, move |conn, st| {
        let bytes = download_image(&st.http, &url)?;
        let source = match provider.as_str() {
            steamgriddb::PROVIDER => steamgriddb::PROVIDER,
            "iidb" => "iidb",
            "launchbox" => "launchbox",
            "gametdb" => "gametdb",
            _ => "libretro",
        };
        let row = st.media.save(conn, game_id, kind, 0, &bytes, source, Some(&url))?;
        // choix de l'utilisateur : jamais remplacé automatiquement
        conn.execute("UPDATE media SET pinned = 1 WHERE game_id = ?1 AND kind = ?2 AND slot = 0", params![game_id, kind.as_str()])?;
        if kind == MediaKind::Front {
            conn.execute("UPDATE games SET media_status = 'found' WHERE id = ?1", [game_id])?;
            // jaquette SteamGridDB choisie : son fond et son logo suivent (s'ils manquent)
            if let (Some(sg), true) = (source_game, source == steamgriddb::PROVIDER) {
                for extra in [MediaKind::Hero, MediaKind::Logo] {
                    if st.media.source_of(conn, game_id, extra, 0)?.is_some() {
                        continue;
                    }
                    if let Ok(Some(img)) = steamgriddb::first_image(&st.http, extra, sg) {
                        if let Ok(bytes) = download_image(&st.http, &img.url) {
                            st.media.save(conn, game_id, extra, 0, &bytes, steamgriddb::PROVIDER, Some(&img.url))?;
                        }
                    }
                }
            }
        }
        Ok(row)
    })
    .await
}

/// Applique une image depuis un lien direct collé par l'utilisateur (dos, tranche,
/// scan complet… que les sources automatiques ne fournissent pas). Le fichier
/// téléchargé doit être une vraie image PNG, JPEG ou WebP (vérifiée à l'enregistrement).
#[tauri::command]
pub async fn media_import_url(app: AppHandle, game_id: i64, kind: MediaKind, url: String) -> Res<MediaRow> {
    blocking(&app, move |conn, st| {
        let url = check_image_link(&url)?;
        let bytes = st.http.bytes(url.as_str(), super::media::MAX_IMAGE_BYTES, "l'image")?;
        let row = st.media.save(conn, game_id, kind, 0, &bytes, "user", Some(url.as_str())).map_err(|e| match e {
            MetaError::Invalid(_) => MetaError::Invalid(
                "ce lien ne mène pas à une image (PNG, JPEG ou WebP). Ouvrez l'image seule, puis « Copier l'adresse de l'image »".into(),
            ),
            other => other,
        })?;
        if kind == MediaKind::Front || kind == MediaKind::Full {
            conn.execute("UPDATE games SET media_status = 'found' WHERE id = ?1", [game_id])?;
        }
        Ok(row)
    })
    .await
}

/// Lien acceptable : https, vers un site public (pas l'ordinateur ni le réseau local).
pub(crate) fn check_image_link(raw: &str) -> super::Result<reqwest::Url> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| MetaError::Invalid("lien invalide".into()))?;
    if url.scheme() != "https" {
        return Err(MetaError::Invalid("seuls les liens https:// sont acceptés".into()));
    }
    let host = url.host_str().unwrap_or("").trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    let local = match host.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(ip)) => ip.is_private() || ip.is_loopback() || ip.is_link_local() || ip.is_unspecified(),
        Ok(std::net::IpAddr::V6(ip)) => ip.is_loopback() || ip.is_unspecified() || (ip.segments()[0] & 0xfe00) == 0xfc00,
        Err(_) => host.is_empty() || host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") || !host.contains('.'),
    };
    if local {
        return Err(MetaError::Invalid("les adresses locales ne sont pas acceptées".into()));
    }
    Ok(url)
}

/// Importe une image choisie par l'utilisateur (copiée dans le cache ; l'original n'est pas modifié).
#[tauri::command]
pub async fn media_import(app: AppHandle, game_id: i64, kind: MediaKind, path: String) -> Res<MediaRow> {
    blocking(&app, move |conn, st| {
        let meta = std::fs::metadata(&path)?;
        if meta.len() as usize > super::media::MAX_IMAGE_BYTES {
            return Err(MetaError::Invalid("image trop volumineuse (25 Mo maximum)".into()));
        }
        let bytes = std::fs::read(&path)?;
        let row = st.media.save(conn, game_id, kind, 0, &bytes, "user", None)?;
        if kind == MediaKind::Front || kind == MediaKind::Full {
            conn.execute("UPDATE games SET media_status = 'found' WHERE id = ?1", [game_id])?;
        }
        Ok(row)
    })
    .await
}

#[tauri::command]
pub fn media_remove(lib: State<LibraryState>, meta: State<MetadataState>, game_id: i64, kind: MediaKind, slot: i64) -> Res<()> {
    lib.with(|c| {
        meta.media.remove(c, game_id, kind, slot).map_err(|e| crate::library::LibraryError::Media(e.to_string()))?;
        if kind == MediaKind::Front {
            c.execute(
                "UPDATE games SET media_status = CASE WHEN EXISTS (SELECT 1 FROM media WHERE game_id = ?1 AND kind = 'full') THEN 'found' ELSE 'none' END WHERE id = ?1",
                params![game_id],
            )?;
        }
        Ok(())
    })
}

/// Octets d'une image du cache (transmis tels quels, sans ouvrir le système de fichiers à l'interface).
#[tauri::command]
pub fn media_read(lib: State<LibraryState>, meta: State<MetadataState>, game_id: i64, kind: MediaKind, slot: i64) -> Res<tauri::ipc::Response> {
    lib.with(|c| meta.media.read(c, game_id, kind, slot).map_err(|e| crate::library::LibraryError::Media(e.to_string())))
        .map(tauri::ipc::Response::new)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    id: String,
    fetched_at: String,
    items: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataStatus {
    steamgriddb_key: bool,
    sources: Vec<SourceInfo>,
    cache_bytes: u64,
    media_count: i64,
}

#[tauri::command]
pub fn metadata_status(lib: State<LibraryState>, meta: State<MetadataState>) -> Res<MetadataStatus> {
    lib.with(|c| {
        let mut stmt = c.prepare("SELECT id, fetched_at, items FROM ref_sources ORDER BY id")?;
        let sources = stmt
            .query_map([], |r| Ok(SourceInfo { id: r.get(0)?, fetched_at: r.get(1)?, items: r.get(2)? }))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let media_count: i64 = c.query_row("SELECT count(*) FROM media", [], |r| r.get(0))?;
        Ok(MetadataStatus { steamgriddb_key: keys::has(steamgriddb::PROVIDER), sources, cache_bytes: meta.media.size_bytes(), media_count })
    })
}

/// Enregistre une clé après l'avoir vérifiée auprès du service.
#[tauri::command]
pub async fn provider_key_set(app: AppHandle, provider: String, key: String) -> Res<()> {
    let key = key.trim().to_string();
    let name = match provider.as_str() {
        steamgriddb::PROVIDER => "SteamGridDB",
        super::giphy::PROVIDER => "GIPHY",
        _ => return Err(format!("Source inconnue : {provider}")),
    };
    if key.len() < 16 || key.len() > 128 || !key.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(format!("Cette clé ne ressemble pas à une clé {name}."));
    }
    blocking(&app, move |_, st| {
        if provider == super::giphy::PROVIDER {
            super::giphy::verify(&st.http, &key)?;
            keys::set(super::giphy::PROVIDER, &key)
        } else {
            steamgriddb::verify(&st.http, &key)?;
            keys::set(steamgriddb::PROVIDER, &key)
        }
    })
    .await
}

/// Une clé GIPHY est-elle enregistrée ? (la clé elle-même n'est jamais renvoyée)
#[tauri::command]
pub fn giphy_key_status() -> bool {
    keys::has(super::giphy::PROVIDER)
}

/// Stickers GIPHY (GIF animés détourés) pour une décoration de l'accueil.
#[tauri::command]
pub async fn decor_giphy_search(app: AppHandle, q: String) -> Res<Vec<super::giphy::Sticker>> {
    if q.trim().is_empty() || q.len() > 80 {
        return Ok(Vec::new());
    }
    blocking(&app, move |_, st| super::giphy::search(&st.http, &q)).await
}

#[tauri::command]
pub fn provider_key_delete(provider: String) -> Res<()> {
    keys::delete(&provider).map_err(err)
}

/// Supprime les images téléchargées (les imports de l'utilisateur sont conservés).
#[tauri::command]
pub fn media_clear_cache(lib: State<LibraryState>, meta: State<MetadataState>) -> Res<usize> {
    lib.with(|c| {
        let n = meta.media.clear_downloaded(c).map_err(|e| crate::library::LibraryError::Media(e.to_string()))?;
        c.execute("UPDATE games SET meta_fetched_at = NULL WHERE media_status IS NULL", [])?;
        Ok(n)
    })
}

#[cfg(test)]
mod tests {
    use super::check_image_link;

    #[test]
    fn liens_d_images_acceptes_ou_refuses() {
        assert!(check_image_link("https://cdn2.steamgriddb.com/grid/abc.png").is_ok());
        assert!(check_image_link(" https://example.org/scans/dos.jpg ").is_ok());
        for bad in [
            "http://example.org/a.png",
            "file:///C:/Windows/win.ini",
            "https://localhost/a.png",
            "https://127.0.0.1/a.png",
            "https://192.168.1.10/a.png",
            "https://[::1]/a.png",
            "https://nas/a.png",
            "pas un lien",
        ] {
            assert!(check_image_link(bad).is_err(), "{bad}");
        }
    }
}

#[tauri::command]
pub async fn avatar_steam_search(app: AppHandle, query: String) -> Res<Vec<steamgriddb::Hit>> {
    let http = app.state::<MetadataState>().http.clone();
    let query = query.trim().chars().take(100).collect::<String>();
    if query.chars().count() < 2 { return Ok(Vec::new()); }
    tauri::async_runtime::spawn_blocking(move || {
        steamgriddb::search(&http, &query).map(|mut hits| { hits.truncate(12); hits }).map_err(err)
    }).await.map_err(err)?
}

#[tauri::command]
pub async fn avatar_steam_images(app: AppHandle, id: u64) -> Res<Vec<steamgriddb::Image>> {
    let http = app.state::<MetadataState>().http.clone();
    tauri::async_runtime::spawn_blocking(move || steamgriddb::avatar_images(&http, id).map_err(err)).await.map_err(err)?
}

#[tauri::command]
pub async fn avatar_steam_download(url: String) -> Res<tauri::ipc::Response> {
    if !steamgriddb::avatar_host(&url) { return Err("Adresse SteamGridDB invalide.".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        const MAX: u64 = 8 * 1024 * 1024;
        let http = reqwest::blocking::Client::builder().redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(12)).build().map_err(err)?;
        let response = http.get(url).send().map_err(err)?.error_for_status().map_err(err)?;
        let mut bytes = Vec::new();
        response.take(MAX + 1).read_to_end(&mut bytes).map_err(err)?;
        if bytes.len() as u64 > MAX || !(bytes.starts_with(b"\x89PNG\r\n\x1a\n") || bytes.starts_with(b"\xff\xd8")
            || (bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"))) {
            return Err("Format d’image incompatible ou fichier trop volumineux.".into());
        }
        let size = imagesize::blob_size(&bytes).map_err(err)?;
        if size.width != size.height || !(96..=2048).contains(&size.width) {
            return Err("Dimensions de l’avatar incompatibles.".into());
        }
        Ok(tauri::ipc::Response::new(bytes))
    }).await.map_err(err)?
}
