import { safeImage, type MediaItem, type MediaSnapshot, type AudioSnapshot, type AudioTarget } from "./media-model.js";

const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown, max = 500): string => typeof v === "string" ? v.slice(0, max) : "";
const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const bool = (v: unknown): boolean | null => typeof v === "boolean" ? v : null;
const pairs = (v: unknown): Array<[number,number]> => Array.isArray(v) ? v.slice(0,32).flatMap(x => Array.isArray(x) && x.length === 2 && num(x[0]) !== null && num(x[1]) !== null && x[0] >= 0 && x[1] >= x[0] ? [[x[0],x[1]] as [number,number]] : []) : [];

export function validateMedia(value: unknown, source: "windows" | "chrome", now = Date.now()): MediaItem | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const v = object(value), t = object(v.timeline), b = object(v.browser_media), c = object(v.controls);
  const controls: Record<string, boolean> = {};
  for (const key of ["play","pause","toggle","stop","next","previous","seek","rate","shuffle","repeat"]) if (typeof c[key] === "boolean") controls[key] = c[key];
  const browser: NonNullable<MediaItem["browser_media"]> = {};
  if (typeof b.target_id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(b.target_id)) browser.target_id = b.target_id;
  for (const key of ["muted","loop","ended","seeking","picture_in_picture"] as const) if (typeof b[key] === "boolean") browser[key] = b[key];
  if (typeof b.volume === "number" && b.volume >= 0 && b.volume <= 1) browser.volume = b.volume;
  if (Number.isInteger(b.ready_state) && Number(b.ready_state) >= 0 && Number(b.ready_state) <= 4) browser.ready_state = Number(b.ready_state);
  if (b.element_type === "audio" || b.element_type === "video") browser.element_type = b.element_type;
  browser.buffered_ranges = pairs(b.buffered_ranges); browser.seekable_ranges = pairs(b.seekable_ranges);
  return {
    source, session_id: text(v.session_id,2048), observed_at: num(v.observed_at) ?? now,
    title: text(v.title)||null, artist: text(v.artist)||null, album: text(v.album)||null, album_artist: text(v.album_artist)||null, subtitle: text(v.subtitle)||null,
    app_id: text(v.app_id)||null, page_url: text(v.page_url,2048)||null, page_title: text(v.page_title)||null,
    genres: Array.isArray(v.genres) ? v.genres.slice(0,32).map(x => text(x,100)) : [],
    track_number: num(v.track_number), album_track_count: num(v.album_track_count), playback_type: num(v.playback_type),
    artwork_data_url: safeImage(v.artwork_data_url) ?? null,
    app_icon_data_url: source === "windows" ? safeImage(v.app_icon_data_url) ?? null : null,
    favicon_data_url: source === "chrome" ? safeImage(v.favicon_data_url) ?? null : null,
    artwork_candidates: Array.isArray(v.artwork_candidates) ? v.artwork_candidates.slice(0,12).flatMap(x => {
      const a = object(x); return typeof a.src === "string" && a.src.length <= 2048 ? [{src:a.src,sizes:text(a.sizes,100),type:text(a.type,100)}] : [];
    }) : [],
    playback_status: num(v.playback_status), playback_state: ["playing","paused","none","closed","opened","changing","stopped"].includes(String(v.playback_state)) ? String(v.playback_state) : "none",
    playback_rate: num(v.playback_rate), shuffle: bool(v.shuffle), repeat_mode: num(v.repeat_mode), controls,
    browser_media: source === "chrome" ? browser : undefined,
    timeline: v.timeline ? {updated_at:num(t.updated_at),start_sec:num(t.start_sec),end_sec:num(t.end_sec),position_sec:num(t.position_sec),min_seek_sec:num(t.min_seek_sec),max_seek_sec:num(t.max_seek_sec)} : null
  };
}

export function validateSnapshot(value: unknown): MediaSnapshot {
  const v = object(value);
  if (!Array.isArray(v.sessions) || v.sessions.length > 128 || !(v.current === null || typeof v.current === "object")) throw new Error("Invalid GSMTC snapshot");
  const target = (value: unknown): AudioTarget | null => {
    const a = object(value); if (typeof a.id !== "string") return null;
    const volume = num(a.volume);
    return {id:text(a.id,2048),name:text(a.name),pid:num(a.pid) ?? undefined,process_path:text(a.process_path,32768)||null,volume:volume !== null && volume >= 0 && volume <= 1 ? volume : null,muted:bool(a.muted)};
  };
  const audio = object(v.audio);
  const audioState: AudioSnapshot | null = v.audio ? {master:target(audio.master),sessions:Array.isArray(audio.sessions) ? audio.sessions.slice(0,256).map(target).filter(x => x !== null) : [],observed_at:num(audio.observed_at) ?? Date.now()} : null;
  return {current:validateMedia(v.current,"windows"),sessions:v.sessions.map(x=>validateMedia(x,"windows")).filter(x=>x!==null),audio:audioState};
}
