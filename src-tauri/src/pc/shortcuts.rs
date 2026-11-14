use super::{ScanItem, SourceEntry};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

pub const SOURCES: &[&str] = &["riot", "rsi", "ea", "battlenet", "rockstar", "ubisoft", "xbox"];

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Shortcut {
    title: String,
    target: String,
    args: String,
    folder: String,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    install: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

fn classify(s: &Shortcut) -> Option<&'static str> {
    let title = s.title.to_ascii_lowercase();
    if ["uninstall", "désinstaller", "updater", "error reporter", "recovery", "mise à jour", "launcher", "client riot"]
        .iter().any(|word| title.contains(word))
        || ["ea", "ea app", "battle.net", "ubisoft connect", "riot client", "xbox"].contains(&title.as_str()) {
        return None;
    }
    let target = s.target.to_ascii_lowercase();
    let folder = s.folder.to_ascii_lowercase();
    let args = s.args.to_ascii_lowercase();
    let context = format!("{folder}\\{target}");
    if target.ends_with("\\riotclientservices.exe") && args.contains("--launch-product=") {
        return Some("riot");
    }
    let executable = target.rsplit('\\').next().unwrap_or_default();
    if ["rsi launcher.exe", "launcher.exe", "launcherpatcher.exe", "ubisoftconnect.exe",
        "upc.exe", "ealauncher.exe", "eadesktop.exe", "battle.net.exe", "riotclientservices.exe"]
        .contains(&executable) {
        return None;
    }
    [
        ("rsi", &["roberts space industries", "\\starcitizen\\"][..]),
        ("ea", &["\\ea games\\", "\\origin games\\", "\\electronic arts\\"][..]),
        ("battlenet", &["\\battle.net\\", "\\blizzard entertainment\\"][..]),
        ("rockstar", &["\\rockstar games\\"][..]),
        ("ubisoft", &["\\ubisoft\\", "\\ubisoftconnect\\"][..]),
        ("xbox", &["\\xboxgames\\"][..]),
    ].into_iter().find(|(_, markers)| markers.iter().any(|marker| context.contains(marker))).map(|(source, _)| source)
}

/// Rejoue uniquement les liens de jeu reconnus, tels que créés par le client.
pub fn game_protocol(uri: &str) -> Option<(&'static str, String)> {
    if uri.len() > 512 || !uri.bytes().all(|b| b.is_ascii_alphanumeric() || b":/._-?=&%".contains(&b)) {
        return None;
    }
    if let Some(id) = uri.strip_prefix("uplay://launch/").and_then(|v| v.strip_suffix("/0")) {
        if !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()) {
            return Some(("ubisoft", id.into()));
        }
    }
    let id = uri.strip_prefix("origin2://game/launch?offerIds=")
        .or_else(|| uri.strip_prefix("origin://launchgame/"))?;
    (!id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b":._-".contains(&b)))
        .then(|| ("ea", id.to_ascii_lowercase()))
}

/// Lit les raccourcis créés par les installateurs dans le menu Démarrer.
#[derive(Default)]
pub struct ScanReport {
    pub games: BTreeMap<&'static str, Vec<SourceEntry>>,
    pub ignored: BTreeMap<&'static str, Vec<ScanItem>>,
}

pub fn scan() -> Result<ScanReport, String> {
    #[cfg(windows)]
    use std::os::windows::process::CommandExt;
    let system = std::env::var_os("SystemRoot").ok_or("Dossier Windows introuvable.")?;
    let powershell = PathBuf::from(system).join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let script = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$shell = New-Object -ComObject WScript.Shell
$items = @(foreach ($kind in 'Programs','CommonPrograms','DesktopDirectory','CommonDesktopDirectory') {
  $root = [Environment]::GetFolderPath($kind)
  if ($root -and (Test-Path -LiteralPath $root)) {
    $deep = $kind -in 'Programs','CommonPrograms'
    Get-ChildItem -LiteralPath $root -Recurse:$deep -File | Where-Object Extension -in '.lnk','.url' | ForEach-Object {
      if ($_.Extension -eq '.url') {
        $line = Get-Content -LiteralPath $_.FullName -TotalCount 40 -ErrorAction SilentlyContinue |
          Where-Object { $_.StartsWith('URL=') } | Select-Object -First 1
        if ($line) { @{title=$_.BaseName;target=$line.Substring(4);args='';folder=''} }
        return
      }
      $link = $shell.CreateShortcut($_.FullName)
      if ($link.TargetPath) {
        @{title=$_.BaseName;target=$link.TargetPath;args=[string]$link.Arguments;folder=$_.DirectoryName.Substring($root.Length)}
      }
    }
  }
})

$installed = @(foreach ($root in @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
)) {
  if (!(Test-Path -LiteralPath $root)) { continue }
  foreach ($key in Get-ChildItem -LiteralPath $root) {
    $entry = Get-ItemProperty -LiteralPath $key.PSPath
    if (!$entry.DisplayName) { continue }
    $publisher = [string]$entry.Publisher
    $source = switch -Regex ($publisher) {
      '^(Electronic Arts|EA Swiss)' { 'ea'; break }
      '^Blizzard Entertainment' { 'battlenet'; break }
      '^Rockstar Games' { 'rockstar'; break }
      default { '' }
    }
    if (!$source -or $entry.DisplayName -match 'launcher|social club|^EA app$|^Battle.net$|SDK|redistributable|agent|updater') { continue }
    $dir = [string]$entry.InstallLocation
    if (!$dir -or !(Test-Path -LiteralPath $dir -PathType Container)) {
      @{title=$entry.DisplayName;target='';args='';folder='';source=$source;reason="Dossier d'installation absent ou inaccessible."}
      continue
    }
    $exe = ([string]$entry.DisplayIcon -replace ',\s*-?\d+$','').Trim('" ')
    if ($exe -and !$exe.Contains(':')) { $exe = Join-Path $dir $exe }
    if (!$exe -or !(Test-Path -LiteralPath $exe -PathType Leaf)) {
      @{title=$entry.DisplayName;target='';args='';folder='';source=$source;reason='Exécutable déclaré introuvable.'}
      continue
    }
    @{title=$entry.DisplayName;target=$exe;args='';folder='';source=$source;install=$dir}
  }
})
$ea = @(foreach ($root in 'HKLM:\SOFTWARE\WOW6432Node\Origin Games','HKLM:\SOFTWARE\Origin Games') {
  if (!(Test-Path -LiteralPath $root)) { continue }
  foreach ($key in Get-ChildItem -LiteralPath $root) {
    if ($key.PSChildName -notmatch '^\d+$') { continue }
    $entry = Get-ItemProperty -LiteralPath $key.PSPath
    if ($entry.DisplayName -and !$entry.InstallDir) {
      @{title=$entry.DisplayName;target='';args='';folder='';source='ea';reason="Entrée EA sans chemin d'installation."}
    }
  }
})
$ubisoft = @(foreach ($root in 'HKLM:\SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs','HKLM:\SOFTWARE\Ubisoft\Launcher\Installs') {
  if (!(Test-Path -LiteralPath $root)) { continue }
  foreach ($key in Get-ChildItem -LiteralPath $root) {
    if ($key.PSChildName -notmatch '^\d+$') { continue }
    $entry = Get-ItemProperty -LiteralPath $key.PSPath
    if (!$entry.InstallDir -or !(Test-Path -LiteralPath $entry.InstallDir -PathType Container)) { continue }
    $title = if ($entry.DisplayName) { $entry.DisplayName } else { Split-Path $entry.InstallDir.TrimEnd('\','/') -Leaf }
    @{title=$title;target=('uplay://launch/' + $key.PSChildName + '/0');args='';folder='';install=$entry.InstallDir}
  }
})
$rsi = @(if ($env:ProgramFiles) {
  $launcher = Join-Path $env:ProgramFiles 'Roberts Space Industries\RSI Launcher\RSI Launcher.exe'
  if (Test-Path -LiteralPath $launcher -PathType Leaf) {
    $roots = @(Join-Path $env:ProgramFiles 'Roberts Space Industries')
    foreach ($drive in Get-PSDrive -PSProvider FileSystem) {
      $roots += Join-Path $drive.Root 'Star Citizen'
      $roots += Join-Path $drive.Root 'Roberts Space Industries'
      $roots += Join-Path $drive.Root 'Program Files\Roberts Space Industries'
    }
    foreach ($root in $roots) {
      $live = Join-Path $root 'StarCitizen\LIVE'
      if (Test-Path -LiteralPath (Join-Path $live 'Bin64\StarCitizen.exe') -PathType Leaf) {
        @{title='Star Citizen';target=$launcher;args='';folder='';source='rsi';install=$live}
        break
      }
    }
  }
})
$riot = @(if ($env:ProgramData) {
  $manifest = Join-Path $env:ProgramData 'Riot Games\RiotClientInstalls.json'
  if (Test-Path -LiteralPath $manifest -PathType Leaf) {
    try {
      $data = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
      foreach ($entry in $data.associated_client.PSObject.Properties) {
        $dir = $entry.Name.TrimEnd('/','\')
        $client = ([string]$entry.Value).Replace('/','\')
        if ((Split-Path $client -Leaf) -ine 'RiotClientServices.exe') { continue }
        if (Test-Path -LiteralPath (Join-Path $dir 'VALORANT.exe') -PathType Leaf) {
          @{title='VALORANT';target=$client;args='--launch-product=valorant --launch-patchline=live';folder='';source='riot';install=$dir}
        }
      }
    } catch {
      @{title='Riot Games';target='';args='';folder='';source='riot';reason='Le manifeste Riot est illisible.'}
    }
  }
})
ConvertTo-Json -InputObject ($installed + $ea + $ubisoft + $rsi + $riot + $items) -Compress
"#;
    let mut cmd = Command::new(powershell);
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let output = cmd.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("Impossible de lire les raccourcis du menu Démarrer.".into());
    }
    let shortcuts: Vec<Shortcut> = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    let mut unique = BTreeMap::new();
    let mut report = ScanReport::default();
    for shortcut in shortcuts {
        if let Some((source, external_id)) = game_protocol(&shortcut.target) {
            unique.entry((source, external_id.clone())).or_insert(SourceEntry {
                external_id,
                title: shortcut.title,
                installed: shortcut.install.is_some(),
                install_dir: shortcut.install,
                launch_target: shortcut.target,
                ..Default::default()
            });
            continue;
        }
        let Some(source) = shortcut.source.as_deref().and_then(|id| SOURCES.iter().copied().find(|s| *s == id)).or_else(|| classify(&shortcut)) else { continue };
        let mut ignore = |reason: &str| {
            report.ignored.entry(source).or_default().push(ScanItem {
                title: shortcut.title.clone(), status: "ignored", reason: Some(reason.into()),
            });
        };
        if let Some(reason) = shortcut.reason.as_deref() {
            ignore(reason);
            continue;
        }
        let target = Path::new(&shortcut.target);
        if !target.is_absolute() || !target.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("exe")) || !target.is_file() {
            ignore("Le raccourci ne pointe pas vers un exécutable accessible.");
            continue;
        }
        if let Some(dir) = shortcut.install.as_deref() {
            if !matches!(source, "rsi" | "riot") && !matches!((target.canonicalize(), Path::new(dir).canonicalize()),
                (Ok(exe), Ok(root)) if exe.starts_with(&root) && root.parent().is_some()) {
                ignore("Exécutable hors du dossier déclaré.");
                continue;
            }
        }
        let args = crate::launcher::profiles::split_args(&shortcut.args);
        let external_id = format!("{:016x}", xxhash_rust::xxh3::xxh3_64(format!("{}\0{}", shortcut.target.to_lowercase(), shortcut.args).as_bytes()));
        unique.entry((source, external_id.clone())).or_insert(SourceEntry {
            external_id,
            title: shortcut.title,
            installed: true,
            install_dir: shortcut.install.or_else(|| target.parent().map(|p| p.to_string_lossy().into_owned())),
            launch_target: shortcut.target,
            shortcut_args: Some(args),
            ..Default::default()
        });
    }
    for ((source, _), entry) in unique {
        report.games.entry(source).or_default().push(entry);
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_game_shortcut_protocols() {
        assert_eq!(game_protocol("uplay://launch/123/0"), Some(("ubisoft", "123".into())));
        assert_eq!(game_protocol("origin2://game/launch?offerIds=Origin.OFR.123"), Some(("ea", "origin.ofr.123".into())));
        assert!(game_protocol("uplay://launch/123/0?extra=1").is_none());
        assert!(game_protocol("origin2://game/launch?offerIds=123&other=4").is_none());
    }

    #[test]
    fn riot_game_is_distinct_from_its_launcher() {
        let mut item = Shortcut {
            title: "League of Legends".into(),
            target: r"C:\Riot Games\Riot Client\RiotClientServices.exe".into(),
            args: "--launch-product=league_of_legends --launch-patchline=live".into(),
            folder: r"\Riot Games".into(),
            source: None,
            install: None,
            reason: None,
        };
        assert_eq!(classify(&item), Some("riot"));
        item.args.clear();
        assert_eq!(classify(&item), None);
    }
}
