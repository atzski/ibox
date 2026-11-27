//! Android : ce qui remplace les morceaux propres au bureau (docs/ANDROID.md).
//!
//! iBox n'a qu'une fenêtre sur Android : les fenêtres annexes (notifications, overlay de
//! capture, panneau musique, indicateur Remote Play, écrans de plugins) ne sont jamais créées,
//! leurs fonctions de construction renvoient « rien » sous `#[cfg(mobile)]`. Les quelques
//! réglages de fenêtre du bureau encore appelés sur la fenêtre principale (réduire, premier
//! plan, plein écran…) sont ici des opérations vides, pour ne pas disperser des `#[cfg]` dans
//! chaque appel.

use tauri::{Runtime, WebviewWindow};

/// Réglages de fenêtre qui n'existent que sur le bureau : sans effet sur Android.
pub trait DesktopWindow {
    fn unminimize(&self) -> tauri::Result<()> { Ok(()) }
    fn minimize(&self) -> tauri::Result<()> { Ok(()) }
    fn set_always_on_top(&self, _: bool) -> tauri::Result<()> { Ok(()) }
    fn set_skip_taskbar(&self, _: bool) -> tauri::Result<()> { Ok(()) }
    fn set_ignore_cursor_events(&self, _: bool) -> tauri::Result<()> { Ok(()) }
    fn set_fullscreen(&self, _: bool) -> tauri::Result<()> { Ok(()) }
}

impl<R: Runtime> DesktopWindow for WebviewWindow<R> {}

/// HTTPS : rustls avec le vérificateur de certificats d'Android. À appeler une fois au
/// démarrage, avant tout appel réseau ; sans lui, la première connexion HTTPS paniquerait.
pub fn init_tls() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    if let Err(e) = attach_verifier() {
        eprintln!("iBox : vérification des certificats Android indisponible : {e}");
    }
}

fn attach_verifier() -> Result<(), String> {
    // contexte posé par tao au lancement de l'activité (machine virtuelle Java + activité)
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) };
    vm.attach_current_thread(|env| -> jni::errors::Result<()> {
        let context = unsafe { jni::objects::JObject::from_raw(env, ctx.context().cast()) };
        rustls_platform_verifier::android::init_with_env(env, context)
    })
    .map_err(|e| e.to_string())
}
