import {t,setLanguage} from "./localization.js";
import streamDeck,{action,SingletonAction,type KeyDownEvent,type DialDownEvent,type DialRotateEvent,type TouchTapEvent,type WillAppearEvent,type WillDisappearEvent,type DidReceiveSettingsEvent,type KeyAction,type DialAction} from "@elgato/streamdeck";
import {sendMediaKey,type MediaCommand} from "./windows-media.js";
import {startChromeServer,chromeCommand,chromeConnectionStatus} from "./chrome-server.js";
import {registerChromeHost,stopChromeRegistration} from "./chrome-registration.js";
import {startMediaPolling,subscribe,subscribeChanges,currentMedia,audioTarget,availableSessions,audioTargets} from "./media-state.js";
import {nativeCommand} from "./native-client.js";
import {artwork,applicationIcon,artworkLoadingImage} from "./artwork.js";
import {progress,displayTitle} from "./media-model.js";
import {DialSeeking,seekPosition,trackIdentity} from "./media-seek.js";
import {ScrollingText,ANIMATION_INTERVAL_MS} from "./scrolling-text.js";
import {nowPlayingImage} from "./now-playing-image.js";
import {controlImage} from "./control-image.js";
import {mediaTargetName,audioTargetName} from "./control-display.js";
import {InspectorUpdates} from "./inspector-updates.js";
import {DISPLAY_UPDATE_INTERVAL_MS,isSeekTouch} from "./display-guidelines.js";

setLanguage(streamDeck.info.application.language);
const UUID="dev.n7s.media-controls";
const EMPTY_ICON="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";
type Settings={mediaTarget?:string;audioTarget?:string;globalKeys?:boolean;dialMode?:string;seekStep?:number;scrollText?:boolean;
  showTitle?:boolean;showArtist?:boolean;showArtwork?:boolean;showAppIcon?:boolean;showStatus?:boolean;
  showPosition?:boolean;showDuration?:boolean;showProgress?:boolean;showDialInfo?:boolean;
  showControlIcon?:boolean;showTarget?:boolean;showScope?:boolean;showVolume?:boolean;showVolumeBar?:boolean};
type Instance=KeyAction<Settings>|DialAction<Settings>;
const time=(s:number|null)=>s===null?"--:--":`${Math.floor(Math.max(0,s)/60)}:${String(Math.floor(Math.max(0,s))%60).padStart(2,"0")}`;
const playbackLabel=(state?:string)=>({playing:t("playback.playing"),paused:t("playback.paused"),stopped:t("playback.stopped"),opened:t("playback.opened"),changing:t("playback.loading"),closed:t("playback.closed")}[state??""]??t("playback.unavailable"));
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
  else if(media.source==="chrome"&&media.tab_id!==undefined&&media.frame_id!==undefined&&media.document_id) await chromeCommand(media.tab_id,media.frame_id,media.document_id,media.title??"",command,position,media.browser_media?.target_id,media.client_id);
  else throw new Error("Session cannot be targeted");
}
const visualActions:ConfiguredAction[]=[];
abstract class ConfiguredAction extends SingletonAction<Settings> {
  private readonly settings=new Map<string,Settings>();
  // A reused action ID must not accept asynchronous work from its previous appearance.
  private readonly appearances=new Map<string,symbol>();
  private readonly hashes=new Map<string,Map<string,string>>();
  private readonly renderedAt=new Map<string,number>();
  protected readonly scrolling=new ScrollingText();
  private readonly displayedSessions=new Map<string,string>();
  private refreshing=false;
  private dirty=false;
  constructor(){super();visualActions.push(this);}
  override async onWillAppear(ev:WillAppearEvent<Settings>):Promise<void> {this.appearances.set(ev.action.id,Symbol());this.settings.set(ev.action.id,ev.payload.settings);this.hashes.delete(ev.action.id);this.displayedSessions.delete(ev.action.id);this.scrolling.clear(ev.action.id);this.refresh();}
  override onWillDisappear(ev:WillDisappearEvent<Settings>):void {this.appearances.delete(ev.action.id);this.settings.delete(ev.action.id);this.hashes.delete(ev.action.id);this.renderedAt.delete(ev.action.id);this.displayedSessions.delete(ev.action.id);this.scrolling.clear(ev.action.id);}
  override onDidReceiveSettings(ev:DidReceiveSettingsEvent<Settings>):void {this.settings.set(ev.action.id,ev.payload.settings);this.hashes.delete(ev.action.id);this.refresh();}
  protected async render(_instance:Instance,_settings:Settings,_isCurrent:()=>boolean=()=>true):Promise<unknown> {return null;}
  protected displaySession(instance:Instance,session:string|undefined):void {this.displayedSessions.set(instance.id,session??"unavailable");}
  protected displayedSettings(instance:Instance,settings:Settings):Settings {return {...settings,mediaTarget:this.displayedSessions.get(instance.id)??"unavailable"};}
  protected async saveSettings(instance:Instance,settings:Settings):Promise<void> {await instance.setSettings(settings);this.settings.set(instance.id,settings);this.hashes.delete(instance.id);this.refresh();if(inspectorId===instance.id&&streamDeck.ui.action?.id===instance.id) await streamDeck.ui.sendToPropertyInspector({response:"settingsChanged",settings,settingsRevision:inspectorRevision});}
  protected changed(instance:Instance,payload:unknown,part="default"):boolean {
    let hashes=this.hashes.get(instance.id);
    if(!hashes) {hashes=new Map();this.hashes.set(instance.id,hashes);}
    const hash=JSON.stringify(payload)??"undefined";if(hashes.get(part)===hash) return false;
    hashes.set(part,hash);return true;
  }
  animate():void {if(this.scrolling.active&&!this.refreshing) this.refresh();}
  refresh():void {
    this.dirty=true;if(this.refreshing) return;this.refreshing=true;
    void (async()=>{try {while(this.dirty) {
      this.dirty=false;
      for(const instance of this.actions) {
        if(!instance.isKey()&&!instance.isDial()) continue;
        const appearance=this.appearances.get(instance.id);
        if(!appearance) continue;
        // State events and settings changes share the animation budget. Keep the
        // latest settings while waiting, and recheck visibility before rendering.
        const previous=this.renderedAt.get(instance.id);
        if(previous!==undefined) {
          let delay=previous+DISPLAY_UPDATE_INTERVAL_MS-performance.now();
          while(delay>0) {
            await new Promise(resolve=>setTimeout(resolve,Math.ceil(delay)));
            delay=previous+DISPLAY_UPDATE_INTERVAL_MS-performance.now();
          }
        }
        if(this.appearances.get(instance.id)!==appearance) continue;
        const settings=this.settings.get(instance.id);
        try {await this.render(instance,settings??{},()=>this.appearances.get(instance.id)===appearance&&this.settings.get(instance.id)===settings);} catch(e) {this.hashes.delete(instance.id);streamDeck.logger.warn(`Display update: ${String(e)}`);}
        if(this.appearances.get(instance.id)===appearance) this.renderedAt.set(instance.id,performance.now());
      }
    }} finally {this.refreshing=false;}})();
  }
}
abstract class MediaButton extends ConfiguredAction {
  protected abstract readonly command:MediaCommand;
  protected override async render(a:Instance,s:Settings,isCurrent:()=>boolean=()=>true):Promise<void> {
    if(!a.isKey()) return;
    const isVolume=this.command==="mute"||this.command.startsWith("volume-");
    const m=isVolume||s.globalKeys?null:currentMedia(s.mediaTarget);
    const selected=s.globalKeys?"master":s.audioTarget??"master";
    const v=isVolume?audioTarget(selected):null;
    const target=s.showTarget===false?"":isVolume?audioTargetName(v,selected):s.globalKeys?t("os.auto"):mediaTargetName(m);
    const detail=isVolume?[
      s.showVolume===false?"":v?.volume==null?"--%":`${Math.round(v.volume*100)}%`,
      s.showStatus===false?"":v?.volume==null?t("no.target"):v.muted?t("muted"):""
    ].filter(Boolean).join(" · "):s.showTitle===false?"":s.globalKeys?t("target.selected.by.os"):
      m?displayTitle(m):s.mediaTarget&&s.mediaTarget!=="auto"?t("disconnected"):t("no.media");
    const identity=isVolume?selected:s.globalKeys?"global":m?.session_id??"unavailable";
    const [name,line,appIcon]=await Promise.all([
      this.scrolling.frame(a.id,"target",target,{width:128,height:28,fontSize:22,scale:2,scroll:s.scrollText},identity),
      this.scrolling.frame(a.id,"detail",detail,{width:128,height:22,fontSize:18,scale:2,scroll:s.scrollText},identity),
      s.showAppIcon===false?undefined:applicationIcon(m,28)
    ]);
    if(!isCurrent()) return;
    const playing=this.command==="play-pause"&&m?.playback_state==="playing";
    if(this.changed(a,{target:name.image,detail:line.image,appIcon,showControlIcon:s.showControlIcon!==false,playing},"image")) {
      const image=await controlImage(this.command,name.image,line.image,appIcon,s.showControlIcon!==false,playing);
      if(!isCurrent()) return;
      await a.setImage(image);
    }
    if(!isCurrent()) return;
    if(this.changed(a,"","title")) await a.setTitle("");
    if(isCurrent()&&!isVolume&&!s.globalKeys) this.displaySession(a,m?.session_id);
  }
  override async onKeyDown(ev:KeyDownEvent<Settings>):Promise<void> {
    await guarded(ev.action,async()=>{
      if(ev.payload.settings.globalKeys) {await sendMediaKey(this.command);return;}
      if(this.command==="mute"||this.command.startsWith("volume-")) await volume(ev.payload.settings,this.command==="volume-down"?-1:1,this.command==="mute");
      else await transport(this.displayedSettings(ev.action,ev.payload.settings),this.command);
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
  protected override async render(a:Instance,s:Settings,isCurrent:()=>boolean=()=>true):Promise<void> {
    if(!a.isDial()) return;
    const selected=s.globalKeys?"master":s.audioTarget??"master",v=audioTarget(selected);
    const [scope,targetName,status]=await Promise.all([
      this.scrolling.frame(a.id,"scope",s.showScope===false?"":selected==="master"?t("system.volume"):t("app.volume"),{width:184,height:16,fontSize:11,scroll:s.scrollText}),
      this.scrolling.frame(a.id,"target",s.showTarget===false?"":audioTargetName(v,selected),{width:184,height:28,fontSize:20,bold:true,scroll:s.scrollText},selected),
      this.scrolling.frame(a.id,"status",s.showStatus===false?"":v?.volume==null?(selected==="master"?t("unavailable"):t("disconnected")):v.muted?t("volume.muted"):t("press.to.mute"),{width:110,height:20,fontSize:12,scroll:s.scrollText},selected)
    ]);
    if(!isCurrent()) return;
    // Replace the old built-in layout for already-configured dial instances, too.
    if(this.changed(a,"layouts/volume-dial.json","layout")) await a.setFeedbackLayout("layouts/volume-dial.json");
    if(!isCurrent()) return;
    const payload={scope:scope.image,targetName:targetName.image,status:status.image,
      value:s.showVolume===false?"":v?.volume==null?"--%":`${Math.round(v.volume*100)}%`,
      indicator:{value:v?.volume==null?0:v.volume*100,enabled:s.showVolumeBar!==false&&v?.volume!=null,bar_fill_c:v?.muted?"#ffc46b":"#55ce91"}};
    const changes=Object.fromEntries(Object.entries(payload).filter(([key,value])=>this.changed(a,value,`feedback:${key}`)));
    if(Object.keys(changes).length) await a.setFeedback(changes);
  }
}
@action({UUID:`${UUID}.now-playing`})
class NowPlaying extends ConfiguredAction {
  protected override async render(a:Instance,s:Settings,isCurrent:()=>boolean=()=>true):Promise<void> {
    if(!a.isKey()) return;
    const m=currentMedia(s.mediaTarget),image=s.showArtwork===false?undefined:(await artwork(m?.artwork_data_url))??await artwork(m?.fallback_artwork_data_url)??(m?.artwork_loading?await artworkLoadingImage(t("artwork.loading")):undefined);
    const appIcon=s.showAppIcon===false?undefined:await applicationIcon(m);
    if(!isCurrent()) return;
    const identity=m?trackIdentity(m):"unavailable";
    const [title,artist,status]=await Promise.all([
      this.scrolling.frame(a.id,"title",s.showTitle===false?"":displayTitle(m),{width:128,height:30,fontSize:24,scale:2,scroll:s.scrollText},identity),
      this.scrolling.frame(a.id,"artist",s.showArtist===false?"":m?.artist??"",{width:128,height:28,fontSize:22,scale:2,scroll:s.scrollText},identity),
      this.scrolling.frame(a.id,"status",s.showStatus===false?"":m?.playback_state==="playing"?"▶":m?.playback_state==="paused"?"Ⅱ":"?",{width:24,height:24,fontSize:18,scroll:s.scrollText,align:"center"},identity)
    ]);
    if(!isCurrent()) return;
    const titleImage=s.showTitle===false?undefined:title.image,artistImage=s.showArtist===false?undefined:artist.image,statusImage=s.showStatus===false?undefined:status.image;
    if(this.changed(a,{image,appIcon,title:titleImage,artist:artistImage,status:statusImage},"image")) {
      const rendered=await nowPlayingImage(image,titleImage,artistImage,statusImage,appIcon);
      if(!isCurrent()) return;
      await a.setImage(rendered);
    }
    if(!isCurrent()) return;
    if(this.changed(a,"","title")) await a.setTitle("");
    if(isCurrent()) this.displaySession(a,m?.session_id);
  }
  override async onKeyDown(ev:KeyDownEvent<Settings>):Promise<void> {await guarded(ev.action,()=>transport(this.displayedSettings(ev.action,ev.payload.settings),"play-pause"));}
}
@action({UUID:`${UUID}.now-playing-dial`})
class NowPlayingDial extends ConfiguredAction {
  private readonly seeking=new DialSeeking();
  private async sendSeek(settings:Settings,track:string,position:number):Promise<void> {
    const latest=currentMedia(settings.mediaTarget);
    if(!latest||trackIdentity(latest)!==track) throw new Error("Media changed while seeking");
    await transport(settings,"seek",seekPosition(latest,position));
  }
  override onWillDisappear(ev:WillDisappearEvent<Settings>):void {this.seeking.clear(ev.action.id);super.onWillDisappear(ev);}
  override onDidReceiveSettings(ev:DidReceiveSettingsEvent<Settings>):void {this.seeking.clear(ev.action.id);super.onDidReceiveSettings(ev);}
  protected override async render(a:Instance,s:Settings,isCurrent:()=>boolean=()=>true):Promise<void> {
    if(!a.isDial()) return;
    const m=currentMedia(s.mediaTarget), p=progress(m), v=audioTarget(s.audioTarget);
    const identity=m?trackIdentity(m):"unavailable";
    const [title,artist]=await Promise.all([
      this.scrolling.frame(a.id,"title",s.showTitle===false?"":displayTitle(m),{width:188,height:22,fontSize:14,scroll:s.scrollText},identity),
      this.scrolling.frame(a.id,"artist",s.showArtist===false?"":m?.artist??"",{width:142,height:18,fontSize:12,scroll:s.scrollText},identity)
    ]);
    const payload={
      trackTitle:title.image,artist:artist.image,
      status:s.showStatus===false?"":playbackLabel(m?.playback_state),
      appIcon:s.showAppIcon===false?EMPTY_ICON:(await applicationIcon(m,18))??EMPTY_ICON,
      position:[...(s.showPosition===false?[]:[time(p.position)]),...(s.showDuration===false?[]:[time(p.duration)])].join(" / "),
      indicator:{value:p.percent??0,enabled:s.showProgress!==false&&p.percent!==null},
      volume:s.showDialInfo===false?"":s.dialMode!=="volume"?t("dial.seekStep",{seconds:seekStep(s)}):v?.volume==null?t("dial.volumeUnavailable"):t(v.muted?"dial.muted":"dial.volume",{volume:Math.round(v.volume*100)}),
      artwork:s.showArtwork===false?EMPTY_ICON:(await artwork(m?.artwork_data_url,72))??(await artwork(m?.fallback_artwork_data_url,72))??(m?.artwork_loading?await artworkLoadingImage(t("artwork.loading"),72):"imgs/actions/play-pause.png")
    };
    if(!isCurrent()) return;
    const changes=Object.fromEntries(Object.entries(payload).filter(([key,value])=>this.changed(a,value,`feedback:${key}`)));
    if(Object.keys(changes).length) await a.setFeedback(changes);
    if(isCurrent()) this.displaySession(a,m?.session_id);
  }
  override async onDialRotate(ev:DialRotateEvent<Settings>):Promise<void> {
    if(!ev.payload.ticks) return;
    await guarded(ev.action,async()=>{
      if(ev.payload.settings.dialMode==="volume") {await volume(ev.payload.settings,ev.payload.ticks);return;}
      const settings=this.displayedSettings(ev.action,ev.payload.settings),media=currentMedia(settings.mediaTarget);
      if(!media) throw new Error("Selected media session unavailable");
      const track=trackIdentity(media);
      await this.seeking.rotate(ev.action.id,media,ev.payload.ticks*seekStep(settings),position=>this.sendSeek(settings,track,position));
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
      if(isSeekTouch(x,y)&&settings.showProgress!==false) {
        if(!m?.controls?.seek) throw new Error("Seek unavailable");
        const p=progress(m);
        if(p.duration===null) throw new Error("Seek unavailable");
        // Match the displayed progress coordinates before clamping to seekable ranges.
        const track=trackIdentity(m),position=(m.timeline?.start_sec??0)+Math.max(0,Math.min(1,(x-6)/188))*p.duration;
        await this.seeking.seekTo(ev.action.id,m,position,value=>this.sendSeek(settings,track,value));
      } else await transport(settings,"play-pause");
    });
  }
}
for(const instance of [new PlayPause(),new Previous(),new Next(),new Stop(),new Mute(),new VolumeUp(),new VolumeDown(),new VolumeDial(),new NowPlaying(),new NowPlayingDial()]) streamDeck.actions.registerAction(instance);
const inspectorUpdates=new InspectorUpdates();
let inspectorId:string|undefined,inspectorRevision=0,inspectorSending=false,inspectorDirty=false;
function inspectorPayload() {
  return {
    chromeConnection:chromeConnectionStatus(),
    sessions:availableSessions().map(s=>({id:s.session_id??"",label:`${s.source}: ${displayTitle(s)} (${s.app_id||s.tab_id||""})`,details:JSON.stringify({...s,artwork_data_url:s.artwork_data_url?"[image available]":null,fallback_artwork_data_url:s.fallback_artwork_data_url?"[Windows fallback available]":null,app_icon_data_url:s.app_icon_data_url?"[app icon available]":null,favicon_data_url:s.favicon_data_url?"[favicon available]":null},null,2)})),
    audio:audioTargets().map(v=>({id:v.id,label:`${v.name||t("metadata.unknownApp")}${v.pid!==undefined?` (PID ${v.pid})`:""}`,volume:v.volume,muted:v.muted}))
  };
}
function notifyInspector():void {
  if(!inspectorId||streamDeck.ui.action?.id!==inspectorId) {inspectorId=undefined;inspectorUpdates.reset();return;}
  inspectorDirty=true;if(inspectorSending) return;inspectorSending=true;
  void (async()=>{try {while(inspectorDirty) {
    inspectorDirty=false;const id=inspectorId;
    if(!id||streamDeck.ui.action?.id!==id) break;
    const changes=inspectorUpdates.changes(inspectorPayload());
    if(Object.keys(changes).length) await streamDeck.ui.sendToPropertyInspector({response:"optionsChanged",protocol:2,...changes});
  }} catch(e){inspectorUpdates.reset();streamDeck.logger.warn(String(e));} finally{inspectorSending=false;}})();
}
let inspectorConnection="";
subscribe(()=>{
  for(const a of visualActions) a.refresh();
  if(inspectorId) {
    const connection=chromeConnectionStatus(),key=JSON.stringify([connection.state,connection.sessions]);
    if(key!==inspectorConnection) {inspectorConnection=key;notifyInspector();}
  }
});
subscribeChanges(notifyInspector);
streamDeck.ui.onSendToPlugin(ev=>{
  const request=ev.payload;
  if(!request||typeof request!=="object"||Array.isArray(request)) return;
  if(request.request==="alive"||request.request==="watch") {
    if(streamDeck.ui.action?.id!==ev.action.id) return;
    if(request.request==="watch"&&Number.isSafeInteger(request.settingsRevision)&&Number(request.settingsRevision)>=0) inspectorRevision=Number(request.settingsRevision);
    // An open inspector can outlive this plugin process and retain push mode.
    // Restore its full handshake before relying on collection change notices.
    void streamDeck.ui.sendToPropertyInspector({response:"alive",protocol:2,chromeConnection:chromeConnectionStatus(),
      ...(inspectorId!==ev.action.id?{optionsRequired:true}:{})}).catch(e=>streamDeck.logger.warn(String(e)));return;
  }
  if(request.request==="registerChromeHost") {
    const requestId=request.requestId;
    if(streamDeck.ui.action?.id!==ev.action.id||typeof requestId!=="string"||!/^[a-f0-9-]{36}$/i.test(requestId)) return;
    void registerChromeHost(msg=>streamDeck.logger.warn(msg)).then(async result=>{
      if(streamDeck.ui.action?.id!==ev.action.id) return;
      await streamDeck.ui.sendToPropertyInspector({response:"chromeHostRegistration",requestId,...result});
    }).catch(e=>streamDeck.logger.warn(String(e)));
    return;
  }
  if(request.request!=="options") return;
  const settingsRevision=request.settingsRevision;
  if(typeof settingsRevision!=="number"||!Number.isSafeInteger(settingsRevision)||settingsRevision<0) return;
  void (async()=>{const settings=await ev.action.getSettings();
    if(streamDeck.ui.action?.id!==ev.action.id) return;
    const payload=inspectorPayload();inspectorId=ev.action.id;inspectorRevision=settingsRevision;inspectorUpdates.reset();inspectorUpdates.changes(payload);
    await streamDeck.ui.sendToPropertyInspector({protocol:2,settings,settingsRevision,...payload});
  })().catch(e=>streamDeck.logger.warn(String(e)));
});
const stop=startMediaPolling(msg=>streamDeck.logger.warn(msg));
const animation=setInterval(()=>{for(const a of visualActions) a.animate();},ANIMATION_INTERVAL_MS);
animation.unref();
let closeBridge=()=>{};
try {const server=startChromeServer(msg=>streamDeck.logger.info(msg));closeBridge=()=>{server.close();server.closeAllConnections();};}
catch(e) {streamDeck.logger.error(`Chrome bridge: ${String(e)}`);}
process.once("exit",()=>{clearInterval(animation);stop();stopChromeRegistration();});
for(const signal of ["SIGINT","SIGTERM"] as const) process.once(signal,()=>{clearInterval(animation);stop();stopChromeRegistration();closeBridge();process.exit(0);});
await streamDeck.connect();
