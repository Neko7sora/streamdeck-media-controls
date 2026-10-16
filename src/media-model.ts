export interface MediaTimeline {
  updated_at?:number|null;
  start_sec?: number | null;
  end_sec?: number | null;
  position_sec?: number | null;
  min_seek_sec?: number | null;
  max_seek_sec?: number | null;
}
export interface MediaItem {
  source: "windows" | "chrome";
  session_id?: string;
  frame_id?: number;
  document_id?: string;
  observed_at?: number;
  enriched_at?: number;
  field_sources?: Record<string,"windows"|"chrome">;
  app_id?: string | null;
  tab_id?: number;
  page_url?: string | null;
  page_title?: string | null;
  title: string | null;
  artist?: string | null;
  album?: string | null;
  album_artist?: string | null;
  subtitle?: string | null;
  genres?: string[];
  track_number?: number | null;
  album_track_count?: number | null;
  playback_type?: number | null;
  artwork_data_url?: string | null;
  fallback_artwork_data_url?: string | null;
  artwork_candidates?: Array<{src:string; sizes?:string; type?:string}>;
  browser_media?: {
    element_type?: string;
    muted?: boolean;
    volume?: number;
    loop?: boolean;
    ended?: boolean;
    ready_state?: number;
    picture_in_picture?: boolean;
    buffered_ranges?: Array<[number,number]>;
    seekable_ranges?: Array<[number,number]>;
  };
  playback_status?: number | null;
  playback_state?: string;
  playback_rate?: number | null;
  shuffle?: boolean | null;
  repeat_mode?: number | null;
  controls?: Record<string, boolean>;
  timeline?: MediaTimeline | null;
}
export interface MediaSnapshot {
  current: MediaItem | null;
  sessions: MediaItem[];
  audio?: AudioSnapshot | null;
}
export interface AudioTarget { id: string; name: string; pid?: number; process_path?:string|null; volume: number | null; muted: boolean | null }
export interface AudioSnapshot { master: AudioTarget | null; sessions: AudioTarget[]; observed_at: number }
export function sameTrack(a: MediaItem, b: MediaItem): boolean {
  // Never merge different tracks purely because both come from Chrome.
  const x = a.title?.trim().toLowerCase() ?? "";
  const y = b.title?.trim().toLowerCase() ?? "";
  // A title alone is ambiguous (covers, radio, identically named videos).
  const artist = a.artist?.trim().toLowerCase();
  if(a.album?.trim() && b.album?.trim() && a.album.trim().toLowerCase()!==b.album.trim().toLowerCase()) return false;
  return !!x && x === y && !!artist && artist === b.artist?.trim().toLowerCase();
}
export function mergedCurrent(windows: MediaItem | null, chrome: MediaItem | null): MediaItem | null {
  if (!windows) return chrome;
  if (!chrome) return windows;
  const windowsIsChrome = /chrome/i.test(windows.app_id ?? "");
  if (!windowsIsChrome || !sameTrack(windows, chrome)) return windows;
  // Windows remains authoritative for playback; Chrome can enrich its metadata.
  return {
    ...windows,
    album: windows.album || chrome.album,
    artist: windows.artist || chrome.artist,
    artwork_data_url: chrome.artwork_data_url || windows.artwork_data_url,
    fallback_artwork_data_url: windows.artwork_data_url,
    artwork_candidates: chrome.artwork_candidates,
    page_url: chrome.page_url,
    page_title: chrome.page_title,
    tab_id: chrome.tab_id,
    frame_id: chrome.frame_id,
    document_id: chrome.document_id,
    browser_media: chrome.browser_media,
    enriched_at: chrome.observed_at,
    field_sources:{
      title:"windows",artist:windows.artist?"windows":"chrome",album:windows.album?"windows":"chrome",
      artwork_data_url:chrome.artwork_data_url?"chrome":"windows",timeline:"windows",playback_state:"windows",browser_media:"chrome"
    },
  };
}

export function chooseCurrent(windows: MediaSnapshot, chrome: MediaItem[], selected = "auto"): MediaItem | null {
  if (selected !== "auto") {
    const item = [...windows.sessions, ...chrome].find(x => x.session_id === selected);
    if (!item) return null; // Never silently operate another session after disconnection.
    if (item.source === "chrome") return item;
    const matches = chrome.filter(c => sameTrack(item, c));
    return mergedCurrent(item, matches.length === 1 ? matches[0]! : null);
  }
  if (windows.current) {
    const matches = chrome.filter(c => sameTrack(windows.current!, c));
    return mergedCurrent(windows.current, matches.length === 1 ? matches[0]! : null);
  }
  // Windows can enumerate sessions without designating a current session.
  // Use provider update time, not polling time, to rank Windows sessions.
  const updated = (item: MediaItem) => item.source === "windows" ? item.timeline?.updated_at ?? 0 : item.observed_at ?? 0;
  const fallback = [...windows.sessions, ...chrome].sort((a,b) =>
    Number(b.playback_state === "playing") - Number(a.playback_state === "playing") || updated(b) - updated(a)
  )[0];
  if (!fallback) return null;
  if (fallback.source === "chrome") return fallback;
  const matches = chrome.filter(c => sameTrack(fallback, c));
  return mergedCurrent(fallback, matches.length === 1 ? matches[0]! : null);
}

export function progress(media: MediaItem | null): { position: number | null; duration: number | null; percent: number | null } {
  const t = media?.timeline;
  const start = t?.start_sec ?? 0;
  const position = typeof t?.position_sec === "number" ? Math.max(0, t.position_sec - start) : null;
  const duration = typeof t?.end_sec === "number" && t.end_sec > start ? t.end_sec - start : null;
  return {position, duration, percent: position !== null && duration !== null ? Math.min(100, position / duration * 100) : null};
}
export function safeImage(data: unknown): string | undefined {
  if (typeof data !== "string" || data.length > 1_500_000) return undefined;
  if (!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(data)) return undefined;
  return data;
}
