//! Device Direct3D 11 partagé par la capture (WGC), la conversion BGRA→NV12 et l'encodeur
//! Media Foundation : les images restent sur la carte graphique d'un bout à l'autre.

use windows::core::{Interface, Result};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Win32::Foundation::{HMODULE, LUID};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_11_1};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Multithread, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
    D3D11_CREATE_DEVICE_VIDEO_SUPPORT, D3D11_SDK_VERSION,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::System::WinRT::Direct3D11::CreateDirect3D11DeviceFromDXGIDevice;

#[derive(Clone)]
pub struct Device {
    pub device: ID3D11Device,
    pub context: ID3D11DeviceContext,
    /// Le même device vu par WinRT (exigé par `Direct3D11CaptureFramePool`).
    pub winrt: IDirect3DDevice,
    pub adapter_name: String,
    pub vendor_id: u32,
    pub adapter_luid: LUID,
}

impl Device {
    /// Device matériel de l'adaptateur par défaut, avec prise en charge vidéo (processeur vidéo
    /// et encodeurs) et protection multi-fil (exigée par Media Foundation).
    pub fn create() -> Result<Device> {
        unsafe {
            let mut device = None;
            let mut context = None;
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
                Some(&[D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0]),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )?;
            let device: ID3D11Device = device.ok_or_else(windows::core::Error::empty)?;
            let context: ID3D11DeviceContext = context.ok_or_else(windows::core::Error::empty)?;
            let _ = context.cast::<ID3D11Multithread>()?.SetMultithreadProtected(true);

            let dxgi: IDXGIDevice = device.cast()?;
            let desc = dxgi.GetAdapter()?.GetDesc()?;
            let end = desc.Description.iter().position(|&c| c == 0).unwrap_or(desc.Description.len());
            let winrt: IDirect3DDevice = CreateDirect3D11DeviceFromDXGIDevice(&dxgi)?.cast()?;
            Ok(Device {
                device,
                context,
                winrt,
                adapter_name: String::from_utf16_lossy(&desc.Description[..end]).trim().to_owned(),
                vendor_id: desc.VendorId,
                adapter_luid: desc.AdapterLuid,
            })
        }
    }
}
