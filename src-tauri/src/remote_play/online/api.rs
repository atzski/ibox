//! Client HTTP des routes Remote Play d'iNetbox (`services/inetbox/src/remoteplay.ts`), sans
//! changement d'API. Séparé du transport iNetbox général : un long-poll de 25 s ne doit jamais
//! bloquer le reste d'iNetbox (amis, messages). Le jeton reste natif, jamais dans la WebView.

use std::io::Read;
use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::{Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::remote_play::signaling::envelope::Sealed;
use crate::remote_play::signaling::identity::DeviceKey;

/// Attente maximale d'un long-poll côté serveur (`RP.maxWaitSeconds`).
pub const MAX_WAIT_SECS: u64 = 25;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

pub type Result<T> = std::result::Result<T, ApiError>;

pub fn error(code: &str, message: &str) -> ApiError {
    ApiError { code: code.into(), message: message.into() }
}

/// Message fixe pour chaque code connu : jamais le texte reçu du serveur.
pub fn message_for(status: u16, code: &str) -> ApiError {
    let (code, message) = match code {
        "REQUESTS_REFUSED" => ("REQUESTS_REFUSED", "Cet ami n'accepte pas les demandes Remote Play (réglage désactivé chez lui)."),
        "INVITE_UNAVAILABLE" => ("INVITE_UNAVAILABLE", "Invitation expirée ou déjà utilisée."),
        "SESSION_PENDING" => ("SESSION_PENDING", "L'invitation n'a pas encore été acceptée."),
        "SESSION_ENDED" => ("SESSION_ENDED", "La session est terminée."),
        "BAD_SIGNATURE" => ("BAD_SIGNATURE", "Signature de l'appareil refusée par iNetbox."),
        "DEVICE_LIMIT" => ("DEVICE_LIMIT", "Dix appareils Remote Play au plus par compte : révoquez-en un."),
        "KEY_UNAVAILABLE" => ("KEY_UNAVAILABLE", "La clé de cet appareil a été révoquée."),
        "MAILBOX_FULL" => ("MAILBOX_FULL", "Votre ami ne relève plus les messages de la session."),
        "NOT_PARTICIPANT" => ("NOT_PARTICIPANT", "Ce message ne concerne pas cette session."),
        "RATE_LIMITED" => ("RATE_LIMITED", "Trop d'invitations : patientez avant de réessayer."),
        "BUSY" => ("BUSY", "iNetbox est momentanément saturé."),
        _ => match status {
            401 => ("UNAUTHENTICATED", "Session iNetbox expirée : reconnectez-vous."),
            403 => ("FORBIDDEN", "Action refusée : vous devez être amis."),
            404 => ("NOT_FOUND", "Invitation ou session indisponible."),
            410 => ("SESSION_ENDED", "La session est terminée."),
            429 => ("RATE_LIMITED", "Trop de demandes : patientez avant de réessayer."),
            _ => ("SERVICE_ERROR", "iNetbox est momentanément indisponible."),
        },
    };
    error(code, message)
}

/// Identifiant iNetbox (UUID) : seul format accepté dans un chemin.
pub fn is_uuid(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| if matches!(i, 8 | 13 | 18 | 23) { b == b'-' } else { b.is_ascii_hexdigit() })
}

fn check_id(id: &str) -> Result<&str> {
    if is_uuid(id) {
        Ok(id)
    } else {
        Err(error("INVALID_INPUT", "Identifiant invalide."))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Invite {
    pub id: String,
    pub token: String,
    pub expires_at: u64,
}

/// Invitation reçue (`GET /v1/remote-play/invites`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Incoming {
    pub id: String,
    pub from_id: String,
    pub from_name: String,
    pub kind: String,
    pub mode: String,
    pub host_id: String,
    pub token: String,
    pub created_at: u64,
    pub expires_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Redeemed {
    pub session_id: String,
    pub host_id: String,
    pub guest_id: String,
    pub mode: String,
    pub token: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub public_key: String,
    pub revoked_at: Option<u64>,
}

/// Message relevé dans la boîte aux lettres. `device_id` est l'appareil dont le serveur a
/// vérifié la signature ; l'iBox revérifie tout de son côté.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mail {
    pub from: String,
    pub device_id: String,
    pub body: String,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Poll {
    /// `pending` (invitation pas encore acceptée) ou `open`.
    pub state: String,
    pub items: Vec<Mail>,
}

pub struct Api {
    base: Url,
    token: String,
    client: Client,
}

impl Api {
    pub fn new(base: &str, token: String) -> Result<Api> {
        let base = Url::parse(base).map_err(|_| error("CONFIG_ERROR", "Adresse iNetbox invalide."))?;
        let local = matches!(base.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
        if !(base.scheme() == "https" || (base.scheme() == "http" && local)) {
            return Err(error("CONFIG_ERROR", "iNetbox exige HTTPS, sauf en local."));
        }
        let client = Client::builder()
            .timeout(Duration::from_secs(MAX_WAIT_SECS + 20))
            .connect_timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| error("NETWORK_ERROR", "Connexion indisponible."))?;
        Ok(Api { base, token, client })
    }

    fn call(&self, method: Method, path: &str, body: Option<&Value>) -> Result<Value> {
        let url = self.base.join(path).map_err(|_| error("CONFIG_ERROR", "Route invalide."))?;
        let mut request = self.client.request(method, url).bearer_auth(&self.token);
        if let Some(b) = body {
            request = request.json(b);
        }
        let response = request.send().map_err(|_| error("NETWORK_ERROR", "iNetbox est injoignable."))?;
        let status = response.status().as_u16();
        let mut bytes = Vec::new();
        response.take(256 * 1024 + 1).read_to_end(&mut bytes).map_err(|_| error("NETWORK_ERROR", "Réponse iNetbox interrompue."))?;
        if bytes.len() > 256 * 1024 {
            return Err(error("INVALID_RESPONSE", "Réponse iNetbox trop volumineuse."));
        }
        let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        if !(200..300).contains(&status) {
            return Err(message_for(status, value["error"]["code"].as_str().unwrap_or_default()));
        }
        Ok(value)
    }

    fn parse<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T> {
        serde_json::from_value(value).map_err(|_| error("INVALID_RESPONSE", "Réponse iNetbox invalide."))
    }

    /// Déclare la clé publique de cet appareil (preuve de possession liée au compte) ; renvoie
    /// l'identifiant d'appareil (le même à chaque appel pour la même clé).
    pub fn register_device(&self, key: &DeviceKey, account: &str, name: &str) -> Result<String> {
        let name: String = name.chars().filter(|c| !c.is_control()).take(40).collect::<String>().trim().to_string();
        let name = if name.is_empty() { "iBox".to_string() } else { name };
        let v = self.call(Method::POST, "/v1/remote-play/devices", Some(&json!({ "publicKey": key.public_b64(), "name": name, "proof": key.device_proof(account) })))?;
        v["id"].as_str().filter(|id| is_uuid(id)).map(str::to_string).ok_or_else(|| error("INVALID_RESPONSE", "Réponse iNetbox invalide."))
    }

    pub fn accept_requests(&self) -> Result<bool> {
        Ok(self.call(Method::GET, "/v1/remote-play/settings", None)?["acceptRequests"].as_bool().unwrap_or(false))
    }

    pub fn set_accept_requests(&self, accept: bool) -> Result<bool> {
        Ok(self.call(Method::PUT, "/v1/remote-play/settings", Some(&json!({ "acceptRequests": accept })))?["acceptRequests"].as_bool().unwrap_or(false))
    }

    /// L'expéditeur héberge (`kind: invite`) ; `mode` : `watch` (spectateur) ou `play`.
    pub fn create_invite(&self, friend: &str, mode: &str) -> Result<Invite> {
        let mode = if mode == "play" { "play" } else { "watch" };
        Self::parse(self.call(Method::POST, "/v1/remote-play/invites", Some(&json!({ "friendId": check_id(friend)?, "kind": "invite", "mode": mode })))?)
    }

    pub fn incoming(&self) -> Result<Vec<Incoming>> {
        let v = self.call(Method::GET, "/v1/remote-play/invites", None)?;
        Self::parse(v["items"].clone())
    }

    /// Refus (destinataire) ou annulation (expéditeur).
    pub fn delete_invite(&self, id: &str) -> Result<()> {
        self.call(Method::DELETE, &format!("/v1/remote-play/invites/{}", check_id(id)?), None).map(drop)
    }

    pub fn redeem(&self, token: &str) -> Result<Redeemed> {
        if token.len() != 22 || !token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
            return Err(error("INVALID_INPUT", "Invitation invalide."));
        }
        Self::parse(self.call(Method::POST, "/v1/remote-play/invites/redeem", Some(&json!({ "token": token })))?)
    }

    pub fn friend_devices(&self, friend: &str) -> Result<Vec<Device>> {
        let v = self.call(Method::GET, &format!("/v1/remote-play/friends/{}/devices", check_id(friend)?), None)?;
        Self::parse(v["items"].clone())
    }

    pub fn send(&self, session: &str, to: &str, device: &str, sealed: &Sealed) -> Result<()> {
        let body = json!({ "to": check_id(to)?, "deviceId": check_id(device)?, "body": sealed.body, "signature": sealed.signature });
        self.call(Method::POST, &format!("/v1/remote-play/sessions/{}/signal", check_id(session)?), Some(&body)).map(drop)
    }

    /// Relève la boîte aux lettres, en attendant jusqu'à `wait_secs` (≤ 25 s) qu'un message arrive.
    pub fn poll(&self, session: &str, wait_secs: u64) -> Result<Poll> {
        let path = format!("/v1/remote-play/sessions/{}/signal?wait={}", check_id(session)?, wait_secs.min(MAX_WAIT_SECS));
        Self::parse(self.call(Method::GET, &path, None)?)
    }

    pub fn end(&self, session: &str) -> Result<()> {
        self.call(Method::DELETE, &format!("/v1/remote-play/sessions/{}", check_id(session)?), None).map(drop)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiants() {
        assert!(is_uuid("550e8400-e29b-41d4-a716-446655440000"));
        assert!(!is_uuid("550e8400-e29b-41d4-a716-44665544000/"));
        assert!(!is_uuid("../../v1/me/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
        assert!(!is_uuid("550e8400e29b-41d4-a716-4466554400000"));
        assert!(check_id("x").is_err());
    }

    #[test]
    fn messages_fixes() {
        assert_eq!(message_for(403, "REQUESTS_REFUSED").code, "REQUESTS_REFUSED");
        assert_eq!(message_for(410, "SESSION_ENDED").code, "SESSION_ENDED");
        assert_eq!(message_for(410, "").code, "SESSION_ENDED");
        assert_eq!(message_for(500, "<script>").code, "SERVICE_ERROR");
        assert!(!message_for(500, "texte du serveur").message.contains("texte du serveur"));
    }

    #[test]
    fn https_obligatoire() {
        assert!(Api::new("http://example.com", "t".into()).is_err());
        assert!(Api::new("http://127.0.0.1:4318", "t".into()).is_ok());
        assert!(Api::new("https://inetbox-server.onrender.com", "t".into()).is_ok());
    }

    #[test]
    fn reponses_du_serveur() {
        // formes renvoyées par remoteplay.ts
        let p: Poll = serde_json::from_value(json!({ "state": "open", "items": [{ "id": "x", "from": "a", "deviceId": "d", "body": "{}", "signature": "s", "sentAt": 1 }] })).unwrap();
        assert_eq!(p.items[0].device_id, "d");
        let i: Vec<Incoming> = serde_json::from_value(json!([{ "id": "i", "fromId": "f", "fromName": "Bob", "kind": "invite", "mode": "watch", "hostId": "f", "token": "t", "createdAt": 1, "expiresAt": 2 }])).unwrap();
        assert_eq!(i[0].from_name, "Bob");
        let r: Redeemed = serde_json::from_value(json!({ "sessionId": "s", "hostId": "h", "guestId": "g", "mode": "play", "token": "t" })).unwrap();
        assert_eq!(r.mode, "play");
        let d: Vec<Device> = serde_json::from_value(json!([{ "id": "d", "publicKey": "k", "name": "PC", "createdAt": 1, "revokedAt": null }])).unwrap();
        assert!(d[0].revoked_at.is_none());
    }
}
