import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { safeImage, type MediaItem, type MediaSnapshot, mergedCurrent } from "./media-model.js";

const infoExe = fileURLToPath(new URL("../native/media-info.exe", import.meta.url));
const empty: MediaSnapshot = {current: null, sessions: []};
let windowsState: MediaSnapshot = empty;
const chromeTabs = new Map<number, {item: MediaItem; lastSeen: number}>();
const subscribers = new Set<(item: MediaItem | null)=>void>();
let active = false;
let polling = false;
let lastHash = "";

function latestChrome(): MediaItem | null {
  const now = Date.now();
  const valid = [...chromeTabs.values()].filter(t => now - t.lastSeen < 7000);
  valid.sort((a,b)=>{
    const playing = (x: MediaItem) => x.playback_state === "playing" ? 1 : 0;
    return playing(b.item)-playing(a.item) || b.lastSeen-a.lastSeen;
  });
  return valid[0]?.item ?? null;
}
export function currentMedia(): MediaItem | null {
  return mergedCurrent(windowsState.current, latestChrome());
}
function publish(): void {
  const item = currentMedia();
  const hash = JSON.stringify(item);
  if (hash === lastHash) return;
  lastHash = hash;
  for (const fn of subscribers) fn(item);
}
export function subscribe(fn: (item: MediaItem | null) => void): () => void {
  subscribers.add(fn);
  fn(currentMedia());
  return () => {subscribers.delete(fn);};
}
export function ingestChrome(tabId: number, data: unknown): void {
  if (!Number.isSafeInteger(tabId) || tabId < 0 || !data || typeof data !== "object") return;
  const body = data as Record<string, unknown>;
  if (typeof body.title !== "string" || body.title.length > 500 || !body.title.trim()) {
    chromeTabs.delete(tabId); publish(); return;
  }
  const short = (field: string, limit = 500): string =>
    typeof body[field] === "string" ? (body[field] as string).slice(0,limit) : "";
  const finite = (x:unknown): number | undefined => typeof x === "number" && Number.isFinite(x) ? x : undefined;
  const timeline = body.timeline && typeof body.timeline === "object" ? body.timeline as Record<string, unknown> : {};
  const candidates = Array.isArray(body.artwork_candidates) ? body.artwork_candidates.slice(0,12).filter(
    (x): x is {src:string;sizes?:string;type?:string} => !!x && typeof x === "object" && typeof x.src === "string" && x.src.length < 2048
  ) : [];
  chromeTabs.set(tabId, {lastSeen: Date.now(), item:{
    source:"chrome", tab_id:tabId, app_id:"chrome", title:short("title"),
    artist:short("artist"), album:short("album"), page_url:short("page_url",2048),
    page_title:short("page_title"), artwork_data_url:safeImage(body.artwork_data_url),
    artwork_candidates:candidates,
    browser_media:body.browser_media && typeof body.browser_media === "object" ? body.browser_media as MediaItem["browser_media"] : undefined,
    playback_state:short("playback_state",30),
    playback_rate:finite(body.playback_rate),
    timeline:{position_sec:finite(timeline.position_sec), end_sec:finite(timeline.end_sec)}
  }});
  publish();
}
function readWindows(): Promise<MediaSnapshot> {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") {resolve(empty);return;}
    execFile(infoExe, [], {windowsHide: true,timeout:6000,maxBuffer:8_000_000}, (error, stdout,stderr) => {
      if(error) {reject(new Error(stderr.trim() || error.message));return;}
      try {
        const v = JSON.parse(stdout) as MediaSnapshot;
        if(!v || !Array.isArray(v.sessions)) throw new Error("Invalid GSMTC JSON");
        for (const item of [...v.sessions, v.current]) {
          if(item && typeof item === "object") item.artwork_data_url = safeImage(item.artwork_data_url);
        }
        resolve(v);
      } catch(e) {reject(e);}
    });
  });
}
export function startMediaPolling(onError:(message:string)=>void): void {
  if(active) return;
  active = true;
  // Polling is used instead of a persistent WinRT process; future versions can subscribe to GSMTC events.
  const tick = async () => {
    if(!polling) {
      polling=true;
      try {windowsState=await readWindows(); publish();}
      catch(e) {onError(String(e));}
      finally {polling=false;}
    }
    if(active) setTimeout(tick, 2500).unref();
  };
  void tick();
}
