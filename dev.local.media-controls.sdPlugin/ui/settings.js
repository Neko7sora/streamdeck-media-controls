const {t,setLanguage,localizePage}=MediaI18n;
setLanguage(globalThis.navigator?.language??"en");
localizePage(document);
let socket,context,action,settings={},sessions=[],audioTargets=[],settingsRevision=0;
let mediaOptionsLoaded=false,audioOptionsLoaded=false;
const media=document.getElementById("media"),audio=document.getElementById("audio"),global=document.getElementById("global"),details=document.getElementById("details");
const dialMode=document.getElementById("dial-mode"),seekStep=document.getElementById("seek-step"),scrollText=document.getElementById("scroll-text");
const displaySettings=[
  ["show-title","showTitle"],["show-artist","showArtist"],["show-artwork","showArtwork"],
  ["show-app-icon","showAppIcon"],["show-status","showStatus"],["show-position","showPosition"],
  ["show-duration","showDuration"],["show-progress","showProgress"],["show-dial-info","showDialInfo"],
  ["show-control-icon","showControlIcon"],["show-target","showTarget"],["show-scope","showScope"],
  ["show-volume","showVolume"],["show-volume-bar","showVolumeBar"]
].map(([id,key])=>[document.getElementById(id),key]);
const registerChrome=document.getElementById("register-chrome"),chromeStatus=document.getElementById("chrome-registration-status");
let registrationRequestId=null,registrationTimeout;
let lastOptionsAt=0,pushOptions=false,lastProbeAt=0;
function showChromeConnection(connection){
  const state=connection?.state??"checking";
  const connected=state==="connected";
  const title=connected?t("chrome.connected"):state==="unavailable"?t("chrome.connection.unavailable"):state==="disconnected"?t("chrome.disconnected"):t("chrome.checking.connection");
  const detail=connected?(connection.sessions>0?t("receiving.media.sessions",{count:connection.sessions}) :t("chrome.connection.idle"))
    :state==="unavailable"?t("chrome.connection.unavailableHelp")
    :state==="disconnected"?t("chrome.connection.disconnectedHelp")
    :t("waiting.for.the.plugin.to.respond");
  document.getElementById("chrome-connection").dataset.state=state;
  // Do not repeatedly announce an unchanged status during polling.
  for(const [id,value] of [["chrome-connection-title",title],["chrome-connection-detail",detail]]) {
    const element=document.getElementById(id);if(element.textContent!==value) element.textContent=value;
  }
}
function setSettingsDisabled(disabled){for(const element of [media,audio,global,dialMode,seekStep,scrollText,...displaySettings.map(([element])=>element)]) element.disabled=disabled;}
setSettingsDisabled(true);
function send(event,payload){if(socket?.readyState===WebSocket.OPEN) socket.send(JSON.stringify({event,context,action,payload}));}
function requestOptions(){send("sendToPlugin",{request:"options",settingsRevision});}
function populate(select,items,current,defaultValue,defaultLabel){
  const options=[{id:defaultValue,label:defaultLabel},...items.filter(item=>item.id!==defaultValue)];
  if(current!==defaultValue&&!items.some(x=>x.id===current)) options.push({id:current,label:t("disconnected.please.reselect.the.target")});
  populateOptions(select,options,current);
}
function populateOptions(select,options,current){
  // Preserve the open selection and keyboard navigation during the one-second refresh.
  const unchanged=select.children.length===options.length&&options.every((item,index)=>{
    const option=select.children[index];return option.value===item.id&&option.textContent===item.label;
  });
  if(!unchanged){
    select.replaceChildren();
    for(const item of options){const option=document.createElement("option");option.value=item.id;option.textContent=item.label;select.append(option);}
  }
  if(select.value!==current) select.value=current;
}
function show(){
  populate(media,sessions,settings.mediaTarget??"auto","auto",t("settings.target.automatic"));
  populate(audio,audioTargets,settings.audioTarget??"master","master",t("settings.target.system"));
  global.checked=settings.globalKeys===true;
  scrollText.checked=settings.scrollText!==false;
  dialMode.value=settings.dialMode==="volume"?"volume":"seek";
  const step=typeof settings.seekStep==="number"&&Number.isFinite(settings.seekStep)&&settings.seekStep>=1&&settings.seekStep<=60?settings.seekStep:5;
  const steps=[1,5,10,30,60];
  if(!steps.includes(step)) steps.push(step);
  populateOptions(seekStep,steps.sort((a,b)=>a-b).map(value=>({id:String(value),label:t("time.seconds",{seconds:value})})),String(step));
  document.getElementById("dial-settings").hidden=action!=="dev.local.media-controls.now-playing-dial";
  const isDial=action==="dev.local.media-controls.now-playing-dial";
  const isNowPlaying=isDial||action==="dev.local.media-controls.now-playing";
  const isVolume=["mute","volume-up","volume-down","volume-dial"].some(name=>action===`dev.local.media-controls.${name}`);
  const isVolumeDial=action==="dev.local.media-controls.volume-dial";
  const globalMode=!isNowPlaying&&settings.globalKeys===true;
  document.getElementById("media-settings").hidden=globalMode||isVolume;
  document.getElementById("audio-settings").hidden=globalMode||(!isVolume&&!isDial);
  document.getElementById("target-note").textContent=globalMode?
    isVolume?t("target.globalVolume.help"):t("target.globalPlayback.help"):
    isVolume?t("target.volume.help"):
    isDial?t("target.independent.help"):t("target.playback.help");
  const mediaMissing=mediaOptionsLoaded&&media.value!=="auto"&&!sessions.some(item=>item.id===media.value);
  const audioMissing=audioOptionsLoaded&&audio.value!=="master"&&!audioTargets.some(item=>item.id===audio.value);
  media.dataset.state=mediaMissing?"missing":"available";
  audio.dataset.state=audioMissing?"missing":"available";
  const targetMissing=(!document.getElementById("media-settings").hidden&&mediaMissing)||(!document.getElementById("audio-settings").hidden&&audioMissing);
  const targetWarning=document.getElementById("target-warning");
  targetWarning.hidden=!targetMissing;
  const warning=targetMissing?t("settings.target.missing"):"";
  if(targetWarning.textContent!==warning) targetWarning.textContent=warning;
  document.getElementById("now-playing-help").hidden=!isDial;
  document.getElementById("now-playing-help").textContent=(dialMode.value==="volume"?t("settings.dial.volumeHelp"):t("settings.dial.seekHelp",{seconds:step}))
    +(settings.showProgress!==false?" "+t("settings.dial.tapHelp"):"");
  document.getElementById("global-settings").hidden=isNowPlaying;
  document.getElementById("display-settings").hidden=false;
  for(const [id,visible] of [
    ["control-icon-setting",!isNowPlaying&&!isVolumeDial],["scope-setting",isVolumeDial],
    ["target-setting",!isNowPlaying],["title-setting",isNowPlaying||!isVolume],
    ["artist-setting",isNowPlaying],["artwork-setting",isNowPlaying],
    ["app-icon-setting",isNowPlaying||(!isVolume&&!globalMode)],
    ["volume-setting",isVolume],["status-setting",isNowPlaying||isVolume],
    ["volume-bar-setting",isVolumeDial],["control-display-note",!isNowPlaying]
  ]) document.getElementById(id).hidden=!visible;
  document.getElementById("title-label").textContent=globalMode?t("target.description"):t("track.title");
  document.getElementById("status-label").textContent=isNowPlaying?t("playback.status"):isVolumeDial?t("mute.status.control.hint"):t("mute.status");
  document.getElementById("dial-display-settings").hidden=!isDial;
  for(const [element,key] of displaySettings) element.checked=settings[key]!==false;
  document.getElementById("progress-display-note").hidden=!isDial||settings.showProgress!==false;
  document.getElementById("seek-settings").hidden=dialMode.value!=="seek";
  details.textContent=sessions.find(s=>s.id===media.value)?.details??t("metadata.selection.help");
}
window.connectElgatoStreamDeckSocket=(port,uuid,registerEvent,_info,actionInfo)=>{
  setLanguage(JSON.parse(_info).application?.language??globalThis.navigator?.language??"en");localizePage(document);
  const info=JSON.parse(actionInfo);context=uuid;action=info.action;settings=info.payload.settings??{};
  document.getElementById("global-settings").open=settings.globalKeys===true;
  show();
  socket=new WebSocket(`ws://127.0.0.1:${port}`);
  socket.onopen=()=>{pushOptions=false;lastProbeAt=0;socket.send(JSON.stringify({event:registerEvent,uuid}));setSettingsDisabled(false);registerChrome.disabled=false;lastOptionsAt=Date.now();document.getElementById("status").textContent="";requestOptions();};
  socket.onmessage=event=>{
    const msg=JSON.parse(event.data);
    if(msg.event==="didReceiveSettings"){settingsRevision++;settings=msg.payload.settings??{};show();if(pushOptions) send("sendToPlugin",{request:"watch",settingsRevision});}
    if(msg.event==="sendToPropertyInspector"){
      if(msg.payload.response==="chromeHostRegistration") {
        if(registrationRequestId===null||msg.payload.requestId!==registrationRequestId) return;
        registrationRequestId=null;clearTimeout(registrationTimeout);registerChrome.disabled=false;
        chromeStatus.textContent=msg.payload.message;
        return;
      }
      if(msg.payload.protocol===2) pushOptions=true;
      if(msg.payload.settings!=null){
        if(msg.payload.settingsRevision===settingsRevision){settings=msg.payload.settings;settingsRevision++;}
        // A recovery response may predate local edits made before push resumed.
        // Keep the plugin's revision current even when those settings are stale.
        if(pushOptions) send("sendToPlugin",{request:"watch",settingsRevision});
      }
      if(msg.payload.sessions!==undefined) {sessions=msg.payload.sessions;mediaOptionsLoaded=true;}
      if(msg.payload.audio!==undefined) {audioTargets=msg.payload.audio;audioOptionsLoaded=true;}
      lastOptionsAt=Date.now();if(msg.payload.chromeConnection!==undefined) showChromeConnection(msg.payload.chromeConnection);
      show();
      if(msg.payload.optionsRequired===true){pushOptions=false;requestOptions();}
    }
  };
  socket.onclose=()=>{
    setSettingsDisabled(true);
    registerChrome.disabled=true;clearTimeout(registrationTimeout);
    if(registrationRequestId!==null) chromeStatus.textContent=t("chrome.registration.unconfirmed");
    registrationRequestId=null;
    lastOptionsAt=0;showChromeConnection({state:"unavailable"});
    document.getElementById("status").textContent=t("disconnected.from.the.plugin");
  };
};
registerChrome.addEventListener("click",()=>{
  if(socket?.readyState!==WebSocket.OPEN||registrationRequestId!==null) return;
  registrationRequestId=crypto.randomUUID();registerChrome.disabled=true;
  chromeStatus.textContent=t("registering.chrome.integration");
  send("sendToPlugin",{request:"registerChromeHost",requestId:registrationRequestId});
  registrationTimeout=setTimeout(()=>{
    registrationRequestId=null;registerChrome.disabled=socket?.readyState!==WebSocket.OPEN;
    chromeStatus.textContent=t("chrome.registration.timeout");
  },25000);
});
for(const [element,key,value] of [
  [media,"mediaTarget",()=>media.value],
  [audio,"audioTarget",()=>audio.value],
  [global,"globalKeys",()=>global.checked],
  [dialMode,"dialMode",()=>dialMode.value],
  [seekStep,"seekStep",()=>Number(seekStep.value)],
  [scrollText,"scrollText",()=>scrollText.checked],
  ...displaySettings.map(([element,key])=>[element,key,()=>element.checked])
]) element.addEventListener("change",()=>{
  if(socket?.readyState!==WebSocket.OPEN){show();return;}
  settingsRevision++;settings={...settings,[key]:value()};send("setSettings",settings);show();
  if(pushOptions) send("sendToPlugin",{request:"watch",settingsRevision});
});
setInterval(()=>{
  if(!pushOptions) requestOptions();
  else if(Date.now()-Math.max(lastProbeAt,lastOptionsAt)>=3000) {lastProbeAt=Date.now();send("sendToPlugin",{request:"alive"});}
  if(lastOptionsAt&&Date.now()-lastOptionsAt>6000) showChromeConnection({state:"unavailable"});
},1000);
