import {t} from "./localization.js";
import {action,type KeyDownEvent,type DialDownEvent,type DialRotateEvent,type TouchTapEvent} from "@elgato/streamdeck";
import {UUID,type Settings,type Instance} from "./action-settings.js";
import {ConfiguredAction} from "./configured-action.js";
import {guarded,volume,transport} from "./media-commands.js";
import {currentMedia,audioTarget} from "./media-state.js";
import {displayTitle} from "./media-model.js";
import type {WillDisappearEvent,DidReceiveSettingsEvent} from "@elgato/streamdeck";
import {availableSessions} from "./media-state.js";
import {progress} from "./media-model.js";
import {artwork,applicationIcon,artworkLoadingImage} from "./artwork.js";
import {DialSeeking,seekPosition,trackIdentity} from "./media-seek.js";
import {nowPlayingImage} from "./now-playing-image.js";
import {isSeekTouch} from "./display-guidelines.js";

const EMPTY_ICON="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";
const time=(s:number|null)=>s===null?"--:--":`${Math.floor(Math.max(0,s)/60)}:${String(Math.floor(Math.max(0,s))%60).padStart(2,"0")}`;
const playbackLabel=(state?:string)=>({playing:t("playback.playing"),paused:t("playback.paused"),stopped:t("playback.stopped"),opened:t("playback.opened"),changing:t("playback.loading"),closed:t("playback.closed")}[state??""]??t("playback.unavailable"));
const seekStep=(s:Settings)=>typeof s.seekStep==="number"&&Number.isFinite(s.seekStep)&&s.seekStep>=1&&s.seekStep<=60?s.seekStep:5;
@action({UUID:`${UUID}.now-playing`})
export class NowPlaying extends ConfiguredAction {
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
export class NowPlayingDial extends ConfiguredAction {
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
