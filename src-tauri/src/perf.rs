//! Diagnostics de performance (panneau des performances, docs/STEAMDECK.md) : processeur et
//! mémoire du système et d'iBox (moteur web compris : ses processus sont des descendants d'iBox),
//! occupation du GPU. Mesuré à la demande (une fois par seconde par l'interface), par écart avec la
//! mesure précédente.
//!
//! - Linux : `/proc/stat`, `/proc/<pid>/stat` (arborescence d'iBox), `/proc/meminfo`, et
//!   `gpu_busy_percent` des GPU AMD (`/sys/class/drm/card*/device`, le Steam Deck).
//! - Windows : `GetSystemTimes`, processus d'iBox et de WebView2 (`GetProcessTimes`,
//!   `GetProcessMemoryInfo`), `GlobalMemoryStatusEx`, compteur « GPU Engine » (moteur 3D) de PDH.

use serde::Serialize;
use std::sync::Mutex;
use std::time::Instant;

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PerfSample {
    /// Processeur, tout le système (%).
    pub cpu_percent: Option<f32>,
    /// Processeur utilisé par iBox et son moteur web, rapporté à toute la machine (%).
    pub app_cpu_percent: Option<f32>,
    /// GPU occupé (%).
    pub gpu_percent: Option<f32>,
    pub ram_used_mb: Option<u64>,
    pub ram_total_mb: Option<u64>,
    /// Mémoire d'iBox et de son moteur web (Mo).
    pub app_ram_mb: Option<u64>,
}

/// Mesure brute : temps processeur cumulés (unités quelconques mais constantes).
#[derive(Debug, Clone, Copy, Default)]
struct Ticks {
    total: u64,
    idle: u64,
    app: u64,
    at: Option<Instant>,
}

static PREV: Mutex<Option<Ticks>> = Mutex::new(None);

/// Pourcentages entre deux mesures : système (`total`/`idle`) et application (`app`, en temps
/// processeur cumulé sur tous les cœurs, rapporté au temps total de la machine).
fn percents(prev: Ticks, now: Ticks) -> (Option<f32>, Option<f32>) {
    let total = now.total.saturating_sub(prev.total);
    if total == 0 {
        return (None, None);
    }
    let busy = total.saturating_sub(now.idle.saturating_sub(prev.idle));
    let app = now.app.saturating_sub(prev.app);
    let pct = |v: u64| ((v as f64 / total as f64) * 100.0).clamp(0.0, 100.0) as f32;
    (Some(pct(busy)), Some(pct(app)))
}

/// Descendants de `root` (lui compris) dans une liste (pid, parent).
pub fn tree(procs: &[(u32, u32)], root: u32) -> Vec<u32> {
    let mut out = vec![root];
    let mut i = 0;
    while i < out.len() {
        let p = out[i];
        for (pid, parent) in procs {
            if *parent == p && *pid != p && !out.contains(pid) {
                out.push(*pid);
            }
        }
        i += 1;
    }
    out
}

#[cfg(target_os = "linux")]
mod sys {
    use super::{tree, Ticks};

    /// Champs de `/proc/<pid>/stat` après le nom (entre parenthèses, qui peut contenir des espaces).
    fn stat_fields(text: &str) -> Option<Vec<&str>> {
        let end = text.rfind(')')?;
        Some(text[end + 1..].split_whitespace().collect())
    }

    pub fn parse_cpu_line(line: &str) -> Option<(u64, u64)> {
        let v: Vec<u64> = line.strip_prefix("cpu ")?.split_whitespace().filter_map(|x| x.parse().ok()).collect();
        if v.len() < 5 {
            return None;
        }
        // user nice system idle iowait irq softirq steal (guest déjà compté dans user)
        let total: u64 = v.iter().take(8).sum();
        let idle = v[3] + v[4];
        Some((total, idle))
    }

    pub fn parse_meminfo(text: &str) -> (Option<u64>, Option<u64>) {
        let kb = |key: &str| text.lines().find_map(|l| l.strip_prefix(key)?.split_whitespace().next()?.parse::<u64>().ok());
        let total = kb("MemTotal:");
        let avail = kb("MemAvailable:");
        (total.zip(avail).map(|(t, a)| (t - a.min(t)) / 1024), total.map(|t| t / 1024))
    }

    pub fn sample(prev_total_idle: &mut Ticks) -> (Option<u64>, Option<u64>) {
        let stat = std::fs::read_to_string("/proc/stat").unwrap_or_default();
        let (total, idle) = stat.lines().next().and_then(parse_cpu_line).unwrap_or((0, 0));
        let me = std::process::id();
        let mut procs = Vec::new();
        let mut info = std::collections::HashMap::new();
        for e in std::fs::read_dir("/proc").into_iter().flatten().flatten() {
            let Ok(pid) = e.file_name().to_string_lossy().parse::<u32>() else { continue };
            let Ok(text) = std::fs::read_to_string(e.path().join("stat")) else { continue };
            let Some(f) = stat_fields(&text) else { continue };
            // après le nom : état(0) ppid(1) … utime(11) stime(12) … rss(21)
            let ppid = f.get(1).and_then(|x| x.parse().ok()).unwrap_or(0);
            let cpu = f.get(11).and_then(|x| x.parse::<u64>().ok()).unwrap_or(0) + f.get(12).and_then(|x| x.parse::<u64>().ok()).unwrap_or(0);
            let rss = f.get(21).and_then(|x| x.parse::<u64>().ok()).unwrap_or(0);
            procs.push((pid, ppid));
            info.insert(pid, (cpu, rss));
        }
        let mine = tree(&procs, me);
        let (app_cpu, app_rss) = mine.iter().filter_map(|p| info.get(p)).fold((0u64, 0u64), |a, (c, r)| (a.0 + c, a.1 + r));
        *prev_total_idle = Ticks { total, idle, app: app_cpu, at: None };
        let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) }.max(4096) as u64;
        let (used, tot) = parse_meminfo(&std::fs::read_to_string("/proc/meminfo").unwrap_or_default());
        let _ = tot;
        (Some(app_rss * page / (1024 * 1024)), used)
    }

    pub fn ram_total() -> Option<u64> {
        parse_meminfo(&std::fs::read_to_string("/proc/meminfo").unwrap_or_default()).1
    }

    /// GPU AMD (Steam Deck) : le plus occupé des `gpu_busy_percent`.
    pub fn gpu() -> Option<f32> {
        std::fs::read_dir("/sys/class/drm")
            .ok()?
            .flatten()
            .filter_map(|e| std::fs::read_to_string(e.path().join("device/gpu_busy_percent")).ok())
            .filter_map(|t| t.trim().parse::<f32>().ok())
            .reduce(f32::max)
    }
}

#[cfg(windows)]
mod sys {
    use super::{tree, Ticks};
    use std::sync::Mutex;
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows_sys::Win32::System::Threading::{GetProcessTimes, GetSystemTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    fn ft(f: &FILETIME) -> u64 {
        ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64
    }

    fn processes() -> Vec<(u32, u32)> {
        let mut out = Vec::new();
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap.is_null() || snap as isize == -1 {
                return out;
            }
            let mut e: PROCESSENTRY32W = std::mem::zeroed();
            e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            if Process32FirstW(snap, &mut e) != 0 {
                loop {
                    out.push((e.th32ProcessID, e.th32ParentProcessID));
                    if Process32NextW(snap, &mut e) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snap);
        }
        out
    }

    pub fn sample(prev: &mut Ticks) -> (Option<u64>, Option<u64>) {
        let (mut idle, mut kernel, mut user) = unsafe { (std::mem::zeroed::<FILETIME>(), std::mem::zeroed::<FILETIME>(), std::mem::zeroed::<FILETIME>()) };
        let ok = unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } != 0;
        let mine = tree(&processes(), std::process::id());
        let (mut app_cpu, mut app_mem) = (0u64, 0u64);
        for pid in mine {
            unsafe {
                let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                if h.is_null() {
                    continue;
                }
                let (mut c, mut x, mut k, mut u) = (std::mem::zeroed::<FILETIME>(), std::mem::zeroed::<FILETIME>(), std::mem::zeroed::<FILETIME>(), std::mem::zeroed::<FILETIME>());
                if GetProcessTimes(h, &mut c, &mut x, &mut k, &mut u) != 0 {
                    app_cpu += ft(&k) + ft(&u);
                }
                let mut m: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
                m.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
                if GetProcessMemoryInfo(h, &mut m, m.cb) != 0 {
                    app_mem += m.WorkingSetSize as u64;
                }
                CloseHandle(h);
            }
        }
        // temps noyau de GetSystemTimes : il comprend le temps d'inactivité
        *prev = if ok { Ticks { total: ft(&kernel) + ft(&user), idle: ft(&idle), app: app_cpu, at: None } } else { Ticks::default() };
        let mut ms: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
        ms.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        let used = (unsafe { GlobalMemoryStatusEx(&mut ms) } != 0).then(|| (ms.ullTotalPhys - ms.ullAvailPhys) / (1024 * 1024));
        (Some(app_mem / (1024 * 1024)), used)
    }

    pub fn ram_total() -> Option<u64> {
        let mut ms: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
        ms.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        (unsafe { GlobalMemoryStatusEx(&mut ms) } != 0).then(|| ms.ullTotalPhys / (1024 * 1024))
    }

    /// Requête PDH gardée entre deux mesures (le compteur a besoin de deux relevés).
    struct Gpu(windows::Win32::System::Performance::PDH_HQUERY, windows::Win32::System::Performance::PDH_HCOUNTER);
    unsafe impl Send for Gpu {}
    static GPU: Mutex<Option<Gpu>> = Mutex::new(None);

    /// Moteur 3D le plus occupé, toutes cartes et tous processus confondus (%).
    pub fn gpu() -> Option<f32> {
        use windows::core::w;
        use windows::Win32::System::Performance::*;
        let mut slot = GPU.lock().ok()?;
        unsafe {
            if slot.is_none() {
                let mut q = PDH_HQUERY::default();
                if PdhOpenQueryW(None, 0, &mut q) != 0 {
                    return None;
                }
                let mut c = PDH_HCOUNTER::default();
                if PdhAddEnglishCounterW(q, w!("\\GPU Engine(*engtype_3D)\\Utilization Percentage"), 0, &mut c) != 0 {
                    return None;
                }
                PdhCollectQueryData(q);
                *slot = Some(Gpu(q, c));
                return None;
            }
            let Gpu(q, c) = slot.as_ref()?;
            if PdhCollectQueryData(*q) != 0 {
                return None;
            }
            let (mut size, mut count) = (0u32, 0u32);
            let _ = PdhGetFormattedCounterArrayW(*c, PDH_FMT_DOUBLE, &mut size, &mut count, None);
            if size == 0 {
                return None;
            }
            let mut buf = vec![0u8; size as usize];
            if PdhGetFormattedCounterArrayW(*c, PDH_FMT_DOUBLE, &mut size, &mut count, Some(buf.as_mut_ptr().cast())) != 0 {
                return None;
            }
            let items = std::slice::from_raw_parts(buf.as_ptr().cast::<PDH_FMT_COUNTERVALUE_ITEM_W>(), count as usize);
            // un moteur 3D par processus et par carte : leur somme par carte, la plus haute retenue
            let sum: f64 = items.iter().map(|i| i.FmtValue.Anonymous.doubleValue).filter(|v| v.is_finite()).sum();
            Some(sum.clamp(0.0, 100.0) as f32)
        }
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
mod sys {
    use super::Ticks;
    pub fn sample(_: &mut Ticks) -> (Option<u64>, Option<u64>) {
        (None, None)
    }
    pub fn ram_total() -> Option<u64> {
        None
    }
    pub fn gpu() -> Option<f32> {
        None
    }
}

/// Mesure actuelle (pourcentages par écart avec l'appel précédent ; le premier n'en a pas).
pub fn sample() -> PerfSample {
    let mut now = Ticks::default();
    let (app_ram_mb, ram_used_mb) = sys::sample(&mut now);
    now.at = Some(Instant::now());
    let prev = PREV.lock().ok().and_then(|mut p| p.replace(now));
    let (cpu, app) = prev.map(|p| percents(p, now)).unwrap_or((None, None));
    PerfSample { cpu_percent: cpu, app_cpu_percent: app, gpu_percent: sys::gpu(), ram_used_mb, ram_total_mb: sys::ram_total(), app_ram_mb }
}

#[tauri::command]
pub async fn perf_sample() -> PerfSample {
    tauri::async_runtime::spawn_blocking(sample).await.unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pourcentages_par_ecart() {
        let a = Ticks { total: 1000, idle: 600, app: 50, at: None };
        let b = Ticks { total: 2000, idle: 1100, app: 150, at: None };
        // 1000 unités, dont 500 d'inactivité : 50 % ; iBox 100 unités : 10 %
        assert_eq!(percents(a, b), (Some(50.0), Some(10.0)));
        assert_eq!(percents(b, b), (None, None));
    }

    #[test]
    fn arborescence_d_ibox() {
        // iBox (10) → moteur web (11, 12) → sous-processus (13) ; 20 est étranger
        let procs = [(10, 1), (11, 10), (12, 10), (13, 11), (20, 1)];
        let mut t = tree(&procs, 10);
        t.sort();
        assert_eq!(t, [10, 11, 12, 13]);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn lecture_de_proc() {
        assert_eq!(sys::parse_cpu_line("cpu  100 0 50 800 50 0 0 0 0 0"), Some((1000, 850)));
        let (used, total) = sys::parse_meminfo("MemTotal:       16000000 kB\nMemFree: 1 kB\nMemAvailable:    6000000 kB\n");
        assert_eq!((used, total), (Some(9765), Some(15625)));
    }

    #[test]
    fn mesure_reelle() {
        // trois relevés : le compteur GPU (PDH) a besoin de deux mesures après son ouverture
        let _ = sample();
        std::thread::sleep(std::time::Duration::from_millis(300));
        let _ = sample();
        std::thread::sleep(std::time::Duration::from_millis(300));
        let s = sample();
        println!("mesure : {s:?}");
        assert!(s.ram_total_mb.unwrap_or(0) > 100, "{s:?}");
        assert!(s.app_ram_mb.unwrap_or(0) > 0, "{s:?}");
        assert!(s.cpu_percent.is_some(), "{s:?}");
    }
}
