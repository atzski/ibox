//! Second écran des consoles Android (AYN Thor, docs/ANDROID.md « Second écran »).
//!
//! L'écran du bas n'a pas d'état à lui : la fenêtre principale lui pousse ce qu'il affiche
//! (`second_screen_push`) et reçoit ses touchers par l'événement `second` du plugin. Base et Rust
//! restent uniques. Hors d'Android, rien n'est branché (`available: false`).

use tauri::AppHandle;
use tauri_plugin_ibox_android::{IboxAndroidExt, SecondStatus};

async fn blocking<T: Send + 'static>(app: AppHandle, f: impl FnOnce(&AppHandle) -> tauri_plugin_ibox_android::Result<T> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || f(&app).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
}

/// Écrans branchés et état de la surface du bas.
#[tauri::command]
pub async fn second_screen_status(app: AppHandle) -> Result<SecondStatus, String> {
    if !cfg!(target_os = "android") {
        return Ok(SecondStatus::default());
    }
    blocking(app, |a| a.ibox_android().second_status()).await
}

/// Active, coupe ou libère (jeu DS/3DS) l'écran du bas.
#[tauri::command]
pub async fn second_screen_configure(app: AppHandle, enabled: bool, mode: String, yielded: bool) -> Result<SecondStatus, String> {
    if !cfg!(target_os = "android") {
        return Ok(SecondStatus::default());
    }
    blocking(app, move |a| a.ibox_android().second_configure(enabled, &mode, yielded)).await
}

/// Ce que montre l'écran du bas (JSON de `services/secondScreen.ts`).
#[tauri::command]
pub async fn second_screen_push(app: AppHandle, state: String) -> Result<(), String> {
    if !cfg!(target_os = "android") {
        return Ok(());
    }
    blocking(app, move |a| a.ibox_android().second_push(&state)).await
}
