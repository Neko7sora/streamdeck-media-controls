import streamDeck from "@elgato/streamdeck";
import {setLanguage} from "./localization.js";
import {startChromeServer} from "./chrome-server.js";
import {initializeIcueIntegration,stopIcueIntegration} from "./icue-integration.js";
import {stopChromeRegistration} from "./chrome-registration.js";
import {startMediaPolling,subscribe} from "./media-state.js";
import {ANIMATION_INTERVAL_MS} from "./scrolling-text.js";
import {PlayPause,Previous,Next,Stop,Mute,VolumeUp,VolumeDown,VolumeDial} from "./control-actions.js";
import {NowPlaying,NowPlayingDial} from "./now-playing-actions.js";
import {startPropertyInspector,refreshInspectorConnection} from "./property-inspector.js";

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
let closeBridge=()=>{};
try {const server=startChromeServer(msg=>streamDeck.logger.info(msg));closeBridge=()=>{server.close();server.closeAllConnections();};}
catch(e) {streamDeck.logger.error(`Chrome bridge: ${String(e)}`);}
let stopped=false;
function shutdown() {
  if(stopped) return;
  stopped=true;
  clearInterval(animation);stop();stopChromeRegistration();stopIcueIntegration();closeBridge();
}
process.once("exit",shutdown);
for(const signal of ["SIGINT","SIGTERM"] as const) process.once(signal,()=>{shutdown();process.exit(0);});
await streamDeck.connect();
await initializeIcueIntegration();
