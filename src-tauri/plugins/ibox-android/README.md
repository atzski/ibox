# tauri-plugin-ibox-android

Socle Android d'iBox : plugin mobile Tauri 2 (Rust + Kotlin), interne au dépôt, jamais publié.
Documentation complète : `docs/ANDROID.md`, section « Socle natif ».

- Rust : `src/lib.rs` (`IboxAndroidExt::ibox_android()` : `launch`, `installed`, `set_immersive`,
  `set_pad_relay`, `storage_status`, `request_all_files`, `pick_folder`, `rom_uri`).
- Kotlin : `android/src/main/java/app/ibox/plugin/` (`IboxPlugin`, `PadRelay`, `Storage`).
- Interface : événement `pad` (`addPluginListener("ibox-android", "pad", …)`), autorisé par la
  capacité `src-tauri/capabilities/android.json`.
- `MainActivity` (projet Gradle d'iBox) transmet au plugin les événements des manettes et le
  retour du focus (plein écran immersif).
