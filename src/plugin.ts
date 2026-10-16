import streamDeck, {
  action,
  SingletonAction,
  type KeyDownEvent,
  type DialDownEvent,
  type DialRotateEvent,
  type WillAppearEvent,
  type KeyAction,
  type DialAction,
  type JsonObject
} from "@elgato/streamdeck";
import { sendMediaKey, type MediaCommand } from "./windows-media.js";
import { startChromeServer } from "./chrome-server.js";
import {startMediaPolling, subscribe, currentMedia} from "./media-state.js";
import {safeImage, type MediaItem} from "./media-model.js";

const UUID = "dev.local.media-controls";

async function execute(command: MediaCommand, count: number, source: {showAlert(): Promise<void>}): Promise<void> {
  try {
    await sendMediaKey(command, count);
  } catch (error) {
    streamDeck.logger.error(`Failed to send ${command}: ${String(error)}`);
    await source.showAlert();
  }
}

abstract class MediaButton extends SingletonAction {
  protected abstract readonly mediaCommand: MediaCommand;

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    await execute(this.mediaCommand, 1, ev.action);
  }
}

@action({ UUID: `${UUID}.play-pause` })
class PlayPause extends MediaButton {
  protected readonly mediaCommand = "play-pause";
}
@action({ UUID: `${UUID}.previous` })
class Previous extends MediaButton {
  protected readonly mediaCommand = "previous";
}
@action({ UUID: `${UUID}.next` })
class Next extends MediaButton {
  protected readonly mediaCommand = "next";
}
@action({ UUID: `${UUID}.stop` })
class Stop extends MediaButton {
  protected readonly mediaCommand = "stop";
}
@action({ UUID: `${UUID}.mute` })
class Mute extends MediaButton {
  protected readonly mediaCommand = "mute";
}
@action({ UUID: `${UUID}.volume-up` })
class VolumeUp extends MediaButton {
  protected readonly mediaCommand = "volume-up";
}
@action({ UUID: `${UUID}.volume-down` })
class VolumeDown extends MediaButton {
  protected readonly mediaCommand = "volume-down";
}

@action({ UUID: `${UUID}.volume-dial` })
class VolumeDial extends SingletonAction {
  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    const ticks = ev.payload.ticks;
    if (ticks === 0) return;
    const count = Math.min(Math.abs(ticks), 32);
    await execute(ticks > 0 ? "volume-up" : "volume-down", count, ev.action);
  }

  override async onDialDown(ev: DialDownEvent): Promise<void> {
    await execute("mute", 1, ev.action);
  }
}

streamDeck.actions.registerAction(new PlayPause());
streamDeck.actions.registerAction(new Previous());
streamDeck.actions.registerAction(new Next());
streamDeck.actions.registerAction(new Stop());
streamDeck.actions.registerAction(new Mute());
streamDeck.actions.registerAction(new VolumeUp());
streamDeck.actions.registerAction(new VolumeDown());
streamDeck.actions.registerAction(new VolumeDial());


const shortTitle = (title: string, length=27) =>
  [...title].length > length ? [...title].slice(0,length-1).join("")+"…" : title;
const formatTime = (sec: number) => {
  const seconds=Math.max(0,Math.trunc(sec));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,"0")}`;
};

@action({ UUID: `${UUID}.now-playing` })
class NowPlaying extends SingletonAction {
  override async onWillAppear(ev:WillAppearEvent):Promise<void> {
    if(ev.action.isKey()) await this.apply(ev.action,currentMedia());
  }
  private async apply(instance: KeyAction<JsonObject>, media:MediaItem|null):Promise<void> {
    await instance.setImage(safeImage(media?.artwork_data_url));
    await instance.setTitle(media?.title ? shortTitle(media.title) : "No media");
  }
  async refresh(media:MediaItem|null):Promise<void> {
    const updates:Promise<void>[]=[];
    this.actions.forEach(a=>{if(a.isKey()) updates.push(this.apply(a,media));});
    await Promise.allSettled(updates);
  }
  override async onKeyDown(ev:KeyDownEvent):Promise<void> {
    await execute("play-pause",1,ev.action);
  }
}
@action({ UUID: `${UUID}.now-playing-dial` })
class NowPlayingDial extends SingletonAction {
  override async onWillAppear(ev:WillAppearEvent):Promise<void> {
    if(ev.action.isDial()) await this.apply(ev.action,currentMedia());
  }
  private async apply(instance: DialAction<JsonObject>, media:MediaItem|null):Promise<void> {
    const start=media?.timeline?.start_sec ?? 0;
    const end=media?.timeline?.end_sec ?? 0;
    const position=media?.timeline?.position_sec ?? 0;
    const duration=end-start;
    const percentage=duration>0 ? Math.max(0,Math.min(100,100*(position-start)/duration)) : 0;
    await instance.setFeedback({
      title:media?.title ? shortTitle(media.title,20) : "No media",
      value:formatTime(position),
      indicator:percentage,
      ...(safeImage(media?.artwork_data_url) ? {icon:media?.artwork_data_url} : {})
    });
  }
  async refresh(media:MediaItem|null):Promise<void> {
    const updates:Promise<void>[]=[];
    this.actions.forEach(a=>{if(a.isDial()) updates.push(this.apply(a,media));});
    await Promise.allSettled(updates);
  }
  override async onDialRotate(ev:DialRotateEvent):Promise<void> {
    if (ev.payload.ticks===0) return;
    await execute(ev.payload.ticks>0?"volume-up":"volume-down",Math.min(32,Math.abs(ev.payload.ticks)),ev.action);
  }
  override async onDialDown(ev:DialDownEvent):Promise<void> {
    await execute("play-pause",1,ev.action);
  }
}

const nowPlaying = new NowPlaying();
const nowPlayingDial = new NowPlayingDial();
streamDeck.actions.registerAction(nowPlaying);
streamDeck.actions.registerAction(nowPlayingDial);
let refreshing = false;
let pending:MediaItem|null = null;
subscribe(item=>{
  pending=item;
  if(refreshing) return;
  refreshing=true;
  void (async()=>{
    try {
      while(true) {
        const item=pending;
        await nowPlaying.refresh(item);
        await nowPlayingDial.refresh(item);
        if (pending === item) break;
      }
    } catch(error) { streamDeck.logger.error(`UI update: ${String(error)}`); }
    finally {refreshing=false;}
  })();
});
startMediaPolling(msg=>streamDeck.logger.warn(msg));
try { startChromeServer(msg=>streamDeck.logger.info(msg)); }
catch(error) {streamDeck.logger.error(`Chrome bridge init failed: ${String(error)}`);}
streamDeck.connect();
