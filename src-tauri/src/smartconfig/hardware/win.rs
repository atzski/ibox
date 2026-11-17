//! Collecte Windows : sysinfo (processeur, mémoire), DXGI (cartes graphiques,
//! pilotes), Direct3D (niveaux pris en charge), GDI (écran principal),
//! registre en lecture seule (modèle d'appareil). Aucune écriture.

use super::*;
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_11_0};
use windows::Win32::Graphics::Direct3D11::{D3D11CreateDevice, D3D11_CREATE_DEVICE_FLAG, D3D11_SDK_VERSION};
use windows::Win32::Graphics::Direct3D12::{D3D12CreateDevice, ID3D12Device};
use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIAdapter1, IDXGIDevice, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};
use windows::core::Interface;

pub fn detect() -> HardwareInfo {
    let mut hw = HardwareInfo {
        os: OsInfo { family: "windows".into(), version: sysinfo::System::long_os_version(), arch: std::env::consts::ARCH.into() },
        ..Default::default()
    };
    let mut sys = sysinfo::System::new();
    sys.refresh_cpu_all();
    sys.refresh_memory();
    let cpus = sys.cpus();
    if let Some(c) = cpus.first() {
        let brand = c.brand().trim();
        hw.cpu.brand = (!brand.is_empty()).then(|| brand.to_string());
        let vendor = c.vendor_id().trim();
        hw.cpu.vendor = (!vendor.is_empty()).then(|| vendor.to_string());
    }
    hw.cpu.threads = (!cpus.is_empty()).then_some(cpus.len() as u32);
    hw.cpu.physical_cores = sysinfo::System::physical_core_count().map(|n| n as u32);
    let total = sys.total_memory();
    hw.ram_mb = (total > 0).then_some(total / (1024 * 1024));

    let adapters = unsafe { adapters() }.unwrap_or_default();
    let mut d3d11 = None;
    let mut d3d12 = None;
    for (adapter, gpu) in adapters {
        if !gpu.software && hw.primary_gpu.is_none() {
            hw.primary_gpu = Some(hw.gpus.len());
            unsafe {
                d3d11 = Some(supports_d3d11(&adapter));
                d3d12 = Some(D3D12CreateDevice::<_, ID3D12Device>(&adapter, D3D_FEATURE_LEVEL_11_0, std::ptr::null_mut()).is_ok());
            }
        }
        hw.gpus.push(gpu);
    }
    hw.apis = GraphicsApis {
        d3d11,
        d3d12,
        vulkan_loader: Some(system32("vulkan-1.dll")),
        // la présence d'opengl32.dll ne dit rien du pilote : non vérifié
        opengl: None,
        metal: Some(false),
    };
    hw.displays = primary_display().into_iter().collect();
    hw.device_model = device_model();
    hw.device = device_type(hw.device_model.as_deref(), has_battery());
    hw
}

unsafe fn adapters() -> windows::core::Result<Vec<(IDXGIAdapter1, GpuInfo)>> {
    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1()? };
    let mut out: Vec<(IDXGIAdapter1, GpuInfo)> = Vec::new();
    let mut i = 0;
    while let Ok(adapter) = unsafe { factory.EnumAdapters1(i) } {
        i += 1;
        let Ok(desc) = (unsafe { adapter.GetDesc1() }) else { continue };
        let end = desc.Description.iter().position(|&c| c == 0).unwrap_or(desc.Description.len());
        let name = String::from_utf16_lossy(&desc.Description[..end]).trim().to_owned();
        let vendor = GpuVendor::from_pci(desc.VendorId);
        let software = desc.Flags & (DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32) != 0;
        let vram = (desc.DedicatedVideoMemory / (1024 * 1024)) as u64;
        // version du pilote en mode utilisateur : quatre champs de 16 bits
        let driver_version = unsafe { adapter.CheckInterfaceSupport(&IDXGIDevice::IID) }.ok().map(|v| {
            let v = v as u64;
            format!("{}.{}.{}.{}", v >> 48, (v >> 32) & 0xFFFF, (v >> 16) & 0xFFFF, v & 0xFFFF)
        });
        let gpu = GpuInfo {
            integrated: if software { None } else { integrated_guess(vendor, &name) },
            dedicated_vram_mb: (!software && vram > 0).then_some(vram),
            name,
            vendor,
            driver_version,
            software,
        };
        // un même GPU peut apparaître plusieurs fois (sorties multiples)
        if !out.iter().any(|(_, g)| g.name == gpu.name && g.dedicated_vram_mb == gpu.dedicated_vram_mb) {
            out.push((adapter, gpu));
        }
    }
    Ok(out)
}

unsafe fn supports_d3d11(adapter: &IDXGIAdapter1) -> bool {
    let mut level = Default::default();
    unsafe {
        D3D11CreateDevice(adapter, D3D_DRIVER_TYPE_UNKNOWN, HMODULE::default(), D3D11_CREATE_DEVICE_FLAG(0), Some(&[D3D_FEATURE_LEVEL_11_0]), D3D11_SDK_VERSION, None, Some(&mut level), None).is_ok()
    }
}

fn system32(file: &str) -> bool {
    std::env::var("SystemRoot").map(|r| std::path::Path::new(&r).join("System32").join(file).is_file()).unwrap_or(false)
}

fn primary_display() -> Option<DisplayInfo> {
    use windows::Win32::Graphics::Gdi::{EnumDisplaySettingsW, DEVMODEW, ENUM_CURRENT_SETTINGS};
    let mut mode = DEVMODEW { dmSize: std::mem::size_of::<DEVMODEW>() as u16, ..Default::default() };
    unsafe { EnumDisplaySettingsW(None, ENUM_CURRENT_SETTINGS, &mut mode) }.as_bool().then(|| DisplayInfo {
        width: mode.dmPelsWidth,
        height: mode.dmPelsHeight,
        // 0 ou 1 = « matériel par défaut » selon la documentation : inconnu
        refresh_hz: (mode.dmDisplayFrequency > 1).then_some(mode.dmDisplayFrequency),
        primary: true,
    })
}

/// Modèle annoncé par le BIOS (lecture seule ; jamais le numéro de série).
fn device_model() -> Option<String> {
    let key = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE).open_subkey(r"HARDWARE\DESCRIPTION\System\BIOS").ok()?;
    let product: String = key.get_value("SystemProductName").ok()?;
    let product = product.trim();
    let generic = ["", "System Product Name", "To be filled by O.E.M.", "Default string"];
    (!generic.contains(&product)).then(|| product.chars().take(80).collect())
}

fn has_battery() -> Option<bool> {
    use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut s: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
    if unsafe { GetSystemPowerStatus(&mut s) } == 0 {
        return None;
    }
    match s.BatteryFlag {
        255 => None,
        f if f & 128 != 0 => Some(false),
        _ => Some(true),
    }
}
