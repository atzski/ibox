//! Cœur natif de iBox.
//!
//! - `db`      : SQLite + migrations ;
//! - `scanner` : parcours, en-têtes, identification, rapprochement (lecture seule) ;
//! - `library` : dossiers, jeux, actualisation — commandes Tauri (phase 2).
//!
//! - `metadata` (phase 3) et `launcher` (phase 4) : jaquettes, informations, émulateurs.

pub mod assets;
pub mod db;
pub mod emulators;
pub mod launcher;
pub mod library;
pub mod metadata;
pub mod pc;
pub mod scanner;
pub mod shell;
pub mod wallpaper;
pub mod inetbox;
pub mod profile;
pub mod capture;
pub mod toast;
pub mod remote_play;
mod achievements;

use library::commands as lib_cmd;
use metadata::commands as meta_cmd;
use launcher::commands as launch_cmd;
use tauri::Manager;

use serde::Serialize;

#[derive(Serialize)]
struct AppInfo {
    name: &'static str,
    version: &'static str,
    phase: u8,
}

/// Renvoie les informations de version affichées dans les paramètres.
#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "iBox",
        version: env!("CARGO_PKG_VERSION"),
        phase: 5,
    }
}

/// Bouton « OFF » de l'interface : ferme proprement l'application.
/// Les émulateurs lancés sont des processus indépendants et restent ouverts.
#[tauri::command]
fn app_quit(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // une seule instance : relancer iBox réaffiche la fenêtre existante
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| shell::show_main(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![shell::HIDDEN_ARG])))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if let Ok(dir) = app.path().app_data_dir() {
                metadata::keys::set_fallback_dir(dir.join("vault"));
            }
            if let Err(error) = metadata::keys::delete("igdb-avatar") {
                eprintln!("iBox : nettoyage d’un ancien identifiant impossible : {error}");
            }
            let state = lib_cmd::LibraryState::open(app.handle())?;
            if let Ok(dir) = app.path().app_data_dir() {
                pc::steam::load_manual_root(&dir.join("steam-folder.txt"));
            }
            app.manage(state);
            app.manage(meta_cmd::MetadataState::open(app.handle())?);
            app.manage(launch_cmd::LauncherState::default());
            app.manage(emulators::commands::EmulatorsState::default());
            app.manage(shell::Behavior::default());
            app.manage(remote_play::RemotePlay::open(app.handle()));
            if let Err(e) = shell::install(app.handle()) {
                eprintln!("iBox : icône de notification indisponible : {e}");
            }
            // démarrage avec Windows : iBox attend discrètement dans la zone de notification
            shell::startup(app.handle());
            profile::load(app.handle());
            inetbox::start(app.handle().clone());
            capture::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            emulators::commands::emulators_overview,
            emulators::commands::emulator_install,
            emulators::commands::emulator_install_cancel,
            emulators::commands::emulator_latest,
            emulators::commands::emulator_uninstall,
            emulators::commands::emulator_restore,
            emulators::commands::emulator_purge_backups,
            emulators::commands::emulators_root_set,
            emulators::commands::emulators_open_folder,
            emulators::commands::emulator_open,
            emulators::commands::emulators_open_url,
            emulators::commands::emulator_requirements,
            emulators::commands::emulator_requirement_folder,
            emulators::commands::emulator_bios_import,
            launch_cmd::emulator_set_origin,
            inetbox::inetbox_call,
            profile::profile_activate,
            profile::profile_delete,
            capture::overlay_state,
            capture::overlay_preview,
            capture::overlay_save_shot,
            capture::overlay_save_clip,
            capture::overlay_close,
            capture::overlay_open_community,
            capture::capture_settings,
            capture::captures_list,
            capture::captures_read,
            capture::captures_delete,
            capture::captures_folder,
            capture::community_share,
            capture::community_media,
            remote_play::remote_play_config,
            remote_play::remote_play_set_config,
            remote_play::remote_play_diagnose,
            remote_play::remote_play_pad_driver,
            remote_play::remote_play_install_pad_driver,
            remote_play::remote_play_indicator_compact,
            remote_play::remote_play_host_start,
            remote_play::remote_play_host_answer,
            remote_play::remote_play_host_stats,
            remote_play::remote_play_host_stop,
            remote_play::online::remote_play_invite,
            remote_play::online::remote_play_online_stop,
            remote_play::online::remote_play_emergency_stop,
            remote_play::online::remote_play_online_status,
            remote_play::online::remote_play_sources,
            remote_play::online::remote_play_accept,
            remote_play::online::remote_play_answer,
            remote_play::online::remote_play_candidates,
            remote_play::online::remote_play_guest_state,
            remote_play::online::remote_play_decline,
            remote_play::online::remote_play_invites,
            remote_play::online::remote_play_set_accept,
            meta_cmd::avatar_steam_search,
            meta_cmd::avatar_steam_images,
            meta_cmd::avatar_steam_download,
            app_quit,
            shell::shell_behavior_set,
            shell::shell_hide,
            shell::shell_minimize,
            achievements::achievements_read,
            achievements::achievements_ra_progress,
            achievements::achievements_ra_search,
            achievements::achievements_ra_key,
            achievements::ra_api,
            achievements::steam_achievements,
            achievements::steam_achievements_summary,
            achievements::achievements_ra_connected,
            achievements::achievements_ra_disconnect,
            toast::toast_update,
            toast::toast_notice,
            toast::toast_pull,
            toast::toast_done,
            toast::toast_click,
            toast::toast_enabled,
            shell::open_help_page,
            shell::autostart_get,
            shell::autostart_set,
            shell::shell_visible,
            shell::diagnostic_save,
            shell::update_check,
            shell::update_install,
            wallpaper::wallpaper_set,
            wallpaper::wallpaper_read,
            wallpaper::wallpaper_clear,
            wallpaper::home_wallpaper_set,
            wallpaper::home_wallpaper_from_url,
            wallpaper::home_wallpaper_read,
            wallpaper::home_wallpaper_clear,
            lib_cmd::library_backups,
            library::portable::portable_export,
            library::portable::portable_stage,
            library::portable::portable_settings,
            library::portable::portable_ack,
            lib_cmd::library_delete_backup,
            lib_cmd::library_restore,
            pc::commands::pc_connectors,
            pc::commands::pc_running_game,
            pc::commands::pc_set_steam_folder,
            pc::commands::pc_add_manual,
            pc::commands::pc_installs,
            pc::commands::pc_set_preferred,
            pc::commands::pc_merge_games,
            pc::commands::pc_split_install,
            pc::commands::pc_remove_install,
            pc::commands::pc_sync,
            pc::commands::pc_set_hidden,
            assets::commands::assets_status,
            assets::commands::iidb_connect,
            assets::commands::iidb_access,
            assets::commands::iidb_disconnect,
            assets::commands::iidb_search_platforms,
            assets::commands::platform_art_sync,
            assets::commands::platform_art_list,
            assets::commands::platform_art_read,
            assets::commands::platform_art_gallery,
            assets::commands::platform_art_choose,
            assets::commands::platform_art_import,
            assets::commands::platform_art_reset,
            assets::commands::platform_link_choose,
            assets::commands::games_art_sync,
            assets::commands::games_art_cancel,
            assets::commands::sounds_sync,
            assets::commands::sounds_status,
            assets::commands::sounds_clear,
            assets::commands::game_sound,
            assets::commands::game_sound_import,
            assets::commands::game_sound_remove_custom,
            assets::commands::game_sound_info,
            assets::commands::music_import,
            assets::commands::music_list,
            assets::commands::music_remove,
            assets::commands::music_read,
            assets::commands::collection_iidb_search,
            assets::commands::collection_iidb_logos,
            assets::commands::collection_iidb_collections,
            assets::commands::collection_iidb_browse,
            assets::commands::collection_iidb_icons,
            assets::commands::collection_sgdb_images,
            assets::commands::collection_art_set,
            assets::commands::collection_art_get,
            assets::commands::image_fetch,
            assets::commands::collection_art_clear,
            assets::commands::games_art_stats,
            assets::commands::game_link_candidates,
            assets::commands::game_link_choose,
            pc::commands::pc_install,
            pc::commands::pc_steam_key_set,
            pc::commands::pc_steam_key_delete,
            lib_cmd::folders_list,
            lib_cmd::folder_add,
            lib_cmd::folder_update,
            lib_cmd::folder_remove,
            lib_cmd::library_remove_missing,
            library::extras::stats_overview,
            library::extras::collections_list,
            library::extras::collection_create,
            library::extras::collection_update,
            library::extras::collection_delete,
            library::extras::collection_set_game,
            library::extras::saves_list,
            library::extras::saves_backup,
            library::extras::saves_reveal,
            lib_cmd::library_list,
            lib_cmd::library_scan,
            lib_cmd::library_scan_cancel,
            lib_cmd::game_set_favorite,
            lib_cmd::game_update,
            lib_cmd::game_link_variant,
            lib_cmd::game_unlink_variant,
            lib_cmd::game_promote_variant,
            meta_cmd::metadata_fetch,
            meta_cmd::metadata_cancel,
            meta_cmd::metadata_status,
            meta_cmd::media_candidates,
            meta_cmd::media_apply,
            meta_cmd::media_import,
            meta_cmd::media_import_url,
            meta_cmd::media_remove,
            meta_cmd::media_read,
            meta_cmd::media_clear_cache,
            meta_cmd::provider_key_set,
            meta_cmd::provider_key_delete,
            launch_cmd::emulators_list,
            launch_cmd::emulator_profiles,
            launch_cmd::emulator_add,
            launch_cmd::emulator_update,
            launch_cmd::emulator_remove,
            launch_cmd::emulator_cores,
            launch_cmd::platform_emulator_set,
            launch_cmd::platform_emulators,
            launch_cmd::game_emulator_set,
            launch_cmd::args_split,
            launch_cmd::launch_plan,
            launch_cmd::emulators_detect,
            launch_cmd::launch_status,
            launch_cmd::game_launch,
            launch_cmd::game_adopt_running,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au démarrage de iBox");
}
