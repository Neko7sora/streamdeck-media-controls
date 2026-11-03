import streamDeck from "@elgato/streamdeck";
import type {Instance,Settings} from "./action-settings.js";
import {currentMedia} from "./media-state.js";
import {nativeCommand} from "./native-client.js";
import {chromeCommand} from "./chrome-server.js";

export async function guarded(instance:Instance,fn:()=>Promise<void>):Promise<void> {
  try {await fn();} catch(e) {streamDeck.logger.warn(String(e));await instance.showAlert();}
}
export async function volume(settings:Settings,ticks:number,mute=false):Promise<void> {
  await nativeCommand({command:mute?"mute":"volume",target:settings.audioTarget??"master",delta:Math.max(-32,Math.min(32,ticks))*0.02});
}
export async function transport(settings:Settings,command:string,position?:number):Promise<void> {
  const media=currentMedia(settings.mediaTarget);
  if(!media) throw new Error("Selected media session unavailable");
  const supported=command==="play-pause" ? media.controls?.toggle||media.controls?.[media.playback_state==="playing"?"pause":"play"] : media.controls?.[command];
  if(!supported) throw new Error("Operation unavailable for the selected session");
  if(media.source==="windows"&&media.session_id) await nativeCommand({command,session_id:media.session_id,...(position!==undefined?{position}:{})});
  else if(media.source==="chrome"&&media.tab_id!==undefined&&media.frame_id!==undefined&&media.document_id) await chromeCommand(media.tab_id,media.frame_id,media.document_id,media.title??"",command,position,media.browser_media?.target_id,media.client_id);
  else throw new Error("Session cannot be targeted");
}
