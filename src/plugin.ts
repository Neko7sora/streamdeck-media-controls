import streamDeck,{action,SingletonAction,type KeyDownEvent,type DialDownEvent,type DialRotateEvent,type TouchTapEvent,type WillAppearEvent,type WillDisappearEvent,type DidReceiveSettingsEvent,type KeyAction,type DialAction} from "@elgato/streamdeck";
import {sendMediaKey,type MediaCommand} from "./windows-media.js";
import {startChromeServer,chromeCommand} from "./chrome-server.js";
import {startMediaPolling,subscribe,currentMedia,audioTarget,availableSessions,audioTargets} from "./media-state.js";
import {nativeCommand} from "./native-client.js";
import {artwork,applicationIcon} from "./artwork.js";
import {progress} from "./media-model.js";
import {DialSeeking,seekPosition,trackIdentity} from "./media-seek.js";
import {ScrollingText,ANIMATION_INTERVAL_MS} from "./scrolling-text.js";
import {nowPlayingImage} from "./now-playing-image.js";

const UUID="dev.local.media-controls";
const EMPTY_ICON="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";
type Settings={mediaTarget?:string;audioTarget?:string;globalKeys?:boolean;dialMode?:string;seekStep?:number};
type Instance=KeyAction<Settings>|DialAction<Settings>;
const short=(s:string,n=28)=>[...s].length>n?[...s].slice(0,n-1).join("")+"…":s;
const time=(s:number|null)=>s===null?"--:--":`${Math.floor(Math.max(0,s)/60)}:${String(Math.floor(Math.max(0,s))%60).padStart(2,"0")}`;
const playbackLabel=(state?:string)=>({playing:"Playing",paused:"Paused",stopped:"Stopped",opened:"Opened",changing:"Loading",closed:"Closed"}[state??""]??"Unavailable");
const seekStep=(s:Settings)=>typeof s.seekStep==="number"&&Number.isFinite(s.seekStep)&&s.seekStep>=1&&s.seekStep<=60?s.seekStep:5;
async function guarded(instance:Instance,fn:()=>Promise<void>):Promise<void> {
  try {await fn();} catch(e) {streamDeck.logger.warn(String(e));await instance.showAlert();}
}
async function volume(settings:Settings,ticks:number,mute=false):Promise<void> {
  await nativeCommand({command:mute?"mute":"volume",target:settings.audioTarget??"master",delta:Math.max(-32,Math.min(32,ticks))*0.02});
}
async function transport(settings:Settings,command:string,position?:number):Promise<void> {
  const media=currentMedia(settings.mediaTarget);
  if(!media) throw new Error("Selected media session unavailable");
  const supported=command==="play-pause" ? media.controls?.toggle||media.controls?.[media.playback_state==="playing"?"pause":"play"] : media.controls?.[command];
  if(!supported) throw new Error("Operation unavailable for the selected session");
  if(media.source==="windows"&&media.session_id) await nativeCommand({command,session_id:media.session_id,...(position!==undefined?{position}:{})});
  else if(media.source==="chrome"&&media.tab_id!==undefined&&media.frame_id!==undefined&&media.document_id) await chromeCommand(media.tab_id,media.frame_id,media.document_id,media.title??"",command,position);
  else throw new Error("Session cannot be targeted");
}
const visualActions:ConfiguredAction[]=[];
abstract class ConfiguredAction extends SingletonAction<Settings> {
  private readonly settings=new Map<string,Settings>();
  private readonly hashes=new Map<string,Map<string,string>>();
  protected readonly scrolling=new ScrollingText();
  private readonly displayedSessions=new Map<string,string>();
  private refreshing=false;
  private dirty=false;
  constructor(){super();visualActions.push(this);}
  override async onWillAppear(ev:WillAppearEvent<Settings>):Promise<void> {this.settings.set(ev.action.id,ev.payload.settings);this.refresh();}
  override onWillDisappear(ev:WillDisappearEvent<Settings>):void {this.settings.delete(ev.action.id);this.hashes.delete(ev.action.id);this.displayedSessions.delete(ev.action.id);this.scrolling.clear(ev.action.id);}
  override onDidReceiveSettings(ev:DidReceiveSettingsEvent<Settings>):void {this.settings.set(ev.action.id,ev.payload.settings);this.hashes.delete(ev.action.id);this.refresh();}
  protected async render(_instance:Instance,_settings:Settings):Promise<unknown> {return null;}
  protected displaySession(instance:Instance,session:string|undefined):void {this.displayedSessions.set(instance.id,session??"unavailable");}
  protected displayedSettings(instance:Instance,settings:Settings):Settings {return {...settings,mediaTarget:this.displayedSessions.get(instance.id)??"unavailable"};}
  protected async saveSettings(instance:Instance,settings:Settings):Promise<void> {await instance.setSettings(settings);this.settings.set(instance.id,settings);this.hashes.delete(instance.id);this.refresh();}
  protected changed(instance:Instance,payload:unknown,part="default"):boolean {
    let hashes=this.hashes.get(instance.id);
    if(!hashes) {hashes=new Map();this.hashes.set(instance.id,hashes);}
    const hash=JSON.stringify(payload)??"undefined";if(hashes.get(part)===hash) return false;
    hashes.set(part,hash);return true;
  }
  animate():void {if(this.scrolling.active) this.refresh();}
  refresh():void {
    this.dirty=true;if(this.refreshing) return;this.refreshing=true;
    void (async()=>{try {while(this.dirty) {
      this.dirty=false;
      for(const instance of this.actions) {
        if(!instance.isKey()&&!instance.isDial()) continue;
        try {await this.render(instance,this.settings.get(instance.id)??{});} catch(e) {this.hashes.delete(instance.id);streamDeck.logger.warn(`Display update: ${String(e)}`);}
      }
    }} finally {this.refreshing=false;}})();
  }
}
abstract class MediaButton extends ConfiguredAction {
  protected abstract readonly command:MediaCommand;
  override async onKeyDown(ev:KeyDownEvent<Settings>):Promise<void> {
    await guarded(ev.action,async()=>{
      if(ev.payload.settings.globalKeys) {await sendMediaKey(this.command);return;}
      if(this.command==="mute"||this.command.startsWith("volume-")) await volume(ev.payload.settings,this.command==="volume-down"?-1:1,this.command==="mute");
      else await transport(ev.payload.settings,this.command);
    });
  }
}
@action({UUID:`${UUID}.play-pause`}) class PlayPause extends MediaButton {protected readonly command="play-pause";}
@action({UUID:`${UUID}.previous`}) class Previous extends MediaButton {protected readonly command="previous";}
@action({UUID:`${UUID}.next`}) class Next extends MediaButton {protected readonly command="next";}
@action({UUID:`${UUID}.stop`}) class Stop extends MediaButton {protected readonly command="stop";}
@action({UUID:`${UUID}.mute`}) class Mute extends MediaButton {protected readonly command="mute";}
@action({UUID:`${UUID}.volume-up`}) class VolumeUp extends MediaButton {protected readonly command="volume-up";}
@action({UUID:`${UUID}.volume-down`}) class VolumeDown extends MediaButton {protected readonly command="volume-down";}

@action({UUID:`${UUID}.volume-dial`})
class VolumeDial extends ConfiguredAction {
  override async onDialRotate(ev:DialRotateEvent<Settings>):Promise<void> {if(ev.payload.ticks) await guarded(ev.action,()=>ev.payload.settings.globalKeys?sendMediaKey(ev.payload.ticks>0?"volume-up":"volume-down",Math.min(32,Math.abs(ev.payload.ticks))):volume(ev.payload.settings,ev.payload.ticks));}
  override async onDialDown(ev:DialDownEvent<Settings>):Promise<void> {await guarded(ev.action,()=>ev.payload.settings.globalKeys?sendMediaKey("mute"):volume(ev.payload.settings,0,true));}
  override async onTouchTap(ev:TouchTapEvent<Settings>):Promise<void> {await guarded(ev.action,()=>ev.payload.settings.globalKeys?sendMediaKey("mute"):volume(ev.payload.settings,0,true));}
  protected override async render(a:Instance,s:Settings):Promise<void> {
    if(!a.isDial()) return;
    const v=audioTarget(s.globalKeys?"master":s.audioTarget), value=v?.volume==null?"Unavailable":`${Math.round(v.volume*100)}%${v.muted?" Mute":""}`;
    const payload={title:short(v?.name||"System volume",22),value,indicator:{value:v?.volume==null?0:v.volume*100,enabled:v?.volume!=null},icon:"imgs/actions/volume-dial.png"};
    if(this.changed(a,payload)) await a.setFeedback(payload);
  }
}
@action({UUID:`${UUID}.now-playing`})
class NowPlaying extends ConfiguredAction {
  protected override async render(a:Instance,s:Settings):Promise<void> {
    if(!a.isKey()) return;
    const m=currentMedia(s.mediaTarget),image=(await artwork(m?.artwork_data_url))??await artwork(m?.fallback_artwork_data_url);
    const appIcon=await applicationIcon(m);
    const identity=m?trackIdentity(m):"unavailable";
    const [title,artist,status]=await Promise.all([
      this.scrolling.frame(a.id,"title",m?.title||(m?"Title unavailable":"No media"),{width:128,height:30,fontSize:24,scale:2},identity),
      this.scrolling.frame(a.id,"artist",m?.artist??"",{width:128,height:28,fontSize:22,scale:2},identity),
      this.scrolling.frame(a.id,"status",m?.playback_state==="playing"?"▶":m?.playback_state==="paused"?"Ⅱ":"?",{width:24,height:24,fontSize:18},identity)
    ]);
    if(this.changed(a,{image,appIcon,title:title.image,artist:artist.image,status:status.image},"image"))
      await a.setImage(await nowPlayingImage(image,title.image,artist.image,status.image,appIcon));
    if(this.changed(a,"","title")) await a.setTitle("");
    this.displaySession(a,m?.session_id);
  }
  override async onKeyDown(ev:KeyDownEvent<Settings>):Promise<void> {await guarded(ev.action,()=>transport(this.displayedSettings(ev.action,ev.payload.settings),"play-pause"));}
}
@action({UUID:`${UUID}.now-playing-dial`})
class NowPlayingDial extends ConfiguredAction {
  private readonly seeking=new DialSeeking();
  override onWillDisappear(ev:WillDisappearEvent<Settings>):void {this.seeking.clear(ev.action.id);super.onWillDisappear(ev);}
  override onDidReceiveSettings(ev:DidReceiveSettingsEvent<Settings>):void {this.seeking.clear(ev.action.id);super.onDidReceiveSettings(ev);}
  protected override async render(a:Instance,s:Settings):Promise<void> {
    if(!a.isDial()) return;
    const m=currentMedia(s.mediaTarget), p=progress(m), v=audioTarget(s.audioTarget);
    const identity=m?trackIdentity(m):"unavailable";
    const [title,artist]=await Promise.all([
      this.scrolling.frame(a.id,"title",m?.title||(m?"Title unavailable":"No media"),{width:188,height:22,fontSize:14},identity),
      this.scrolling.frame(a.id,"artist",m?.artist??"",{width:142,height:18,fontSize:12},identity)
    ]);
    const payload={
      trackTitle:title.image,artist:artist.image,
      status:playbackLabel(m?.playback_state),
      appIcon:(await applicationIcon(m,18))??EMPTY_ICON,
      position:`${time(p.position)} / ${time(p.duration)}`,
      indicator:{value:p.percent??0,enabled:p.percent!==null},
      volume:s.dialMode!=="volume"?`±${seekStep(s)}s`:v?.volume==null?"Vol --":`${v.muted?"Mute ":"Vol "}${Math.round(v.volume*100)}%`,
      artwork:(await artwork(m?.artwork_data_url,72))??(await artwork(m?.fallback_artwork_data_url,72))??"imgs/actions/play-pause.png"
    };
    const changes=Object.fromEntries(Object.entries(payload).filter(([key,value])=>this.changed(a,value,`feedback:${key}`)));
    if(Object.keys(changes).length) await a.setFeedback(changes);
    this.displaySession(a,m?.session_id);
  }
  override async onDialRotate(ev:DialRotateEvent<Settings>):Promise<void> {
    if(!ev.payload.ticks) return;
    await guarded(ev.action,async()=>{
      if(ev.payload.settings.dialMode==="volume") {await volume(ev.payload.settings,ev.payload.ticks);return;}
      const settings=this.displayedSettings(ev.action,ev.payload.settings),media=currentMedia(settings.mediaTarget);
      if(!media) throw new Error("Selected media session unavailable");
      const track=trackIdentity(media);
      await this.seeking.rotate(ev.action.id,media,ev.payload.ticks*seekStep(settings),async position=>{
        const latest=currentMedia(settings.mediaTarget);
        if(!latest||trackIdentity(latest)!==track) throw new Error("Media changed while seeking");
        await transport(settings,"seek",seekPosition(latest,position));
      });
    });
  }
  override async onDialDown(ev:DialDownEvent<Settings>):Promise<void> {await guarded(ev.action,()=>transport(this.displayedSettings(ev.action,ev.payload.settings),"play-pause"));}
  override async onTouchTap(ev:TouchTapEvent<Settings>):Promise<void> {
    await guarded(ev.action,async()=>{
      const settings=this.displayedSettings(ev.action,ev.payload.settings);
      const m=currentMedia(settings.mediaTarget), [x,y]=ev.payload.tapPos;
      if(ev.payload.hold) {
        const sessions=availableSessions(), index=sessions.findIndex(s=>s.session_id===m?.session_id);
        if(!sessions.length) throw new Error("No sessions");
        this.seeking.clear(ev.action.id);
        await this.saveSettings(ev.action,{...ev.payload.settings,mediaTarget:sessions[(index+1)%sessions.length]!.session_id});
        return;
      }
      if(y>=86) {
        if(!m?.controls?.seek) throw new Error("Seek unavailable");
        const t=m.timeline;
        if(t?.min_seek_sec==null||t.max_seek_sec==null||t.max_seek_sec<=t.min_seek_sec) throw new Error("Seek unavailable");
        this.seeking.clear(ev.action.id);
        await transport(settings,"seek",seekPosition(m,t.min_seek_sec+Math.max(0,Math.min(1,(x-6)/188))*(t.max_seek_sec-t.min_seek_sec)));
      } else await transport(settings,"play-pause");
    });
  }
}
for(const instance of [new PlayPause(),new Previous(),new Next(),new Stop(),new Mute(),new VolumeUp(),new VolumeDown(),new VolumeDial(),new NowPlaying(),new NowPlayingDial()]) streamDeck.actions.registerAction(instance);
subscribe(()=>{for(const a of visualActions) a.refresh();});
streamDeck.ui.onSendToPlugin(ev=>{
  const request=ev.payload;
  if(!request||typeof request!=="object"||Array.isArray(request)||request.request!=="options") return;
  const settingsRevision=request.settingsRevision;
  if(typeof settingsRevision!=="number"||!Number.isSafeInteger(settingsRevision)||settingsRevision<0) return;
  void (async()=>{const settings=await ev.action.getSettings();
    if(streamDeck.ui.action?.id!==ev.action.id) return;
    await streamDeck.ui.sendToPropertyInspector({
    settings,settingsRevision,
    sessions:availableSessions().map(s=>({id:s.session_id??"",label:`${s.source}: ${s.title||s.page_title||"Title unavailable"} (${s.app_id||s.tab_id||""})`,details:JSON.stringify({...s,artwork_data_url:s.artwork_data_url?"[image available]":null,fallback_artwork_data_url:s.fallback_artwork_data_url?"[Windows fallback available]":null,app_icon_data_url:s.app_icon_data_url?"[app icon available]":null,favicon_data_url:s.favicon_data_url?"[favicon available]":null},null,2)})),
    audio:audioTargets().map(v=>({id:v.id,label:`${v.name||"Unknown app"}${v.pid!==undefined?` (PID ${v.pid})`:""}`,volume:v.volume,muted:v.muted}))
  });})().catch(e=>streamDeck.logger.warn(String(e)));
});
const stop=startMediaPolling(msg=>streamDeck.logger.warn(msg));
const animation=setInterval(()=>{for(const a of visualActions) a.animate();},ANIMATION_INTERVAL_MS);
animation.unref();
let closeBridge=()=>{};
try {const server=startChromeServer(msg=>streamDeck.logger.info(msg));closeBridge=()=>{server.close();server.closeAllConnections();};}
catch(e) {streamDeck.logger.error(`Chrome bridge: ${String(e)}`);}
process.once("exit",()=>{clearInterval(animation);stop();});
for(const signal of ["SIGINT","SIGTERM"] as const) process.once(signal,()=>{clearInterval(animation);stop();closeBridge();process.exit(0);});
await streamDeck.connect();
