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
    if webview_label != window_label(id) {
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
    match std::fs::read(active.dir.join(file)) {
        Ok(bytes) => {
            let m = mime(file);
            let csp = m.starts_with("text/html").then(|| csp(&active.manifest));
            respond(StatusCode::OK, m, bytes, csp.as_deref())
        }
        Err(_) => text(StatusCode::NOT_FOUND, "Fichier introuvable."),
    }
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
    fn csp_lists_only_declared_image_origins() {
        let mut m: Manifest = serde_json::from_value(super::super::install::tests::manifest_json("demo", "1.0.0")).unwrap();
        m.images = vec!["https://*.ytimg.com".into(), "javascript:alert(1)".into()];
        let c = csp(&m);
        assert!(c.contains("img-src 'self' data: blob: https://*.ytimg.com;"));
        assert!(!c.contains("javascript"));
        assert!(c.contains("script-src 'self';"));
    }
}
