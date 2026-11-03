import streamDeck,{SingletonAction,type WillAppearEvent,type WillDisappearEvent,type DidReceiveSettingsEvent} from "@elgato/streamdeck";
import type {Instance,Settings} from "./action-settings.js";
import {ScrollingText} from "./scrolling-text.js";
import {DISPLAY_UPDATE_INTERVAL_MS} from "./display-guidelines.js";
import {notifySettingsChanged} from "./property-inspector.js";

export abstract class ConfiguredAction extends SingletonAction<Settings> {
  private readonly settings=new Map<string,Settings>();
  // A reused action ID must not accept asynchronous work from its previous appearance.
  private readonly appearances=new Map<string,symbol>();
  private readonly hashes=new Map<string,Map<string,string>>();
  private readonly renderedAt=new Map<string,number>();
  protected readonly scrolling=new ScrollingText();
  private readonly displayedSessions=new Map<string,string>();
  private refreshing=false;
  private dirty=false;
  override async onWillAppear(ev:WillAppearEvent<Settings>):Promise<void> {this.appearances.set(ev.action.id,Symbol());this.settings.set(ev.action.id,ev.payload.settings);this.hashes.delete(ev.action.id);this.displayedSessions.delete(ev.action.id);this.scrolling.clear(ev.action.id);this.refresh();}
  override onWillDisappear(ev:WillDisappearEvent<Settings>):void {this.appearances.delete(ev.action.id);this.settings.delete(ev.action.id);this.hashes.delete(ev.action.id);this.renderedAt.delete(ev.action.id);this.displayedSessions.delete(ev.action.id);this.scrolling.clear(ev.action.id);}
  override onDidReceiveSettings(ev:DidReceiveSettingsEvent<Settings>):void {this.settings.set(ev.action.id,ev.payload.settings);this.hashes.delete(ev.action.id);this.refresh();}
  protected async render(_instance:Instance,_settings:Settings,_isCurrent:()=>boolean=()=>true):Promise<unknown> {return null;}
  protected displaySession(instance:Instance,session:string|undefined):void {this.displayedSessions.set(instance.id,session??"unavailable");}
  protected displayedSettings(instance:Instance,settings:Settings):Settings {return {...settings,mediaTarget:this.displayedSessions.get(instance.id)??"unavailable"};}
  protected async saveSettings(instance:Instance,settings:Settings):Promise<void> {await instance.setSettings(settings);this.settings.set(instance.id,settings);this.hashes.delete(instance.id);this.refresh();await notifySettingsChanged(instance,settings);}
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
