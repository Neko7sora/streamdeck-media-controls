import {t} from "./localization.js";
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
  client_id?: string;
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
  app_icon_data_url?: string | null;
  favicon_data_url?: string | null;
  fallback_artwork_data_url?: string | null;
  artwork_candidates?: Array<{src:string; sizes?:string; type?:string}>;
  browser_media?: {
    target_id?: string;
    element_type?: string;
    muted?: boolean;
    volume?: number;
    loop?: boolean;
    ended?: boolean;
    seeking?: boolean;
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
// Display fallbacks must not replace the metadata title used to validate commands.
export function displayTitle(media: MediaItem | null | undefined): string {
  if (!media) return t("metadata.noMedia");
  return media.title?.trim() || media.page_title?.trim() || t("metadata.titleUnavailable");
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
    favicon_data_url: chrome.favicon_data_url,
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
      artwork_data_url:chrome.artwork_data_url?"chrome":"windows",app_icon_data_url:"windows",favicon_data_url:"chrome",timeline:"windows",playback_state:"windows",browser_media:"chrome"
    },
  };
}

export function chooseCurrent(windows: MediaSnapshot, chrome: MediaItem[], selected = "auto", previousSession?: string): MediaItem | null {
  // Chrome supplies the page title to Windows for videos without Media Session
  // metadata. Use that identity only for icons; sameTrack still guards enrichment.
  const sameIconPage = (win: MediaItem, page: MediaItem): boolean => {
    if (!/chrome/i.test(win.app_id ?? "")) return false;
    if (sameTrack(win,page)) return true;
    if (win.artist?.trim() || page.artist?.trim() || win.album?.trim() || page.album?.trim()) return false;
    const title=win.title?.trim().toLowerCase();
    if (!title) return false;
    if (page.title?.trim()) return title===page.title.trim().toLowerCase();
    return page.frame_id===0 && !!page.browser_media?.element_type && title===page.page_title?.trim().toLowerCase();
  };
  const windowsItems = windows.current && !windows.sessions.some(w=>w===windows.current || (!!w.session_id && w.session_id===windows.current?.session_id))
    ? [...windows.sessions,windows.current] : windows.sessions;
  const windowsWithIcon = (item: MediaItem): MediaItem => {
    const matches=chrome.filter(c=>sameTrack(item,c));
    const merged=mergedCurrent(item,matches.length===1?matches[0]!:null)!;
    if (merged!==item) return merged;
    const pages=chrome.filter(c=>sameIconPage(item,c));
    const page=pages.length===1?pages[0]:undefined;
    if (!page?.favicon_data_url || windowsItems.filter(w=>sameIconPage(w,page)).length!==1) return item;
    return {...item,favicon_data_url:page.favicon_data_url,field_sources:{...item.field_sources,favicon_data_url:"chrome"}};
  };
  const chromeWithIcon = (item: MediaItem): MediaItem => {
    const matches=windowsItems.filter(w=>sameIconPage(w,item));
    if(matches.length!==1 || chrome.filter(c=>sameIconPage(matches[0]!,c)).length!==1) return item;
    const windows=matches[0]!;
    // A reload can select Chrome before its Windows session reappears. Keep
    // that control target, but restore Windows artwork for an unambiguous track.
    const fallback=sameTrack(windows,item)?windows.artwork_data_url:undefined;
    return {...item,app_icon_data_url:windows.app_icon_data_url,
      ...(fallback?{fallback_artwork_data_url:fallback}:{}),
      field_sources:{...item.field_sources,app_icon_data_url:"windows",...(fallback?{fallback_artwork_data_url:"windows"}:{})}};
  };
  if (selected !== "auto") {
    const item = [...windows.sessions, ...chrome].find(x => x.session_id === selected);
    if (!item) return null; // Never silently operate another session after disconnection.
    if (item.source === "chrome") return chromeWithIcon(item);
    return windowsWithIcon(item);
  }
  const candidates = [
    ...(windows.current ? [windows.current] : []),
    ...windows.sessions.filter(item => !windows.current?.session_id || item.session_id !== windows.current.session_id),
    ...chrome
  ];
  const playing = candidates.filter(item => item.playback_state === "playing");
  const eligible = playing.length ? playing : candidates;
  // Heartbeats, timeline samples and OS current-session changes aren't user intent.
  // Retain the exact session while equally eligible, but always use its fresh data.
  const retained = previousSession ? eligible.find(item => item.session_id === previousSession) : undefined;
  // Prefer the OS current session for a new selection, then use update time only
  // to break ties at selection time, never to displace a retained session.
  const updated = (item: MediaItem) => item.source === "windows" ? item.timeline?.updated_at ?? 0 : item.observed_at ?? 0;
  const fallback = retained ?? (windows.current && eligible.includes(windows.current) ? windows.current : undefined)
    ?? eligible.sort((a,b) => updated(b) - updated(a))[0];
  if (!fallback) return null;
  if (fallback.source === "chrome") return chromeWithIcon(fallback);
  return windowsWithIcon(fallback);
}

/** Absolute media time. Provider samples stay intact; only the display/seek base is projected. */
export function playbackPosition(media: MediaItem | null, now = Date.now()): number | null {
  const t = media?.timeline;
  if (typeof t?.position_sec !== "number" || !Number.isFinite(t.position_sec)) return null;
  let position = t.position_sec;
  // GSMTC Position is current as of LastUpdatedTime, not the time we polled it.
  const updated = media?.source === "windows" ? t.updated_at : t.updated_at ?? media?.observed_at;
  const browser = media?.source === "chrome" ? media.browser_media : undefined;
  const advancing = media?.playback_state === "playing" && !browser?.ended && !browser?.seeking &&
    (browser?.ready_state === undefined || browser.ready_state >= 3);
  if (advancing && typeof updated === "number" && Number.isFinite(updated) && updated > 0) {
    const rate = media?.playback_rate ?? 1;
    if (Number.isFinite(rate)) position += Math.max(0, now - updated) / 1000 * rate;
  }
  const start = t.start_sec ?? 0;
  position = Math.max(start, position);
  if (typeof t.end_sec === "number" && t.end_sec > start) position = Math.min(t.end_sec, position);
  return position;
}

export function progress(media: MediaItem | null, now = Date.now()): { position: number | null; duration: number | null; percent: number | null } {
  const t = media?.timeline;
  const start = t?.start_sec ?? 0;
  const absolute = playbackPosition(media, now);
  const position = absolute === null ? null : absolute - start;
  const duration = typeof t?.end_sec === "number" && t.end_sec > start ? t.end_sec - start : null;
  return {position, duration, percent: position !== null && duration !== null ? Math.min(100, position / duration * 100) : null};
}
export function safeImage(data: unknown): string | undefined {
  if (typeof data !== "string" || data.length > 1_500_000) return undefined;
  if (!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(data)) return undefined;
  return data;
}
