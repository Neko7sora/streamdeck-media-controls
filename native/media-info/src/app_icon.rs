//! Read the source application's registered logo or Shell icon; never its media thumbnail.
use base64::Engine;
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use windows::{
    ApplicationModel::AppInfo,
    Foundation::Size,
    Graphics::Imaging::{BitmapAlphaMode, BitmapEncoder, BitmapPixelFormat},
    Storage::Streams::{DataReader, InMemoryRandomAccessStream, RandomAccessStreamReference},
    Win32::{
        Foundation::SIZE,
        Graphics::Gdi::*,
        UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_ICONONLY},
    },
    core::{HSTRING, PCWSTR},
};

#[derive(Default)]
pub struct IconCache(HashMap<String, (Option<String>, Instant)>);
impl IconCache {
    pub fn get(&mut self, app_id: &str, executable: Option<&str>) -> Option<String> {
        if app_id.is_empty() {
            return None;
        }
        let key = format!("{app_id}\0{}", executable.unwrap_or_default());
        if let Some((image, expiry)) = self.0.get(&key) {
            if *expiry > Instant::now() {
                return image.clone();
            }
        }
        let image = registered_logo(app_id)
            .or_else(|| shell_icon(&format!("shell:AppsFolder\\{app_id}")))
            .or_else(|| executable.and_then(shell_icon));
        if self.0.len() >= 128 {
            self.0.clear();
        }
        let ttl = if image.is_some() { 300 } else { 30 };
        self.0.insert(
            key,
            (image.clone(), Instant::now() + Duration::from_secs(ttl)),
        );
        image
    }
}

fn data_url<P: windows::core::Param<windows::Storage::Streams::IInputStream>>(
    stream: P,
    size: u64,
) -> Option<String> {
    if size == 0 || size > 128 * 1024 {
        return None;
    }
    let reader = DataReader::CreateDataReader(stream).ok()?;
    if reader.LoadAsync(size as u32).ok()?.join().ok()? != size as u32 {
        return None;
    }
    let mut bytes = vec![0; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    if !bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
        return None;
    }
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn registered_logo(app_id: &str) -> Option<String> {
    let app = AppInfo::GetFromAppUserModelId(&HSTRING::from(app_id)).ok()?;
    let logo: RandomAccessStreamReference = app
        .DisplayInfo()
        .ok()?
        .GetLogo(Size {
            Width: 32.0,
            Height: 32.0,
        })
        .ok()?;
    let stream = logo.OpenReadAsync().ok()?.join().ok()?;
    data_url(&stream, stream.Size().ok()?)
}

struct OwnedBitmap(HBITMAP);
impl Drop for OwnedBitmap {
    fn drop(&mut self) {
        unsafe {
            let _ = DeleteObject(self.0.into());
        }
    }
}
struct ScreenDc(HDC);
impl Drop for ScreenDc {
    fn drop(&mut self) {
        unsafe {
            ReleaseDC(None, self.0);
        }
    }
}

fn shell_icon(path: &str) -> Option<String> {
    let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
    let (width, height, pixels) = unsafe {
        let item: IShellItemImageFactory =
            SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).ok()?;
        let bitmap = OwnedBitmap(
            item.GetImage(SIZE { cx: 32, cy: 32 }, SIIGBF_ICONONLY)
                .ok()?,
        );
        let mut info = BITMAP::default();
        if GetObjectW(
            bitmap.0.into(),
            std::mem::size_of::<BITMAP>() as i32,
            Some((&mut info as *mut BITMAP).cast()),
        ) == 0
        {
            return None;
        }
        let (width, height) = (info.bmWidth, info.bmHeight);
        if width <= 0 || height <= 0 || width > 256 || height > 256 {
            return None;
        }
        let dc = ScreenDc(GetDC(None));
        if dc.0.is_invalid() {
            return None;
        }
        let mut dib = BITMAPINFO::default();
        dib.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let mut pixels = vec![0; (width * height * 4) as usize];
        if GetDIBits(
            dc.0,
            bitmap.0,
            0,
            height as u32,
            Some(pixels.as_mut_ptr().cast()),
            &mut dib,
            DIB_RGB_COLORS,
        ) != height
        {
            return None;
        }
        // Legacy Shell icons may omit an alpha channel entirely.
        if pixels.chunks_exact(4).all(|p| p[3] == 0) {
            for p in pixels.chunks_exact_mut(4) {
                p[3] = 255;
            }
        }
        (width as u32, height as u32, pixels)
    };
    let stream = InMemoryRandomAccessStream::new().ok()?;
    let encoder = BitmapEncoder::CreateAsync(BitmapEncoder::PngEncoderId().ok()?, &stream)
        .ok()?
        .join()
        .ok()?;
    encoder
        .SetPixelData(
            BitmapPixelFormat::Bgra8,
            BitmapAlphaMode::Premultiplied,
            width,
            height,
            96.0,
            96.0,
            &pixels,
        )
        .ok()?;
    encoder.FlushAsync().ok()?.join().ok()?;
    stream.Seek(0).ok()?;
    data_url(&stream, stream.Size().ok()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_shell_icon_is_encoded_as_png_and_cached() {
        use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize};
        unsafe {
            RoInitialize(RO_INIT_MULTITHREADED).unwrap();
        }
        struct Apartment;
        impl Drop for Apartment {
            fn drop(&mut self) {
                unsafe {
                    RoUninitialize();
                }
            }
        }
        let _apartment = Apartment;
        let path = std::path::PathBuf::from(std::env::var_os("WINDIR").unwrap())
            .join("System32")
            .join("cmd.exe");
        let path = path.to_str().unwrap();
        let mut cache = IconCache::default();
        assert_eq!(cache.get("", None), None);
        let image = cache
            .get("unregistered-test-app.exe", Some(path))
            .expect("local executable icon");
        assert_eq!(
            cache.get("unregistered-test-app.exe", Some(path)).as_ref(),
            Some(&image)
        );
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(image.strip_prefix("data:image/png;base64,").unwrap())
            .unwrap();
        assert!(bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]));
        assert_eq!(cache.0.len(), 1);
    }
}
