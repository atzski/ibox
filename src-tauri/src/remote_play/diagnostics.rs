//! Diagnostic réel des capacités de cet ordinateur pour Remote Play (côté hôte).
//! Chaque valeur est interrogée auprès de Windows : rien n'est supposé ni simulé.
//! Le décodage côté invité est mesuré dans le WebView (`services/remotePlay.ts`).

use serde::Serialize;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    pub name: String,
    pub vendor: String,
    pub dedicated_mb: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Codecs {
    pub h264: Vec<String>,
    pub hevc: Vec<String>,
    pub av1: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub windows_build: u32,
    pub windows_label: String,
    /// Windows Graphics Capture disponible (Windows 10 1803+).
    pub graphics_capture: bool,
    /// Bordure jaune de capture retirable (Windows 11 / build 20348+).
    pub borderless_capture: bool,
    /// Son d'un seul processus capturable (build 20348+, à confirmer sur 19041).
    pub process_audio: bool,
    pub gpus: Vec<Gpu>,
    pub hardware_encoders: Codecs,
    pub software_encoders: Codecs,
    pub audio_outputs: u32,
    pub audio_inputs: u32,
    /// Pilote de manettes virtuelles ViGEmBus présent (jamais installé par iBox sans accord).
    pub virtual_pad_driver: bool,
    pub errors: Vec<String>,
}

fn vendor_name(id: u32) -> &'static str {
    match id {
        0x10DE => "NVIDIA",
        0x1002 | 0x1022 => "AMD",
        0x8086 => "Intel",
        0x1414 => "Microsoft",
        0x5143 => "Qualcomm",
        _ => "Autre",
    }
}

pub fn label_for_build(build: u32) -> String {
    match build {
        0 => "Windows (version inconnue)".into(),
        b if b >= 22000 => format!("Windows 11 (build {b})"),
        b => format!("Windows 10 (build {b})"),
    }
}

#[cfg(not(windows))]
pub fn probe() -> Report {
    Report { errors: vec!["Remote Play nécessite Windows.".into()], ..Default::default() }
}

#[cfg(windows)]
pub fn probe() -> Report {
    // COM propre à ce fil : le diagnostic tourne sur un fil dédié
    std::thread::spawn(win::probe).join().unwrap_or_else(|_| Report {
        errors: vec!["Le diagnostic s'est interrompu.".into()],
        ..Default::default()
    })
}

#[cfg(windows)]
mod win {
    use super::*;
    use windows::core::{GUID, PWSTR};
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};
    use windows::Win32::Media::Audio::{eCapture, eRender, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE};
    use windows::Win32::Media::MediaFoundation::*;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};

    pub fn probe() -> Report {
        let mut r = Report::default();
        r.windows_build = windows_build();
        r.windows_label = label_for_build(r.windows_build);
        r.borderless_capture = r.windows_build >= 20348;
        r.process_audio = r.windows_build >= 20348;
        r.virtual_pad_driver = vigem_installed();

        unsafe {
            let com = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
            r.graphics_capture = windows::Graphics::Capture::GraphicsCaptureSession::IsSupported().unwrap_or(false);
            match gpus() {
                Ok(list) => r.gpus = list,
                Err(e) => r.errors.push(format!("Cartes graphiques : {e}")),
            }
            if !crate::remote_play::encode::mf::media_foundation_available() {
                r.errors.push(crate::remote_play::encode::mf::MEDIA_FOUNDATION_MISSING.into());
            } else { match MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET) {
                Ok(()) => {
                    r.hardware_encoders = codecs(MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER);
                    r.software_encoders = codecs(MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_ASYNCMFT | MFT_ENUM_FLAG_SORTANDFILTER);
                    let _ = MFShutdown();
                }
                Err(e) => r.errors.push(format!("Media Foundation indisponible : {e}")),
            } }
            match audio_counts() {
                Ok((out, inp)) => {
                    r.audio_outputs = out;
                    r.audio_inputs = inp;
                }
                Err(e) => r.errors.push(format!("Périphériques audio : {e}")),
            }
            if com {
                CoUninitialize();
            }
        }
        r
    }

    fn windows_build() -> u32 {
        winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE)
            .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
            .and_then(|k| k.get_value::<String, _>("CurrentBuildNumber"))
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0)
    }

    fn vigem_installed() -> bool {
        winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE)
            .open_subkey(r"SYSTEM\CurrentControlSet\Services\ViGEmBus")
            .is_ok()
    }

    unsafe fn gpus() -> windows::core::Result<Vec<Gpu>> {
        let factory: IDXGIFactory1 = CreateDXGIFactory1()?;
        let mut out = Vec::new();
        let mut i = 0;
        while let Ok(adapter) = factory.EnumAdapters1(i) {
            i += 1;
            let desc = adapter.GetDesc1()?;
            if desc.Flags & (DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32) != 0 {
                continue;
            }
            let end = desc.Description.iter().position(|&c| c == 0).unwrap_or(desc.Description.len());
            let gpu = Gpu {
                name: String::from_utf16_lossy(&desc.Description[..end]).trim().to_owned(),
                vendor: vendor_name(desc.VendorId).into(),
                dedicated_mb: (desc.DedicatedVideoMemory / (1024 * 1024)) as u64,
            };
            // un même GPU peut apparaître plusieurs fois (écrans virtuels, sorties multiples)
            if !out.iter().any(|g: &Gpu| g.name == gpu.name && g.dedicated_mb == gpu.dedicated_mb) {
                out.push(gpu);
            }
        }
        Ok(out)
    }

    unsafe fn codecs(flags: MFT_ENUM_FLAG) -> Codecs {
        Codecs {
            h264: encoders(flags, MFVideoFormat_H264),
            hevc: encoders(flags, MFVideoFormat_HEVC),
            av1: encoders(flags, MFVideoFormat_AV1),
        }
    }

    /// Noms des encodeurs Media Foundation qui produisent `subtype`.
    unsafe fn encoders(flags: MFT_ENUM_FLAG, subtype: GUID) -> Vec<String> {
        let output = MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: subtype };
        let mut array: *mut Option<IMFActivate> = std::ptr::null_mut();
        let mut count = 0u32;
        if MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, flags, None, Some(&output), &mut array, &mut count).is_err() || array.is_null() {
            return Vec::new();
        }
        let mut names = Vec::new();
        for i in 0..count as usize {
            // reprendre la propriété de chaque objet pour le libérer
            if let Some(activate) = std::ptr::read(array.add(i)) {
                let mut text = PWSTR::null();
                let mut len = 0u32;
                if activate.GetAllocatedString(&MFT_FRIENDLY_NAME_Attribute, &mut text, &mut len).is_ok() && !text.is_null() {
                    names.push(text.to_string().unwrap_or_default());
                    CoTaskMemFree(Some(text.0 as *const _));
                }
            }
        }
        CoTaskMemFree(Some(array as *const _));
        names.retain(|n| !n.is_empty());
        names.dedup();
        names
    }

    unsafe fn audio_counts() -> windows::core::Result<(u32, u32)> {
        let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let out = devices.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?.GetCount()?;
        let inp = devices.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE)?.GetCount()?;
        Ok((out, inp))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_labels() {
        assert_eq!(label_for_build(19045), "Windows 10 (build 19045)");
        assert_eq!(label_for_build(26100), "Windows 11 (build 26100)");
        assert_eq!(vendor_name(0x10DE), "NVIDIA");
    }

    /// Interroge vraiment cette machine : vérifie que le diagnostic aboutit sans planter.
    #[test]
    #[cfg(windows)]
    fn probe_runs_on_this_machine() {
        let r = probe();
        assert!(r.windows_build > 0, "{r:?}");
        println!("{}", serde_json::to_string_pretty(&r).unwrap());
    }
}
