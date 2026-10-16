//! Windows GSMTC snapshot helper. No metadata is transmitted over the network.
//! One invocation yields one JSON object; an absent field remains null.
#![cfg_attr(not(windows), allow(unused_imports, dead_code))]

#[cfg(windows)]
mod system {
    use base64::Engine;
    use serde_json::{json, Value};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession,
        GlobalSystemMediaTransportControlsSessionManager,
    };
    use windows::Storage::Streams::DataReader;

    fn str_or_empty(result: windows::core::Result<windows::core::HSTRING>) -> String {
        result.map(|x| x.to_string()).unwrap_or_default()
    }

    fn image_of(session: &GlobalSystemMediaTransportControlsSession) -> Option<String> {
        let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
        let thumbnail = props.Thumbnail().ok()?;
        let stream = thumbnail.OpenReadAsync().ok()?.get().ok()?;
        let size = stream.Size().ok()?;
        if size == 0 || size > 1024 * 1024 { return None; }
        let mime = str_or_empty(stream.ContentType());
        if !matches!(mime.as_str(), "image/jpeg" | "image/png" | "image/webp") { return None; }
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        let loaded = reader.LoadAsync(size as u32).ok()?.get().ok()?;
        if loaded == 0 || loaded > 1024 * 1024 { return None; }
        let mut bytes = vec![0; loaded as usize];
        reader.ReadBytes(&mut bytes).ok()?;
        Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
    }

    fn snapshot_session(session: &GlobalSystemMediaTransportControlsSession, current: bool) -> Value {
        let props = session.TryGetMediaPropertiesAsync().ok().and_then(|a| a.get().ok());
        let info = session.GetPlaybackInfo().ok();
        let timeline = session.GetTimelineProperties().ok();
        let (title, artist, album, album_artist, subtitle, genre, track, count, kind) = if let Some(p) = props.as_ref() {
            let genres = p.Genres().ok().map(|v| {
                (0..v.Size().unwrap_or_default()).filter_map(|i| v.GetAt(i).ok().map(|v| v.to_string())).collect::<Vec<_>>()
            }).unwrap_or_default();
            (str_or_empty(p.Title()), str_or_empty(p.Artist()), str_or_empty(p.AlbumTitle()),
             str_or_empty(p.AlbumArtist()), str_or_empty(p.Subtitle()), genres,
             p.TrackNumber().ok(), p.AlbumTrackCount().ok(), p.PlaybackType().ok().and_then(|v| v.Value().ok().map(|e| e.0)))
        } else { (String::new(), String::new(), String::new(), String::new(), String::new(), vec![], None, None, None) };
        let controls = info.as_ref().and_then(|p| p.Controls().ok());
        let time = timeline.as_ref().map(|t| json!({
            "start_sec": t.StartTime().ok().map(|t| t.Duration as f64 / 1e7),
            "end_sec": t.EndTime().ok().map(|t| t.Duration as f64 / 1e7),
            "position_sec": t.Position().ok().map(|t| t.Duration as f64 / 1e7),
            "min_seek_sec": t.MinSeekTime().ok().map(|t| t.Duration as f64 / 1e7),
            "max_seek_sec": t.MaxSeekTime().ok().map(|t| t.Duration as f64 / 1e7)
        }));
        json!({
            "source":"windows", "is_current":current,
            "app_id":str_or_empty(session.SourceAppUserModelId()),
            "title": title, "artist": artist, "album": album,
            "album_artist": album_artist, "subtitle":subtitle, "genres":genre,
            "track_number":track, "album_track_count":count, "playback_type":kind,
            "artwork_data_url": image_of(session),
            "playback_status":info.as_ref().and_then(|p| p.PlaybackStatus().ok().map(|v| v.0)),
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

    pub fn run() -> windows::core::Result<Value> {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.get()?;
        let current = manager.GetCurrentSession().ok();
        let current_id = current.as_ref().and_then(|s|s.SourceAppUserModelId().ok()).map(|x|x.to_string());
        let current_snapshot = current.as_ref().map(|s|snapshot_session(s, true));
        let sessions = manager.GetSessions()?;
        let mut data = Vec::new();
        for i in 0..sessions.Size()? {
            if let Ok(session) = sessions.GetAt(i) {
                let current = current_id.as_ref().map(|id|session.SourceAppUserModelId().ok().map(|v|v.to_string()).as_ref() == Some(id)).unwrap_or(false);
                // App user model IDs are not session IDs: is_current is a hint only.
                data.push(snapshot_session(&session, current));
            }
        }
        Ok(json!({"current":current_snapshot,"sessions":data}))
    }
}

fn main() {
    #[cfg(windows)] {
        match system::run() {
            Ok(json) => println!("{json}"),
            Err(err) => { eprintln!("GSMTC snapshot failed: {err}"); std::process::exit(1); }
        }
    }
    #[cfg(not(windows))] {
        eprintln!("Windows only");
        std::process::exit(1);
    }
}
