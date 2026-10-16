//! Windows GSMTC snapshot helper. No metadata is transmitted over the network.
//! One invocation yields one JSON object; an absent field remains null.
#![cfg_attr(not(windows), allow(unused_imports, dead_code))]
#[cfg(windows)]
mod audio;

#[cfg(windows)]
mod system {
    use base64::Engine;
    use serde_json::{Value, json};
    use std::sync::{
        Arc,
        atomic::{AtomicU8, Ordering},
    };
    use std::{
        io::{self, BufRead, Write},
        sync::mpsc,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };
    use windows::Foundation::TypedEventHandler;
    use windows::Media::Control::{
        CurrentSessionChangedEventArgs, MediaPropertiesChangedEventArgs,
        PlaybackInfoChangedEventArgs, SessionsChangedEventArgs, TimelinePropertiesChangedEventArgs,
    };
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession,
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionMediaProperties,
    };
    use windows::Storage::Streams::DataReader;
    use windows::core::Interface;

    fn notify(tx: &mpsc::SyncSender<Option<Value>>, flags: &AtomicU8, artwork: bool) {
        if flags.fetch_or(if artwork { 3 } else { 1 }, Ordering::SeqCst) == 0 {
            let _ = tx.try_send(Some(json!({"wake":true})));
        }
    }

    struct SessionEvents {
        session: GlobalSystemMediaTransportControlsSession,
        media: Option<i64>,
        playback: Option<i64>,
        timeline: Option<i64>,
    }
    impl SessionEvents {
        fn new(
            session: &GlobalSystemMediaTransportControlsSession,
            tx: mpsc::SyncSender<Option<Value>>,
            flags: Arc<AtomicU8>,
        ) -> Self {
            let a = tx.clone();
            let b = tx.clone();
            let fa = flags.clone();
            let fb = flags.clone();
            Self {
                session: session.clone(),
                media: session
                    .MediaPropertiesChanged(
                        &TypedEventHandler::<_, MediaPropertiesChangedEventArgs>::new(
                            move |_, _| {
                                notify(&a, &fa, true);
                                Ok(())
                            },
                        ),
                    )
                    .ok(),
                playback: session
                    .PlaybackInfoChanged(
                        &TypedEventHandler::<_, PlaybackInfoChangedEventArgs>::new(move |_, _| {
                            notify(&b, &fb, false);
                            Ok(())
                        }),
                    )
                    .ok(),
                timeline: session
                    .TimelinePropertiesChanged(&TypedEventHandler::<
                        _,
                        TimelinePropertiesChangedEventArgs,
                    >::new(move |_, _| {
                        notify(&tx, &flags, false);
                        Ok(())
                    }))
                    .ok(),
            }
        }
    }
    impl Drop for SessionEvents {
        fn drop(&mut self) {
            if let Some(t) = self.media {
                let _ = self.session.RemoveMediaPropertiesChanged(t);
            }
            if let Some(t) = self.playback {
                let _ = self.session.RemovePlaybackInfoChanged(t);
            }
            if let Some(t) = self.timeline {
                let _ = self.session.RemoveTimelinePropertiesChanged(t);
            }
        }
    }

    fn now() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                windows::Win32::System::WinRT::RoUninitialize();
            }
        }
    }

    fn str_or_empty(result: windows::core::Result<windows::core::HSTRING>) -> String {
        result.map(|x| x.to_string()).unwrap_or_default()
    }

    fn image_of(
        props: &GlobalSystemMediaTransportControlsSessionMediaProperties,
    ) -> Option<String> {
        let thumbnail = props.Thumbnail().ok()?;
        let stream = thumbnail.OpenReadAsync().ok()?.join().ok()?;
        let size = stream.Size().ok()?;
        if size == 0 || size > 1024 * 1024 {
            return None;
        }
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        let loaded = reader.LoadAsync(size as u32).ok()?.join().ok()?;
        if loaded != size as u32 {
            return None;
        }
        let mut bytes = vec![0; loaded as usize];
        reader.ReadBytes(&mut bytes).ok()?;
        // Some providers use an empty/octet-stream MIME type. Inspect only supported signatures.
        let mime = if bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
            "image/png"
        } else if bytes.starts_with(&[255, 216, 255]) {
            "image/jpeg"
        } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
            "image/webp"
        } else {
            return None;
        };
        Some(format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    }

    fn snapshot_session(
        session: &GlobalSystemMediaTransportControlsSession,
        current: bool,
        cache: &mut Option<(String, Option<String>, u64)>,
        image_allowed: bool,
    ) -> Value {
        let props = session
            .TryGetMediaPropertiesAsync()
            .ok()
            .and_then(|a| a.join().ok());
        let info = session.GetPlaybackInfo().ok();
        let timeline = session.GetTimelineProperties().ok();
        let (title, artist, album, album_artist, subtitle, genre, track, count, kind) =
            if let Some(p) = props.as_ref() {
                let genres = p
                    .Genres()
                    .ok()
                    .map(|v| {
                        (0..v.Size().unwrap_or_default())
                            .filter_map(|i| v.GetAt(i).ok().map(|v| v.to_string()))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                (
                    str_or_empty(p.Title()),
                    str_or_empty(p.Artist()),
                    str_or_empty(p.AlbumTitle()),
                    str_or_empty(p.AlbumArtist()),
                    str_or_empty(p.Subtitle()),
                    genres,
                    p.TrackNumber().ok(),
                    p.AlbumTrackCount().ok(),
                    p.PlaybackType()
                        .ok()
                        .and_then(|v| v.Value().ok().map(|e| e.0)),
                )
            } else {
                (
                    String::new(),
                    String::new(),
                    String::new(),
                    String::new(),
                    String::new(),
                    vec![],
                    None,
                    None,
                    None,
                )
            };
        let controls = info.as_ref().and_then(|p| p.Controls().ok());
        let time = timeline.as_ref().map(|t| {
            json!({
                "start_sec": t.StartTime().ok().map(|t| t.Duration as f64 / 1e7),
                "end_sec": t.EndTime().ok().map(|t| t.Duration as f64 / 1e7),
                "position_sec": t.Position().ok().map(|t| t.Duration as f64 / 1e7),
                "min_seek_sec": t.MinSeekTime().ok().map(|t| t.Duration as f64 / 1e7),
                "max_seek_sec": t.MaxSeekTime().ok().map(|t| t.Duration as f64 / 1e7)
            ,"updated_at":t.LastUpdatedTime().ok().map(|t|(t.UniversalTime-116_444_736_000_000_000)/10_000)
            })
        });
        let signature = format!("{title}\0{artist}\0{album}\0{track:?}");
        let image = if !image_allowed {
            None
        } else {
            match cache.as_ref() {
                Some((old, image, expires)) if old == &signature && *expires > now() => {
                    image.clone()
                }
                _ => {
                    let image = props.as_ref().and_then(image_of);
                    *cache = Some((
                        signature,
                        image.clone(),
                        now() + if image.is_some() { 30000 } else { 3000 },
                    ));
                    image
                }
            }
        };
        json!({
            "source":"windows", "is_current":current,
            "app_id":str_or_empty(session.SourceAppUserModelId()),
            "title": title, "artist": artist, "album": album,
            "album_artist": album_artist, "subtitle":subtitle, "genres":genre,
            "track_number":track, "album_track_count":count, "playback_type":kind,
            "artwork_data_url": image,
            "observed_at": now(),
            "playback_status":info.as_ref().and_then(|p| p.PlaybackStatus().ok().map(|v| v.0)),
            "playback_state": info.as_ref().and_then(|p| p.PlaybackStatus().ok()).map(|v|match v.0 {0=>"closed",1=>"opened",2=>"changing",3=>"stopped",4=>"playing",5=>"paused",_=>"none"}),
            "playback_rate":info.as_ref().and_then(|p| p.PlaybackRate().ok()).and_then(|x|x.Value().ok()),
            "shuffle":info.as_ref().and_then(|p| p.IsShuffleActive().ok()).and_then(|x|x.Value().ok()),
            "repeat_mode":info.as_ref().and_then(|p| p.AutoRepeatMode().ok()).and_then(|x|x.Value().ok().map(|e|e.0)),
            "controls":controls.as_ref().map(|c|json!({
                "play":c.IsPlayEnabled().unwrap_or(false),
                "pause":c.IsPauseEnabled().unwrap_or(false),
                "toggle":c.IsPlayPauseToggleEnabled().unwrap_or(false),
                "stop":c.IsStopEnabled().unwrap_or(false),
                "next":c.IsNextEnabled().unwrap_or(false),
                "previous":c.IsPreviousEnabled().unwrap_or(false),
                "seek":c.IsPlaybackPositionEnabled().unwrap_or(false),
                "rate":c.IsPlaybackRateEnabled().unwrap_or(false),
                "shuffle":c.IsShuffleEnabled().unwrap_or(false),
                "repeat":c.IsRepeatEnabled().unwrap_or(false)
            })),
            "timeline":time
        })
    }

    pub fn run() -> windows::core::Result<()> {
        unsafe {
            windows::Win32::System::WinRT::RoInitialize(
                windows::Win32::System::WinRT::RO_INIT_MULTITHREADED,
            )?;
        }
        let _apartment = Apartment;
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.join()?;
        let watch = std::env::args().any(|x| x == "--watch");
        let (tx, rx) = mpsc::sync_channel::<Option<Value>>(128);
        if watch {
            let tx = tx.clone();
            std::thread::spawn(move || {
                for line in io::stdin().lock().lines() {
                    let Ok(line) = line else {
                        break;
                    };
                    if line.len() > 8192 {
                        continue;
                    }
                    if let Ok(v) = serde_json::from_str(&line) {
                        if tx.send(Some(v)).is_err() {
                            return;
                        }
                    }
                }
                let _ = tx.send(None);
            });
        }
        // Opaque IDs remain stable for this helper lifetime. Never use an AUMID as a session ID.
        let mut known: Vec<(String, GlobalSystemMediaTransportControlsSession)> = vec![];
        let mut counter = 0u64;
        let epoch = format!("{}-{}", std::process::id(), now());
        let mut guards = std::collections::HashMap::<String, SessionEvents>::new();
        let mut images = std::collections::HashMap::new();
        let a = tx.clone();
        let b = tx.clone();
        let flags = Arc::new(AtomicU8::new(0));
        let fa = flags.clone();
        let fb = flags.clone();
        let current_event = manager
            .CurrentSessionChanged(
                &TypedEventHandler::<_, CurrentSessionChangedEventArgs>::new(move |_, _| {
                    notify(&a, &fa, false);
                    Ok(())
                }),
            )
            .ok();
        let sessions_event = manager
            .SessionsChanged(&TypedEventHandler::<_, SessionsChangedEventArgs>::new(
                move |_, _| {
                    notify(&b, &fb, false);
                    Ok(())
                },
            ))
            .ok();
        let mut output = io::stdout().lock();
        loop {
            if flags.swap(0, Ordering::SeqCst) & 2 != 0 {
                images.clear();
            }
            let sessions = manager.GetSessions()?;
            let current = manager.GetCurrentSession().ok();
            let mut next = vec![];
            let mut data = vec![];
            let mut image_bytes = 0usize;
            let mut current_snapshot = Value::Null;
            for i in 0..sessions.Size()?.min(128) {
                if let Ok(session) = sessions.GetAt(i) {
                    let identity = session.cast::<windows::core::IUnknown>()?;
                    let id = known
                        .iter()
                        .find(|(_, s)| {
                            s.cast::<windows::core::IUnknown>().ok().as_ref() == Some(&identity)
                        })
                        .map(|(id, _)| id.clone())
                        .unwrap_or_else(|| {
                            counter += 1;
                            format!("windows:{epoch}:{counter}")
                        });
                    let is_current = current
                        .as_ref()
                        .and_then(|s| s.cast::<windows::core::IUnknown>().ok())
                        .as_ref()
                        == Some(&identity);
                    if watch && !guards.contains_key(&id) {
                        guards.insert(
                            id.clone(),
                            SessionEvents::new(&session, tx.clone(), flags.clone()),
                        );
                    }
                    let mut item = snapshot_session(
                        &session,
                        is_current,
                        images.entry(id.clone()).or_insert(None),
                        is_current || image_bytes < 8_000_000,
                    );
                    image_bytes += item["artwork_data_url"].as_str().map(str::len).unwrap_or(0);
                    item["session_id"] = json!(id);
                    if is_current {
                        current_snapshot = item.clone();
                    }
                    data.push(item);
                    next.push((id, session));
                }
            }
            known = next;
            guards.retain(|id, _| known.iter().any(|(key, _)| key == id));
            images.retain(|id, _| known.iter().any(|(key, _)| key == id));
            let mut cache_bytes = 0usize;
            images.retain(|_, v| {
                cache_bytes += v
                    .as_ref()
                    .and_then(|(_, image, _)| image.as_ref())
                    .map(String::len)
                    .unwrap_or(0);
                cache_bytes <= 12_000_000
            });
            let audio = match crate::audio::snapshot() {
                Ok(value) => Some(value),
                Err(e) => {
                    eprintln!("Core Audio unavailable: {e}");
                    None
                }
            };
            let snapshot = json!({"current":current_snapshot,"sessions":data,"audio":audio});
            writeln!(output, "{snapshot}").ok();
            output.flush().ok();
            if !watch {
                break;
            }
            match rx.recv_timeout(Duration::from_millis(1000)) {
                Ok(Some(command)) => {
                    if command["wake"] == true {
                        std::thread::sleep(Duration::from_millis(100));
                        continue;
                    }
                    let result = command_of(&command, &known);
                    writeln!(output,"{}",json!({"reply":command["id"],"ok":result.is_ok(),"error":result.err().map(|e|e.to_string())})).ok();
                    output.flush().ok();
                }
                Ok(None) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => break,
            }
        }
        if let Some(t) = current_event {
            let _ = manager.RemoveCurrentSessionChanged(t);
        }
        if let Some(t) = sessions_event {
            let _ = manager.RemoveSessionsChanged(t);
        }
        Ok(())
    }

    fn command_of(
        v: &Value,
        sessions: &[(String, GlobalSystemMediaTransportControlsSession)],
    ) -> Result<(), Box<dyn std::error::Error>> {
        let op = v["command"].as_str().ok_or("Missing command")?;
        if op == "volume" || op == "mute" {
            return crate::audio::command(v);
        }
        let id = v["session_id"].as_str().ok_or("Missing session")?;
        let session = &sessions
            .iter()
            .find(|(key, _)| key == id)
            .ok_or("Session unavailable")?
            .1;
        // Resolve the exact retained WinRT object, and respect its current capability flags.
        let c = session.GetPlaybackInfo()?.Controls()?;
        let accepted = match op {
            "play-pause" if c.IsPlayPauseToggleEnabled()? => {
                session.TryTogglePlayPauseAsync()?.join()?
            }
            "play-pause"
                if session.GetPlaybackInfo()?.PlaybackStatus()?.0 == 4 && c.IsPauseEnabled()? =>
            {
                session.TryPauseAsync()?.join()?
            }
            "play-pause" if c.IsPlayEnabled()? => session.TryPlayAsync()?.join()?,
            "next" if c.IsNextEnabled()? => session.TrySkipNextAsync()?.join()?,
            "previous" if c.IsPreviousEnabled()? => session.TrySkipPreviousAsync()?.join()?,
            "stop" if c.IsStopEnabled()? => session.TryStopAsync()?.join()?,
            "seek" if c.IsPlaybackPositionEnabled()? => {
                let sec = v["position"]
                    .as_f64()
                    .filter(|v| v.is_finite())
                    .ok_or("Invalid position")?;
                let t = session.GetTimelineProperties()?;
                let ticks = sec * 1e7;
                if ticks < t.MinSeekTime()?.Duration as f64
                    || ticks > t.MaxSeekTime()?.Duration as f64
                {
                    return Err("Outside seek range".into());
                }
                session
                    .TryChangePlaybackPositionAsync(ticks as i64)?
                    .join()?
            }
            _ => return Err("Operation unavailable".into()),
        };
        if accepted {
            Ok(())
        } else {
            Err("Application rejected operation".into())
        }
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn commands_never_fall_back_to_another_session() {
            assert!(command_of(&json!({}), &[]).is_err());
            assert!(
                command_of(&json!({"command":"play-pause","session_id":"missing"}), &[]).is_err()
            );
            assert!(
                command_of(
                    &json!({"command":"seek","session_id":"missing","position":10}),
                    &[]
                )
                .is_err()
            );
        }
    }
}

fn main() {
    #[cfg(windows)]
    {
        match system::run() {
            Ok(()) => {}
            Err(err) => {
                eprintln!("GSMTC snapshot failed: {err}");
                std::process::exit(1);
            }
        }
    }
    #[cfg(not(windows))]
    {
        eprintln!("Windows only");
        std::process::exit(1);
    }
}
