//! Cœur natif de iBox.
//!
//! - `db`      : SQLite + migrations ;
//! - `scanner` : parcours, en-têtes, identification, rapprochement (lecture seule) ;
//! - `library` : dossiers, jeux, actualisation — commandes Tauri (phase 2).
//!
//! - `metadata` (phase 3) et `launcher` (phase 4) : jaquettes, informations, émulateurs.

// Linux (Steam Deck) : les fonctions propres à Windows (capture, clips, hôte Remote Play…)
// restent compilées mais ne sont jamais appelées. Voir docs/STEAMDECK.md.
#![cfg_attr(not(windows), allow(dead_code))]
// Android : les fenêtres annexes du bureau ne sont pas construites (mobile.rs) ; leurs imports restent
#![cfg_attr(mobile, allow(unused_imports))]

pub mod assets;
pub mod db;
pub mod device;
pub mod android_chip;
pub mod emulators;
pub mod launcher;
pub mod library;
pub mod manuals;
pub mod storage;
pub mod metadata;
pub mod paths;
pub mod pc;
pub mod platform;
pub mod perf;
pub mod power;
pub mod scanner;
pub mod shell;
pub mod wallpaper;
pub mod uninstall;
pub mod inetbox;
pub mod profile;
pub mod capture;
mod clip_edit;
mod clips_auto;
mod share;
mod voice;
mod voice_echo;
mod voice_vosk;
mod voice_sapi;
pub mod music;
pub mod shortcut;
pub mod plugins;
pub mod clips;
pub mod crash;
pub mod toast;
pub mod remote_play;
pub mod smartconfig;
mod achievements;
#[cfg(mobile)]
pub mod mobile;
pub mod android;
pub mod second_screen;
pub mod android_apps;
pub mod android_ingame;

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
    platform::prepare_webview();
    let builder = tauri::Builder::default();
    // bureau seulement : Android gère lui-même l'instance unique, le démarrage et les mises à jour
    #[cfg(desktop)]
    let builder = builder
        // une seule instance : relancer iBox réaffiche la fenêtre existante
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| shell::show_main(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![shell::HIDDEN_ARG])))
        .plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .plugin(tauri_plugin_dialog::init())
        // socle Android : intents, stockage, plein écran, manette (sans effet ailleurs)
        .plugin(tauri_plugin_ibox_android::init())
        // applications Android de la bibliothèque et installeur des mises à jour (docs/ANDROID.md §9)
        .plugin(tauri_plugin_ibox_android::apps::init())
        .plugin(tauri_plugin_ibox_android::ingame::init())
        // Android : iBox revient au premier plan après une partie (temps de jeu, « jeu en cours »)
        .on_window_event(|_window, _event| {
            #[cfg(mobile)]
            if matches!(_event, tauri::WindowEvent::Resumed) {
                launcher::android::on_resumed(_window.app_handle());
                android_apps::on_resumed(_window.app_handle());
            }
        })
        // fichiers des plugins installés, servis à leur seule fenêtre (docs/PLUGINS.md)
        .register_asynchronous_uri_scheme_protocol(plugins::protocol::SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let label = ctx.webview_label().to_string();
            std::thread::spawn(move || responder.respond(plugins::protocol::handle(&app, &label, &request)));
        })
        .setup(|app| {
            // Android : HTTPS prêt avant le premier appel réseau
            #[cfg(mobile)]
            mobile::init_tls();
            // en premier : toute panique qui suit laisse une trace dans logs/crash.log
            if let Ok(dir) = app.path().app_log_dir() {
                crash::install(&dir);
            }
            if let Ok(dir) = app.path().app_data_dir() {
                metadata::keys::set_fallback_dir(dir.join("vault"));
            }
            if let Err(error) = metadata::keys::delete("igdb-avatar") {
                eprintln!("iBox : nettoyage d’un ancien identifiant impossible : {error}");
            }
            let state = lib_cmd::LibraryState::open(app.handle())?;
            if let Ok(dir) = app.path().app_data_dir() {
                pc::steam::load_manual_root(&dir.join("steam-folder.txt"));
                pc::epic::load_manual_dir(&dir.join("epic-folder.txt"));
            }
            app.manage(state);
            app.manage(meta_cmd::MetadataState::open(app.handle())?);
            app.manage(manuals::commands::ManualState::open(app.handle())?);
            app.manage(launch_cmd::LauncherState::default());
            app.manage(emulators::commands::EmulatorsState::default());
            app.manage(shell::Behavior::default());
            app.manage(remote_play::RemotePlay::open(app.handle()));
            app.manage(smartconfig::commands::SmartConfigState::default());
            let conflicts = smartconfig::commands::recover(app.handle());
            if conflicts > 0 {
                eprintln!("iBox SmartConfig : {conflicts} optimisation(s) interrompue(s) à vérifier");
            }
            if let Err(e) = shell::install(app.handle()) {
                eprintln!("iBox : icône de notification indisponible : {e}");
            }
            // démarrage avec Windows : iBox attend discrètement dans la zone de notification
            shell::startup(app.handle());
            platform::apply_preview(app.handle());
            if !platform::preview() {
                platform::fit_small_screen(app.handle());
            }
            profile::load(app.handle());
            inetbox::start(app.handle().clone());
            capture::start(app.handle().clone());
            music::start(app.handle().clone());
            // raccourcis globaux (overlay de capture, Music in the Box), réglables dans les Paramètres
            shortcut::start(app.handle().clone(), |app, slot| match slot {
                shortcut::Slot::Capture => capture::on_hotkey(app),
                shortcut::Slot::Music => music::overlay::toggle(app),
                shortcut::Slot::Plugin => plugins::panel::toggle(app),
            });
            plugins::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler({
            fn typed<F: Fn(tauri::ipc::Invoke) -> bool>(f: F) -> F { f }
            let commands = typed(tauri::generate_handler![
            app_info,
            platform::platform_info,
            device::device_info,
            device::device_report_save,
            device::android_device_state,
            device::android_frame_rate,
            power::power_status,
            power::power_report,
            perf::perf_sample,
            pc::steam_shortcut::steam_add_ibox,
            manuals::commands::manual_list,
            storage::storage_info,
            storage::storage_move,
            storage::storage_reveal,
            manuals::commands::manual_read,
            manuals::commands::manual_cover,
            manuals::commands::manual_cover_save,
            manuals::commands::manual_page,
            manuals::commands::manual_page_save,
            manuals::commands::manual_layout,
            manuals::commands::manual_layout_save,
            manuals::commands::manual_import,
            manuals::commands::manual_remove,
            manuals::commands::manual_search,
            manuals::commands::manual_apply,
            manuals::commands::manual_auto,
            manuals::commands::manual_fetch_all,
            manuals::commands::manual_fetch_cancel,
            manuals::commands::manual_fetch_running,
            manuals::commands::manual_status,
            manuals::commands::manual_clear_downloaded,
            manuals::commands::screenscraper_account_set,
            manuals::commands::screenscraper_account_info,
            manuals::commands::screenscraper_account_delete,
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
            smartconfig::commands::smartconfig_hardware,
            smartconfig::commands::smartconfig_providers,
            smartconfig::commands::smartconfig_status,
            smartconfig::commands::smartconfig_recommend,
            smartconfig::commands::smartconfig_preview,
            smartconfig::commands::smartconfig_apply,
            smartconfig::commands::smartconfig_restore,
            smartconfig::commands::smartconfig_history,
            smartconfig::commands::smartconfig_cache_clear,
            smartconfig::commands::smartconfig_feedback,
            smartconfig::commands::smartconfig_sheet,
            smartconfig::commands::smartconfig_sheet_check,
            smartconfig::commands::smartconfig_sheet_withdraw,
            inetbox::inetbox_call,
            profile::profile_activate,
            profile::profile_delete,
            capture::overlay_state,
            capture::overlay_preview,
            capture::overlay_save_shot,
            capture::overlay_save_clip,
            capture::overlay_close,
            capture::overlay_open_community,
            plugins::plugins_list,
            plugins::plugins_install,
            plugins::plugins_set_enabled,
            plugins::plugins_uninstall,
            plugins::plugins_open_screen,
            plugins::plugins_look,
            music::music_state,
            shortcut::shortcuts_set,
            shortcut::shortcuts_suspend,
            music::backdrop::music_backdrop,
            music::music_control,
            music::overlay::music_open,
            music::overlay::music_close,
            music::overlay::music_layout,
            music::overlay::music_follow_cursor,
            music::overlay::music_release,
            music::ytm::music_ytm_open,
            music::ytm::music_ytm_call,
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
            remote_play::guest::remote_play_native_guest_start,
            remote_play::guest::remote_play_native_guest_send,
            remote_play::guest::remote_play_native_guest_keyframe,
            remote_play::guest::remote_play_native_guest_candidate,
            remote_play::guest::remote_play_native_guest_stats,
            remote_play::guest::remote_play_native_guest_stop,
            remote_play::guest::remote_play_webcodecs_report,
            remote_play::guest::remote_play_native_guest_dev_offer,
            remote_play::guest::remote_play_native_guest_dev_answer,
            remote_play::guest::remote_play_native_guest_dev_sample,
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
            crash::crash_log_tail,
            crash::crash_log_ui,
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
            pc::commands::pc_set_epic_folder,
            pc::commands::pc_add_manual,
            pc::commands::pc_installs,
            pc::commands::pc_set_preferred,
            pc::commands::pc_merge_games,
            pc::commands::pc_split_install,
            pc::commands::pc_remove_install,
            uninstall::commands::uninstall_plan,
            uninstall::commands::uninstall_run,
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
            assets::commands::collection_art_import,
            metadata::commands::giphy_key_status,
            metadata::commands::decor_giphy_search,
            assets::commands::collection_art_get,
            assets::commands::image_fetch,
            assets::commands::collection_art_clear,
            assets::commands::games_art_stats,
            assets::commands::game_link_candidates,
            assets::commands::game_link_choose,
            pc::commands::pc_install,
            pc::commands::pc_steam_installed,
            pc::commands::pc_steam_key_set,
            pc::commands::pc_steam_key_delete,
            lib_cmd::folders_list,
            lib_cmd::folder_add,
            lib_cmd::folder_suggestions,
            lib_cmd::folder_update,
            lib_cmd::folder_remove,
            lib_cmd::library_remove_missing,
            library::extras::stats_overview,
            library::extras::game_journal,
            library::extras::collections_list,
            library::extras::collection_create,
            library::extras::collection_update,
            library::extras::collection_delete,
            library::extras::collections_reorder,
            library::extras::collection_set_game,
            library::extras::saves_list,
            library::extras::saves_backup,
            library::extras::saves_reveal,
            lib_cmd::library_list,
            lib_cmd::library_scan,
            lib_cmd::library_scan_cancel,
            lib_cmd::iso_queue,
            lib_cmd::iso_assign,
            lib_cmd::iso_restore_ignored,
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
            launcher::android::android_emulators,
            launcher::android::android_emulator_choose,
            launcher::android::android_platform,
            launcher::android::android_bios_folder_set,
            launcher::android::android_open,
            android::android_storage,
            android::android_storage_request,
            android::android_pick_folder,
            android::android_saf_covered,
            android::android_browse,
            android::android_pad_relay,
            android::android_immersive,
            second_screen::second_screen_status,
            second_screen::second_screen_configure,
            second_screen::second_screen_push,
            android_ingame::android_notify_configure,
            android_ingame::android_notify_status,
            android_ingame::android_notify_request,
            android_ingame::android_notify_settings,
            android_apps::android_apps_list,
            android_apps::android_apps_sync,
            android_apps::android_apps_add,
            android_apps::android_apps_remove,
            android_apps::android_app_plan,
            android_apps::android_app_launch,
            android_apps::android_app_uninstall,
            ]);
            // La fenêtre d'un plugin est « locale » pour Tauri (protocole `iboxplugin` d'iBox) :
            // sans ce filtre, son JavaScript pourrait appeler toutes les commandes d'iBox. Elle
            // ne passe que par `__host/` (plugins/host.rs).
            move |invoke: tauri::ipc::Invoke| {
                if plugins::protocol::is_plugin_label(invoke.message.webview_ref().label()) {
                    invoke.resolver.reject("Commande réservée à iBox.");
                    return true;
                }
                commands(invoke)
            }
        })
        .run(tauri::generate_context!())
        .expect("erreur au démarrage de iBox");
}
