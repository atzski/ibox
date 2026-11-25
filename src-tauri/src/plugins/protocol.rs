//! Protocole `iboxplugin://localhost/<id>/<chemin>` (sous Windows :
//! `http://iboxplugin.localhost/<id>/<chemin>`) : sert les fichiers d'un plugin installé et
//! activé, avec sa propre CSP, **seulement à la fenêtre de ce plugin** (`plugin-<id>`).
//!
//! La fenêtre d'un plugin n'a aucune capability Tauri : elle ne parle au socle que par
//! `POST /<id>/__host/<appel>` sur ce même protocole, et chaque appel est vérifié contre
//! les permissions accordées (`host.rs`).

use tauri::http::{header, Request, Response, StatusCode};
use tauri::AppHandle;

use super::manifest::{self, Manifest};

pub const SCHEME: &str = "iboxplugin";

/// Libellé de la fenêtre d'un plugin.
pub fn window_label(id: &str) -> String {
    format!("plugin-{id}")
}

/// Libellé de l'écran plein d'un plugin (`screen` du manifeste). « : » n'entre dans aucun
/// identifiant : pas de confusion possible avec la fenêtre d'un autre plugin.
pub fn screen_label(id: &str) -> String {
    format!("plugin-{id}:screen")
}

/// Fenêtre (ou écran) appartenant au plugin `id`.
pub fn owns(label: &str, id: &str) -> bool {
    label == window_label(id) || label == screen_label(id)
}

/// Fenêtre d'un plugin, quel qu'il soit : aucune commande d'iBox ne lui est ouverte (lib.rs).
pub fn is_plugin_label(label: &str) -> bool {
    label.starts_with("plugin-")
}

/// Adresse d'un fichier du plugin pour une fenêtre (`WebviewUrl::CustomProtocol`).
pub fn url(id: &str, path: &str) -> String {
    if cfg!(windows) || cfg!(target_os = "android") {
        format!("http://{SCHEME}.localhost/{id}/{path}")
    } else {
        format!("{SCHEME}://localhost/{id}/{path}")
    }
}

pub fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        _ => "application/octet-stream",
    }
}

/// CSP de la fenêtre du plugin : ses propres fichiers, les images de ses domaines déclarés.
pub fn csp(m: &Manifest) -> String {
    let images: Vec<&str> = m.images.iter().map(String::as_str).filter(|i| manifest::https_origin(i, true).is_some()).collect();
    format!(
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: {}; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
        images.join(" ")
    )
}

/// Découpe `/<id>/<chemin>` ; rien en dehors d'un chemin relatif sûr.
pub fn split(path: &str) -> Option<(&str, &str)> {
    let rest = path.strip_prefix('/')?;
    let (id, file) = rest.split_once('/')?;
    (manifest::valid_id(id) && (file.starts_with("__host/") || manifest::safe_path(file))).then_some((id, file))
}

fn respond(status: StatusCode, mime: &str, body: Vec<u8>, csp: Option<&str>) -> Response<Vec<u8>> {
    let mut b = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        .header("X-Content-Type-Options", "nosniff")
        .header(header::CACHE_CONTROL, "no-store");
    if let Some(c) = csp {
        b = b.header("Content-Security-Policy", c);
    }
    b.body(body).unwrap_or_else(|_| Response::new(Vec::new()))
}

fn text(status: StatusCode, msg: &str) -> Response<Vec<u8>> {
    respond(status, "text/plain; charset=utf-8", msg.as_bytes().to_vec(), None)
}

/// Traite une requête (bloquant : appelée hors de la boucle d'événements).
pub fn handle(app: &AppHandle, webview_label: &str, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let path = percent_decode(req.uri().path());
    let Some((id, file)) = split(&path) else { return text(StatusCode::BAD_REQUEST, "Adresse invalide.") };
    if !owns(webview_label, id) {
        return text(StatusCode::FORBIDDEN, "Réservé à la fenêtre du plugin.");
    }
    let Some(active) = super::active(app.clone(), id) else { return text(StatusCode::NOT_FOUND, "Plugin absent ou désactivé.") };
    if let Some(call) = file.strip_prefix("__host/") {
        if req.method() != tauri::http::Method::POST {
            return text(StatusCode::METHOD_NOT_ALLOWED, "POST attendu.");
        }
        let arg: serde_json::Value = serde_json::from_slice(req.body()).unwrap_or(serde_json::Value::Null);
        let out = match super::host::call(app, &active, call, arg) {
            Ok(v) => serde_json::json!({ "ok": v }),
            Err(e) => serde_json::json!({ "error": e }),
        };
        return respond(StatusCode::OK, "application/json", out.to_string().into_bytes(), None);
    }
    if let Some(name) = file.strip_prefix("__clips/") {
        if !active.allows("clips") {
            return text(StatusCode::FORBIDDEN, "Permission clips manquante.");
        }
        let Some(path) = crate::capture::clip_path(app, name) else { return text(StatusCode::NOT_FOUND, "Clip introuvable.") };
        let range = req.headers().get(header::RANGE).and_then(|v| v.to_str().ok());
        return clip(&path, range);
    }
    // image figée à l'ouverture du panneau (iClips remplace l'overlay de capture)
    if file == "__shot" {
        if !active.allows("clips-capture") {
            return text(StatusCode::FORBIDDEN, "Permission clips-capture manquante.");
        }
        return match crate::capture::frozen_png() {
            Some(png) => respond(StatusCode::OK, "image/png", png, None),
            None => text(StatusCode::NOT_FOUND, "Aucune image figée."),
        };
    }
    if let Some(name) = file.strip_prefix("__thumbs/") {
        if !active.allows("clips") {
            return text(StatusCode::FORBIDDEN, "Permission clips manquante.");
        }
        return match crate::capture::clip_thumb_path(app, name).and_then(|p| std::fs::read(p).ok()) {
            Some(bytes) => respond(StatusCode::OK, "image/jpeg", bytes, None),
            None => text(StatusCode::NOT_FOUND, "Vignette introuvable."),
        };
    }
    match std::fs::read(active.dir.join(file)) {
        Ok(bytes) => {
            let m = mime(file);
            let csp = m.starts_with("text/html").then(|| csp(&active.manifest));
            respond(StatusCode::OK, m, bytes, csp.as_deref())
        }
        Err(_) => text(StatusCode::NOT_FOUND, "Fichier introuvable."),
    }
}

/// Plus grand morceau servi par réponse : la balise `<video>` redemande la suite.
const CHUNK: u64 = 4 * 1024 * 1024;

/// `Range: bytes=a-b`, `bytes=a-`, `bytes=-n` → (début, fin incluse), bornés au fichier et à
/// `CHUNK`. `None` : demande hors du fichier.
pub fn byte_range(header: Option<&str>, len: u64) -> Option<(u64, u64)> {
    if len == 0 {
        return None;
    }
    let (start, end) = match header.and_then(|h| h.trim().strip_prefix("bytes=")) {
        None => (0, len - 1),
        Some(spec) => {
            let (a, b) = spec.split(',').next()?.trim().split_once('-')?;
            match (a.trim(), b.trim()) {
                ("", n) => {
                    let n: u64 = n.parse().ok()?;
                    (len.saturating_sub(n), len - 1)
                }
                (a, "") => (a.parse().ok()?, len - 1),
                (a, b) => (a.parse().ok()?, b.parse::<u64>().ok()?.min(len - 1)),
            }
        }
    };
    (start <= end && start < len).then(|| (start, end.min(start + CHUNK - 1)))
}

/// Sert un clip par morceaux (lecture et déplacement dans la vidéo).
fn clip(path: &std::path::Path, range: Option<&str>) -> Response<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else { return text(StatusCode::NOT_FOUND, "Clip introuvable.") };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let Some((start, end)) = byte_range(range, len) else {
        return Response::builder().status(StatusCode::RANGE_NOT_SATISFIABLE).header(header::CONTENT_RANGE, format!("bytes */{len}")).body(Vec::new()).unwrap_or_else(|_| Response::new(Vec::new()));
    };
    let mut body = vec![0u8; (end - start + 1) as usize];
    if f.seek(SeekFrom::Start(start)).and_then(|_| f.read_exact(&mut body)).is_err() {
        return text(StatusCode::INTERNAL_SERVER_ERROR, "Lecture impossible.");
    }
    Response::builder()
        .status(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_TYPE, match path.extension().and_then(|e| e.to_str()) { Some("gif") => "image/gif", Some("png") => "image/png", _ => "video/mp4" })
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
        .header("X-Content-Type-Options", "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() && b[i + 1].is_ascii_hexdigit() && b[i + 2].is_ascii_hexdigit() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_stay_inside_the_plugin() {
        assert_eq!(split("/demo/ui/index.html"), Some(("demo", "ui/index.html")));
        assert_eq!(split("/demo/__host/media.state"), Some(("demo", "__host/media.state")));
        assert_eq!(split("/demo/../other/x"), None);
        assert_eq!(split("/demo/ui/../../x"), None);
        assert_eq!(split("/Demo/x"), None);
        assert_eq!(split("/demo"), None);
        assert_eq!(split(&percent_decode("/demo/%2e%2e/x")), None);
        assert_eq!(percent_decode("/a%20b"), "/a b");
    }

    #[test]
    fn plugin_windows_are_told_apart() {
        assert!(owns("plugin-iclips", "iclips") && owns("plugin-iclips:screen", "iclips"));
        assert!(!owns("plugin-iclips:screen", "iclips-x") && !owns("plugin-iclips-x", "iclips") && !owns("main", "iclips"));
        assert!(is_plugin_label("plugin-iclips:screen") && !is_plugin_label("main") && !is_plugin_label("music"));
    }

    #[test]
    fn byte_ranges_stay_inside_the_file() {
        let mb = 1024 * 1024;
        assert_eq!(byte_range(None, 100), Some((0, 99)));
        assert_eq!(byte_range(Some("bytes=0-"), 100), Some((0, 99)));
        assert_eq!(byte_range(Some("bytes=10-19"), 100), Some((10, 19)));
        assert_eq!(byte_range(Some("bytes=90-500"), 100), Some((90, 99)));
        assert_eq!(byte_range(Some("bytes=-10"), 100), Some((90, 99)));
        assert_eq!(byte_range(Some("bytes=100-"), 100), None);
        assert_eq!(byte_range(Some("bytes=20-10"), 100), None);
        assert_eq!(byte_range(Some("bytes=x-"), 100), None);
        assert_eq!(byte_range(None, 0), None);
        // morceau de 4 Mo au plus
        assert_eq!(byte_range(Some("bytes=0-"), 50 * mb), Some((0, 4 * mb - 1)));
    }

    #[test]
    fn csp_lists_only_declared_image_origins() {
        let mut m: Manifest = serde_json::from_value(super::super::install::tests::manifest_json("demo", "1.0.0")).unwrap();
        m.images = vec!["https://*.ytimg.com".into(), "javascript:alert(1)".into()];
        let c = csp(&m);
        assert!(c.contains("img-src 'self' data: blob: https://*.ytimg.com;"));
        assert!(!c.contains("javascript"));
        assert!(c.contains("script-src 'self';"));
    }
}
