//! Core Audio IDs are selected independently from GSMTC IDs.
use serde_json::{Value, json};
use std::{
    ptr,
    time::{SystemTime, UNIX_EPOCH},
};
use windows::Win32::{
    Foundation::CloseHandle,
    System::Threading::{
        OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        QueryFullProcessImageNameW,
    },
};
use windows::{
    Win32::{
        Media::Audio::{Endpoints::IAudioEndpointVolume, *},
        System::Com::{CLSCTX_ALL, CoCreateInstance, CoTaskMemFree},
    },
    core::{Interface, PWSTR},
};

fn process_path(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = vec![0u16; 32768];
        let mut size = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);
        result
            .ok()
            .map(|_| String::from_utf16_lossy(&buffer[..size as usize]))
    }
}

unsafe fn owned_string(value: PWSTR) -> String {
    let s = unsafe { value.to_string() }.unwrap_or_default();
    unsafe { CoTaskMemFree(Some(value.0.cast())) };
    s
}
fn device() -> windows::core::Result<IMMDevice> {
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)
    }
}
pub fn snapshot() -> windows::core::Result<Value> {
    unsafe {
        let device = device()?;
        let endpoint: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
        let enumerator = manager.GetSessionEnumerator()?;
        let mut sessions = vec![];
        for i in 0..enumerator.GetCount()?.min(256) {
            let item = (|| -> windows::core::Result<Value> {
                let control = enumerator.GetSession(i)?;
                let info: IAudioSessionControl2 = control.cast()?;
                let volume: ISimpleAudioVolume = control.cast()?;
                let pid = info.GetProcessId().ok();
                let path = pid.and_then(process_path);
                let name = control
                    .GetDisplayName()
                    .ok()
                    .map(|s| owned_string(s))
                    .filter(|s| !s.is_empty())
                    .or_else(|| {
                        path.as_ref()
                            .and_then(|s| s.rsplit('\\').next().map(str::to_string))
                    });
                Ok(
                    json!({"id":owned_string(info.GetSessionInstanceIdentifier()?),"pid":pid,"process_path":path,"name":name,"volume":volume.GetMasterVolume().ok(),"muted":volume.GetMute().ok().map(|b|b.as_bool())}),
                )
            })();
            if let Ok(item) = item {
                sessions.push(item);
            }
        }
        Ok(
            json!({"observed_at":SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64,"master":{"id":"master","name":"Default multimedia output","volume":endpoint.GetMasterVolumeLevelScalar().ok(),"muted":endpoint.GetMute().ok().map(|b|b.as_bool())},"sessions":sessions}),
        )
    }
}
fn volume_request(v: &Value) -> Result<(Option<f32>, f32), &'static str> {
    if let Some(value) = v.get("value") {
        if v.get("delta").is_some() {
            return Err("Ambiguous volume request");
        }
        let absolute = value
            .as_f64()
            .filter(|x| x.is_finite() && (0.0..=1.0).contains(x))
            .ok_or("Invalid absolute volume")?;
        Ok((Some(absolute as f32), 0.0))
    } else {
        let delta = v["delta"]
            .as_f64()
            .filter(|x| x.is_finite() && x.abs() <= 1.0)
            .ok_or("Invalid volume delta")?;
        Ok((None, delta as f32))
    }
}

pub fn command(v: &Value) -> Result<(), Box<dyn std::error::Error>> {
    let target = v["target"].as_str().ok_or("Missing audio target")?;
    let mute = v["command"] == "mute";
    let (absolute, delta) = if mute {
        (None, 0.0)
    } else {
        volume_request(v)?
    };
    unsafe {
        let device = device()?;
        if target == "master" {
            let endpoint: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
            if mute {
                endpoint.SetMute(!endpoint.GetMute()?.as_bool(), ptr::null())?;
            } else {
                endpoint.SetMasterVolumeLevelScalar(
                    absolute.unwrap_or(
                        (endpoint.GetMasterVolumeLevelScalar()? + delta).clamp(0.0, 1.0),
                    ),
                    ptr::null(),
                )?;
            }
            return Ok(());
        }
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
        let enumerator = manager.GetSessionEnumerator()?;
        for i in 0..enumerator.GetCount()? {
            let control = enumerator.GetSession(i)?;
            let info: IAudioSessionControl2 = control.cast()?;
            if owned_string(info.GetSessionInstanceIdentifier()?) != target {
                continue;
            }
            let volume: ISimpleAudioVolume = control.cast()?;
            if mute {
                volume.SetMute(!volume.GetMute()?.as_bool(), ptr::null())?;
            } else {
                volume.SetMasterVolume(
                    absolute.unwrap_or((volume.GetMasterVolume()? + delta).clamp(0.0, 1.0)),
                    ptr::null(),
                )?;
            }
            return Ok(());
        }
    }
    Err("Audio session unavailable; select it again".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn absolute_volume_is_bounded_and_keeps_legacy_deltas() {
        assert_eq!(
            volume_request(&json!({"value":0.75})),
            Ok((Some(0.75), 0.0))
        );
        assert_eq!(volume_request(&json!({"value":0})), Ok((Some(0.0), 0.0)));
        assert_eq!(volume_request(&json!({"delta":-0.25})), Ok((None, -0.25)));
        for input in [
            json!({"value":-0.1}),
            json!({"value":1.1}),
            json!({"value":null}),
            json!({"value":"0.5"}),
            json!({"value":0.5,"delta":0.2}),
        ] {
            assert!(volume_request(&input).is_err());
        }
    }
    #[test]
    fn malformed_audio_commands_are_rejected_before_any_device_access() {
        assert!(command(&json!({"command":"volume"})).is_err());
        assert!(command(&json!({"command":"volume","target":"master","delta":2})).is_err());
        assert!(command(&json!({"command":"volume","target":"master","delta":"loud"})).is_err());
    }
}
