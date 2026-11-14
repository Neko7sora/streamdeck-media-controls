import streamDeck from "@elgato/streamdeck";
import {setLanguage} from "./localization.js";
import {initializeChromeIntegration,stopChromeIntegration} from "./streamdeck/chrome-integration.js";
import {initializeIcueIntegration,stopIcueIntegration} from "./streamdeck/icue-integration.js";
import {stopChromeRegistration} from "./chrome/chrome-registration.js";
import {startMediaPolling,subscribe} from "./media/media-state.js";
import {ANIMATION_INTERVAL_MS} from "./rendering/scrolling-text.js";
import {PlayPause,Previous,Next,Stop,Mute,VolumeUp,VolumeDown,VolumeDial} from "./streamdeck/control-actions.js";
import {NowPlaying,NowPlayingDial} from "./streamdeck/now-playing-actions.js";
import {startPropertyInspector,refreshInspectorConnection} from "./streamdeck/property-inspector.js";
import {startStreamDeckKeepalive} from "./streamdeck/streamdeck-keepalive.js";

setLanguage(streamDeck.info.application.language);
const visualActions=[
  new PlayPause(),new Previous(),new Next(),new Stop(),new Mute(),
  new VolumeUp(),new VolumeDown(),new VolumeDial(),new NowPlaying(),new NowPlayingDial()
];
for(const instance of visualActions) streamDeck.actions.registerAction(instance);
startPropertyInspector();
subscribe(()=>{
  for(const action of visualActions) action.refresh();
  refreshInspectorConnection();
});
const stop=startMediaPolling(msg=>streamDeck.logger.warn(msg));
const animation=setInterval(()=>{for(const a of visualActions) a.animate();},ANIMATION_INTERVAL_MS);
animation.unref();
let stopped=false;
let stopKeepalive=()=>{};
function shutdown() {
  if(stopped) return;
  stopped=true;
  stopKeepalive();clearInterval(animation);stop();stopChromeRegistration();stopIcueIntegration();stopChromeIntegration();
}
process.once("exit",shutdown);
for(const signal of ["SIGINT","SIGTERM"] as const) process.once(signal,()=>{shutdown();process.exit(0);});
await streamDeck.connect();
// With hidden actions there may be no SDK traffic for hours. A read-only
// round trip prevents the host's idle watchdog from disabling the whole plugin.
stopKeepalive=startStreamDeckKeepalive(()=>streamDeck.settings.getGlobalSettings(),msg=>streamDeck.logger.warn(msg));
await Promise.all([initializeChromeIntegration(),initializeIcueIntegration()]);
