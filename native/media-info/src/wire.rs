use serde_json::{Value, json};
use std::collections::HashMap;

#[derive(Default)]
pub struct Encoder {
    images: HashMap<String, String>,
    previous: Value,
    next_id: u64,
}

impl Encoder {
    pub fn encode(&mut self, mut snapshot: Value) -> Value {
        let reset = self.previous.is_null()
            || self.images.len() > 256
            || self.images.keys().map(String::len).sum::<usize>() > 16_000_000;
        if reset {
            self.images.clear();
            self.previous = Value::Null;
        }
        // Current is a reference into sessions, never a duplicate image payload.
        snapshot["current"] = snapshot["current"]["session_id"].clone();
        let mut images = serde_json::Map::new();
        if let Some(sessions) = snapshot["sessions"].as_array_mut() {
            for session in sessions {
                if let Some(object) = session.as_object_mut() {
                    object.remove("observed_at");
                }
                for field in ["artwork_data_url", "app_icon_data_url"] {
                    if let Some(data) = session[field].as_str().map(str::to_owned) {
                        let id = self.images.entry(data.clone()).or_insert_with(|| {
                            self.next_id += 1;
                            let id = self.next_id.to_string();
                            images.insert(id.clone(), json!(data));
                            id
                        });
                        session[field] = json!({"image": id});
                    }
                }
            }
        }
        if let Some(audio) = snapshot["audio"].as_object_mut() {
            audio.remove("observed_at");
        }
        let mut changes = serde_json::Map::new();
        for key in ["current", "sessions", "audio"] {
            if reset || snapshot[key] != self.previous[key] {
                changes.insert(key.to_owned(), snapshot[key].clone());
            }
        }
        self.previous = snapshot;
        json!({"native_wire":2,"reset":reset,"changes":changes,"images":images})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unchanged_clocks_and_shared_images_do_not_repeat_bytes() {
        let mut encoder = Encoder::default();
        let mut snapshot = json!({"current":{"session_id":"a"},"sessions":[
            {"session_id":"a","title":"Track","observed_at":1,"artwork_data_url":"same"},
            {"session_id":"b","title":"Other","observed_at":1,"artwork_data_url":"same"}],"audio":{"observed_at":1,"master":null}});
        let first = encoder.encode(snapshot.clone());
        assert_eq!(first["images"].as_object().unwrap().len(), 1);
        assert_eq!(first["changes"]["current"], "a");
        snapshot["sessions"][0]["observed_at"] = json!(200);
        snapshot["audio"]["observed_at"] = json!(200);
        let next = encoder.encode(snapshot.clone());
        assert_eq!(next["images"], json!({}));
        assert_eq!(next["changes"], json!({}));
        snapshot["sessions"][0]["title"] = json!("Next");
        let next = encoder.encode(snapshot);
        assert_eq!(next["images"], json!({}));
        assert_eq!(next["changes"]["sessions"][0]["title"], "Next");
    }
}
