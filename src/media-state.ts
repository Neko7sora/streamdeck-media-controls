import {chooseCurrent, type MediaItem, type MediaSnapshot, type AudioTarget} from "./media-model.js";
import {validateMedia} from "./media-validation.js";
import {startNative} from "./native-client.js";

let windows:MediaSnapshot={current:null,sessions:[]};
let autoSession:string|undefined;
const chrome=new Map<string,{item:MediaItem;lastSeen:number;sequence:number}>();
const listeners=new Set<()=>void>();
export const CHROME_TTL=15000;
export function chromeSessions(now=Date.now()):MediaItem[] {
  for(const [id,v] of chrome) if(now-v.lastSeen>=CHROME_TTL) chrome.delete(id);
  return [...chrome.values()].map(v=>v.item);
}
export function currentMedia(selected="auto"):MediaItem|null {
  const media=chooseCurrent(windows,chromeSessions(),selected,autoSession);
  if(selected==="auto") autoSession=media?.session_id;
  return media;
}
export function availableSessions():MediaItem[] {return [...windows.sessions,...chromeSessions()];}
export function audioTarget(id="master"):AudioTarget|null {
  return id==="master" ? windows.audio?.master ?? null : windows.audio?.sessions.find(x=>x.id===id) ?? null;
}
export function audioTargets():AudioTarget[] {return [...(windows.audio?.master ? [windows.audio.master] : []),...(windows.audio?.sessions ?? [])];}
export function subscribe(fn:()=>void):()=>void {listeners.add(fn);return ()=>{listeners.delete(fn);};}
export function publish():void {for(const fn of listeners) fn();}
export function ingestChrome(tabId:number,frameId:number,data:unknown,sequence=0,documentId=""):boolean {
  if(!Number.isSafeInteger(tabId)||tabId<0||!Number.isSafeInteger(frameId)||frameId<0) return false;
  const id=`chrome:${tabId}:${frameId}`;
  const previous=chrome.get(id);
  if(previous && sequence<previous.sequence) return true;
  if(data===null) {chrome.delete(id);publish();return true;}
  const item=validateMedia(data,"chrome");
  if(!item) return false;
  if(!item.title?.trim() && !item.browser_media?.element_type && !item.artist) {chrome.delete(id);publish();return true;}
  if(!previous && chrome.size>=256) chrome.delete(chrome.keys().next().value!);
  item.session_id=documentId?`${id}:${documentId}`:id;item.document_id=documentId;item.tab_id=tabId;item.frame_id=frameId;item.observed_at=Date.now();
  chrome.set(id,{item,lastSeen:Date.now(),sequence});publish();return true;
}
export function startMediaPolling(onError:(s:string)=>void):()=>void {
  const stop=startNative(s=>{windows=s;publish();},onError);
  const interval=setInterval(()=>{chromeSessions();publish();},250);
  return ()=>{clearInterval(interval);stop();};
}
