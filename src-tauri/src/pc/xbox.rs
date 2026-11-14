use super::{PcLaunch, SourceEntry};
use std::path::Path;
use std::process::Command;

fn valid_aumid(value: &str) -> bool {
    value.len() <= 200 && value.split_once('!').is_some_and(|(family, app)| {
        family.contains('_') && !app.is_empty()
            && family.bytes().chain(app.bytes()).all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    })
}

pub fn launch(aumid: &str) -> Result<PcLaunch, String> {
    if !valid_aumid(aumid) {
        return Err("Identifiant Windows du jeu Xbox invalide.".into());
    }
    let root = std::env::var_os("SystemRoot").ok_or("Dossier Windows introuvable.")?;
    Ok(PcLaunch {
        exe: Path::new(&root).join("explorer.exe").to_string_lossy().into_owned(),
        args: vec![format!(r"shell:AppsFolder\{aumid}")],
        by: "Xbox".into(),
        detached: true,
    })
}

pub fn scan() -> Result<Vec<SourceEntry>, String> {
    #[cfg(windows)]
    use std::os::windows::process::CommandExt;
    let root = std::env::var_os("SystemRoot").ok_or("Dossier Windows introuvable.")?;
    let script = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$start = @(Get-StartApps)
$games = @(foreach ($package in Get-AppxPackage) {
  if (!$package.InstallLocation -or $package.Name -eq 'Microsoft.4297127D64EC6') { continue }
  $config = Join-Path $package.InstallLocation 'MicrosoftGame.config'
  if (!(Test-Path -LiteralPath $config -PathType Leaf -ErrorAction SilentlyContinue)) { continue }
  foreach ($item in $start) {
    if ($item.AppID.StartsWith($package.PackageFamilyName + '!', [StringComparison]::OrdinalIgnoreCase)) {
      @{id=$item.AppID;title=$item.Name}
    }
  }
})
ConvertTo-Json -InputObject $games -Compress
"#;
    let mut cmd = Command::new(Path::new(&root).join("System32/WindowsPowerShell/v1.0/powershell.exe"));
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let output = cmd.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("Impossible de lire les jeux empaquetés inscrits dans Windows.".into());
    }
    #[derive(serde::Deserialize)]
    struct Game {
        id: String,
        title: String,
    }
    let games: Vec<Game> = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    Ok(games.into_iter().filter(|g| valid_aumid(&g.id) && !g.title.trim().is_empty()).map(|g| SourceEntry {
        external_id: g.id.to_ascii_lowercase(),
        title: g.title,
        installed: true,
        launch_target: g.id,
        ..Default::default()
    }).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_accepts_packaged_app_ids() {
        assert!(valid_aumid("CRITICALREFLEX.Mouthwashing_20ymd9g5r2c54!Game"));
        for bad in ["foo!bar", "foo_bar!a!b", "foo_bar!a b", "foo_bar!a/b", "foo_bar!"] {
            assert!(!valid_aumid(bad));
        }
    }

    #[test]
    #[ignore = "requires a real Windows library"]
    fn live_scan() {
        let games = scan().unwrap();
        for game in games {
            println!("{} -> {:?}", game.title, launch(&game.launch_target).unwrap().args);
        }
    }
}
