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
const displayRows={showTitle:"title-setting",showArtist:"artist-setting",showArtwork:"artwork-setting",showAppIcon:"app-icon-setting",showStatus:"status-setting",showControlIcon:"control-icon-setting",showTarget:"target-setting",showScope:"scope-setting",showVolume:"volume-setting",showVolumeBar:"volume-bar-setting",showPosition:"dial-display-settings",showDuration:"dial-display-settings",showProgress:"dial-display-settings",showDialInfo:"dial-display-settings"};
const showAll=document.getElementById("show-all");
function applicableDisplaySettings(){return displaySettings.filter(([,key])=>!document.getElementById(displayRows[key]).hidden);}
function updateDisplaySummary(){
  if(!action) return;
  const applicable=applicableDisplaySettings(),visible=applicable.filter(([,key])=>settings[key]!==false).length;
  document.getElementById("display-summary").textContent=t("settings.display.count",{visible,total:applicable.length});
  showAll.disabled=socket?.readyState!==WebSocket.OPEN||visible===applicable.length;
}
const actionLabels={"play-pause":"settings.action.playPause",previous:"settings.action.previous",next:"settings.action.next",stop:"settings.action.stop",mute:"settings.action.mute","volume-up":"settings.action.volumeUp","volume-down":"settings.action.volumeDown","volume-dial":"settings.action.volumeDial","now-playing":"settings.action.nowPlaying","now-playing-dial":"settings.action.nowPlayingDial"};
const registerChrome=document.getElementById("register-chrome"),chromeStatus=document.getElementById("chrome-registration-status");
const registrationForm=document.getElementById("chrome-registration-form"),extensionIdInput=document.getElementById("chrome-extension-id");
let registrationRequestId=null,registrationTimeout;
function updateRegistrationControls(){
  registerChrome.disabled=socket?.readyState!==WebSocket.OPEN||registrationRequestId!==null;
  extensionIdInput.readOnly=registrationRequestId!==null;
}
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
  document.getElementById("chrome-setup-link").hidden=state!=="disconnected";
  // Do not repeatedly announce an unchanged status during polling.
  for(const [id,value] of [["chrome-connection-title",title],["chrome-connection-detail",detail]]) {
    const element=document.getElementById(id);if(element.textContent!==value) element.textContent=value;
  }
}
function setSettingsDisabled(disabled){
  for(const element of [media,audio,global,dialMode,seekStep,scrollText,...displaySettings.map(([element])=>element)]) element.disabled=disabled;
  updateDisplaySummary();
}
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
  document.getElementById("action-heading").textContent=t(actionLabels[action?.split(".").at(-1)]??"settings.subtitle");
  populate(media,sessions,settings.mediaTarget??"auto","auto",t("settings.target.automatic"));
  populate(audio,audioTargets,settings.audioTarget??"master","master",t("settings.target.system"));
  global.checked=settings.globalKeys===true;
  scrollText.checked=settings.scrollText!==false;
  dialMode.value=settings.dialMode==="volume"?"volume":"seek";
  const step=typeof settings.seekStep==="number"&&Number.isFinite(settings.seekStep)&&settings.seekStep>=1&&settings.seekStep<=60?settings.seekStep:5;
  const steps=[1,5,10,30,60];
  if(!steps.includes(step)) steps.push(step);
  populateOptions(seekStep,steps.sort((a,b)=>a-b).map(value=>({id:String(value),label:t("time.seconds",{seconds:value})})),String(step));
  document.getElementById("dial-settings").hidden=action!=="dev.n7s.media-controls.now-playing-dial";
  const isDial=action==="dev.n7s.media-controls.now-playing-dial";
  const isNowPlaying=isDial||action==="dev.n7s.media-controls.now-playing";
  const isVolume=["mute","volume-up","volume-down","volume-dial"].some(name=>action===`dev.n7s.media-controls.${name}`);
  const isVolumeDial=action==="dev.n7s.media-controls.volume-dial";
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
  updateDisplaySummary();
  document.getElementById("action-settings").hidden=false;
}
window.connectElgatoStreamDeckSocket=(port,uuid,registerEvent,_info,actionInfo)=>{
  setLanguage(JSON.parse(_info).application?.language??globalThis.navigator?.language??"en");localizePage(document);
  const info=JSON.parse(actionInfo);context=uuid;action=info.action;settings=info.payload.settings??{};
  document.getElementById("global-settings").open=settings.globalKeys===true;
  show();
  socket=new WebSocket(`ws://127.0.0.1:${port}`);
  socket.onopen=()=>{pushOptions=false;lastProbeAt=0;socket.send(JSON.stringify({event:registerEvent,uuid}));setSettingsDisabled(false);updateRegistrationControls();lastOptionsAt=Date.now();document.getElementById("status").textContent="";requestOptions();};
  socket.onmessage=event=>{
    const msg=JSON.parse(event.data);
    if(msg.event==="didReceiveSettings"){settingsRevision++;settings=msg.payload.settings??{};show();if(pushOptions) send("sendToPlugin",{request:"watch",settingsRevision});}
    if(msg.event==="sendToPropertyInspector"){
      if(msg.payload.response==="chromeHostRegistration") {
        if(registrationRequestId===null||msg.payload.requestId!==registrationRequestId) return;
        registrationRequestId=null;clearTimeout(registrationTimeout);updateRegistrationControls();
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
    clearTimeout(registrationTimeout);
    if(registrationRequestId!==null) chromeStatus.textContent=t("chrome.registration.unconfirmed");
    registrationRequestId=null;
    updateRegistrationControls();
    lastOptionsAt=0;showChromeConnection({state:"unavailable"});
    document.getElementById("status").textContent=t("disconnected.from.the.plugin");
  };
};
extensionIdInput.addEventListener("input",()=>{
  extensionIdInput.setCustomValidity("");
  extensionIdInput.removeAttribute("aria-invalid");
  if(chromeStatus.dataset.state==="invalid") {chromeStatus.textContent="";delete chromeStatus.dataset.state;}
});
registrationForm.addEventListener("submit",event=>{
  event.preventDefault();
  if(socket?.readyState!==WebSocket.OPEN||registrationRequestId!==null) return;
  // Normalize pasted whitespace before checking the native required/pattern constraints.
  extensionIdInput.value=extensionIdInput.value.trim();
  extensionIdInput.setCustomValidity("");
  if(!extensionIdInput.checkValidity()) {
    const message=t("chrome.registration.invalidId");
    extensionIdInput.setCustomValidity(message);extensionIdInput.setAttribute("aria-invalid","true");
    chromeStatus.dataset.state="invalid";chromeStatus.textContent=message;
    extensionIdInput.focus();extensionIdInput.reportValidity();return;
  }
  extensionIdInput.removeAttribute("aria-invalid");delete chromeStatus.dataset.state;
  const extensionId=extensionIdInput.value;
  registrationRequestId=crypto.randomUUID();updateRegistrationControls();
  chromeStatus.textContent=t("registering.chrome.integration");
  send("sendToPlugin",{request:"registerChromeHost",requestId:registrationRequestId,extensionId});
  registrationTimeout=setTimeout(()=>{
    registrationRequestId=null;updateRegistrationControls();
    chromeStatus.textContent=t("chrome.registration.timeout");
  },25000);
});
document.getElementById("chrome-setup-link").addEventListener("click",()=>{
  document.getElementById("chrome-setup").open=true;
  document.getElementById("chrome-setup-summary").focus();
});
document.getElementById("setup-guide").addEventListener("click",event=>{
  event.preventDefault();
  send("openUrl",{url:document.getElementById("setup-guide").href});
});
function applySettings(changes){
  if(socket?.readyState!==WebSocket.OPEN){show();return;}
  settingsRevision++;settings={...settings,...changes};send("setSettings",settings);show();
  if(pushOptions) send("sendToPlugin",{request:"watch",settingsRevision});
}
showAll.addEventListener("click",()=>{
  if(showAll.disabled) return;
  applySettings(Object.fromEntries(applicableDisplaySettings().map(([,key])=>[key,true])));
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
  applySettings({[key]:value()});
});
setInterval(()=>{
  if(!pushOptions) requestOptions();
  else if(Date.now()-Math.max(lastProbeAt,lastOptionsAt)>=3000) {lastProbeAt=Date.now();send("sendToPlugin",{request:"alive"});}
  if(lastOptionsAt&&Date.now()-lastOptionsAt>6000) showChromeConnection({state:"unavailable"});
},1000);
