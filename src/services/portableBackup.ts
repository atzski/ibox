import { invoke } from "@tauri-apps/api/core";
import { useCollectionStyles, type CollectionStyle } from "./extras";
import { isTauri } from "./native";
import { useSettings, type SettingsState } from "./settings";

export function portableSettings() {
  const { set, toggleFavorite, ...settings } = useSettings.getState();
  void set;
  void toggleFavorite;
  return JSON.stringify({ format: 1, settings, styles: useCollectionStyles.getState().styles });
}

export async function restorePortableSettings() {
  if (!isTauri()) return;
  const data = await invoke<string | null>("portable_settings");
  if (!data) return;
  const { settings, styles } = JSON.parse(data) as { settings: Partial<SettingsState>; styles: Record<number, CollectionStyle> };
  const { set, toggleFavorite } = useSettings.getState();
  useSettings.setState({ ...useSettings.getInitialState(), ...settings, set, toggleFavorite }, true);
  useCollectionStyles.setState({ styles });
  await invoke("portable_ack");
}
