export interface MediaTimeline {
  start_sec?: number | null;
  end_sec?: number | null;
  position_sec?: number | null;
  min_seek_sec?: number | null;
  max_seek_sec?: number | null;
}
export interface MediaItem {
  source: "windows" | "chrome";
  app_id?: string;
  tab_id?: number;
  page_url?: string;
  page_title?: string;
  title: string;
  artist?: string;
  album?: string;
  album_artist?: string;
  subtitle?: string;
  genres?: string[];
  track_number?: number | null;
  album_track_count?: number | null;
  playback_type?: number | null;
  artwork_data_url?: string | null;
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
}
export function sameTrack(a: MediaItem, b: MediaItem): boolean {
  // Never merge different tracks purely because both come from Chrome.
  const x = a.title.trim().toLocaleLowerCase();
  const y = b.title.trim().toLocaleLowerCase();
  return !!x && !!y && x === y && (!a.artist || !b.artist || a.artist.trim().toLocaleLowerCase() === b.artist.trim().toLocaleLowerCase());
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
    artwork_candidates: chrome.artwork_candidates,
    page_url: chrome.page_url,
    page_title: chrome.page_title,
    tab_id: chrome.tab_id,
  };
}
export function safeImage(data: unknown): string | undefined {
  if (typeof data !== "string" || data.length > 1_500_000) return undefined;
  if (!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(data)) return undefined;
  return data;
}
