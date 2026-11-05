import {t} from "./localization.js";
import {action,type KeyDownEvent,type DialDownEvent,type DialRotateEvent,type TouchTapEvent} from "@elgato/streamdeck";
import {UUID,type Settings,type Instance} from "./action-settings.js";
import {ConfiguredAction} from "./configured-action.js";
import {guarded,volume,transport} from "./media-commands.js";
import {currentMedia,audioTarget} from "./media-state.js";
import {displayTitle} from "./media-model.js";
import {sendMediaKey,type MediaCommand} from "./windows-media.js";
import {applicationIcon} from "./artwork.js";
import {controlImage} from "./control-image.js";
import {mediaTargetName,audioTargetName} from "./control-display.js";

abstract class MediaButton extends ConfiguredAction {
  protected abstract readonly command:MediaCommand;
  protected override async render(a:Instance,s:Settings,isCurrent:()=>boolean=()=>true,isVisible:()=>boolean=isCurrent):Promise<void> {
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
    if(!isVisible()) return;
    if(!isVolume&&!s.globalKeys) this.displaySession(a,m?.session_id);
    this.displayRouting(a,s);
    if(!isCurrent()) return;
    if(this.changed(a,"","title")) await a.setTitle("");
  }
  override async onKeyDown(ev:KeyDownEvent<Settings>):Promise<void> {
    await guarded(ev.action,async()=>{
      const settings=this.displayedSettings(ev.action,ev.payload.settings);
      if(settings.globalKeys) {await sendMediaKey(this.command);return;}
      if(this.command==="mute"||this.command.startsWith("volume-")) await volume(settings,this.command==="volume-down"?-1:1,this.command==="mute");
      else await transport(settings,this.command);
    });
  }
}
@action({UUID:`${UUID}.play-pause`}) export class PlayPause extends MediaButton {protected readonly command="play-pause";}
@action({UUID:`${UUID}.previous`}) export class Previous extends MediaButton {protected readonly command="previous";}
@action({UUID:`${UUID}.next`}) export class Next extends MediaButton {protected readonly command="next";}
@action({UUID:`${UUID}.stop`}) export class Stop extends MediaButton {protected readonly command="stop";}
@action({UUID:`${UUID}.mute`}) export class Mute extends MediaButton {protected readonly command="mute";}
@action({UUID:`${UUID}.volume-up`}) export class VolumeUp extends MediaButton {protected readonly command="volume-up";}
@action({UUID:`${UUID}.volume-down`}) export class VolumeDown extends MediaButton {protected readonly command="volume-down";}

@action({UUID:`${UUID}.volume-dial`})
export class VolumeDial extends ConfiguredAction {
  override async onDialRotate(ev:DialRotateEvent<Settings>):Promise<void> {if(ev.payload.ticks) await guarded(ev.action,()=>{
    const settings=this.displayedSettings(ev.action,ev.payload.settings);
    return settings.globalKeys?sendMediaKey(ev.payload.ticks>0?"volume-up":"volume-down",Math.min(32,Math.abs(ev.payload.ticks))):volume(settings,ev.payload.ticks);
  });}
  override async onDialDown(ev:DialDownEvent<Settings>):Promise<void> {await guarded(ev.action,()=>this.mute(ev.action,ev.payload.settings));}
  override async onTouchTap(ev:TouchTapEvent<Settings>):Promise<void> {await guarded(ev.action,()=>this.mute(ev.action,ev.payload.settings));}
  private mute(instance:Instance,current:Settings):Promise<void> {
    const settings=this.displayedSettings(instance,current);
    return settings.globalKeys?sendMediaKey("mute"):volume(settings,0,true);
  }
  protected override async render(a:Instance,s:Settings,isCurrent:()=>boolean=()=>true,isVisible:()=>boolean=isCurrent):Promise<void> {
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
    if(isVisible()) this.displayRouting(a,s);
  }
}
