let socket,context,action,settings={},sessions=[],audioTargets=[],settingsRevision=0;
const media=document.getElementById("media"),audio=document.getElementById("audio"),global=document.getElementById("global"),details=document.getElementById("details");
const dialMode=document.getElementById("dial-mode"),seekStep=document.getElementById("seek-step");
const registerChrome=document.getElementById("register-chrome"),chromeStatus=document.getElementById("chrome-registration-status");
let registrationRequestId=null,registrationTimeout;
let lastOptionsAt=0;
function showChromeConnection(connection){
  const state=connection?.state??"checking";
  const connected=state==="connected";
  const title=connected?"Chrome：接続済み":state==="unavailable"?"Chrome：接続を確認できません":state==="disconnected"?"Chrome：未接続":"Chrome：接続を確認中";
  const detail=connected?(connection.sessions>0?`メディアを受信中（${connection.sessions} セッション）` :"連携は正常です。メディアページを再生すると情報が表示されます。")
    :state==="unavailable"?"プラグインの応答または連携の待ち受けを確認できません。Stream Deck と設定画面を開き直してください。"
    :state==="disconnected"?"Chrome 拡張の送信を有効にしてください。初回は「Chrome 連携を登録」を実行してください。"
    :"プラグインからの応答を待っています。";
  document.getElementById("chrome-connection").dataset.state=state;
  // Do not repeatedly announce an unchanged status during polling.
  for(const [id,value] of [["chrome-connection-title",title],["chrome-connection-detail",detail]]) {
    const element=document.getElementById(id);if(element.textContent!==value) element.textContent=value;
  }
}
function setSettingsDisabled(disabled){for(const element of [media,audio,global,dialMode,seekStep]) element.disabled=disabled;}
setSettingsDisabled(true);
function send(event,payload){if(socket?.readyState===WebSocket.OPEN) socket.send(JSON.stringify({event,context,action,payload}));}
function requestOptions(){send("sendToPlugin",{request:"options",settingsRevision});}
function populate(select,items,current,defaultValue,defaultLabel){
  const options=[{id:defaultValue,label:defaultLabel},...items.filter(item=>item.id!==defaultValue)];
  if(current!==defaultValue&&!items.some(x=>x.id===current)) options.push({id:current,label:"切断済み — 対象を再選択してください"});
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
  populate(media,sessions,settings.mediaTarget??"auto","auto","自動（再生中を優先・現在の対象を維持）");
  populate(audio,audioTargets,settings.audioTarget??"master","master","マスター（既定のマルチメディア出力）");
  global.checked=settings.globalKeys===true;
  dialMode.value=settings.dialMode==="volume"?"volume":"seek";
  seekStep.value=String([1,5,10,30,60].includes(settings.seekStep)?settings.seekStep:5);
  document.getElementById("dial-settings").hidden=action!=="dev.local.media-controls.now-playing-dial";
  document.getElementById("seek-settings").hidden=dialMode.value!=="seek";
  details.textContent=sessions.find(s=>s.id===media.value)?.details??"自動選択、または対象なし。セッションを選択すると全取得項目を確認できます。";
}
window.connectElgatoStreamDeckSocket=(port,uuid,registerEvent,_info,actionInfo)=>{
  const info=JSON.parse(actionInfo);context=uuid;action=info.action;settings=info.payload.settings??{};
  show();
  socket=new WebSocket(`ws://127.0.0.1:${port}`);
  socket.onopen=()=>{socket.send(JSON.stringify({event:registerEvent,uuid}));setSettingsDisabled(false);registerChrome.disabled=false;lastOptionsAt=Date.now();document.getElementById("status").textContent="";requestOptions();};
  socket.onmessage=event=>{
    const msg=JSON.parse(event.data);
    if(msg.event==="didReceiveSettings"){settingsRevision++;settings=msg.payload.settings??{};show();}
    if(msg.event==="sendToPropertyInspector"){
      if(msg.payload.response==="chromeHostRegistration") {
        if(registrationRequestId===null||msg.payload.requestId!==registrationRequestId) return;
        registrationRequestId=null;clearTimeout(registrationTimeout);registerChrome.disabled=false;
        chromeStatus.textContent=msg.payload.message;
        return;
      }
      if(msg.payload.settingsRevision===settingsRevision&&msg.payload.settings!=null){
        settings=msg.payload.settings;settingsRevision++;
      }
      sessions=msg.payload.sessions??[];
      audioTargets=msg.payload.audio??[];
      lastOptionsAt=Date.now();showChromeConnection(msg.payload.chromeConnection);
      show();
    }
  };
  socket.onclose=()=>{
    setSettingsDisabled(true);
    registerChrome.disabled=true;clearTimeout(registrationTimeout);
    if(registrationRequestId!==null) chromeStatus.textContent="登録結果を確認できませんでした。設定画面を開き直してください。";
    registrationRequestId=null;
    lastOptionsAt=0;showChromeConnection({state:"unavailable"});
    document.getElementById("status").textContent="プラグインとの接続が切れました";
  };
};
registerChrome.addEventListener("click",()=>{
  if(socket?.readyState!==WebSocket.OPEN||registrationRequestId!==null) return;
  registrationRequestId=crypto.randomUUID();registerChrome.disabled=true;
  chromeStatus.textContent="Chrome 連携を登録しています…";
  send("sendToPlugin",{request:"registerChromeHost",requestId:registrationRequestId});
  registrationTimeout=setTimeout(()=>{
    registrationRequestId=null;registerChrome.disabled=socket?.readyState!==WebSocket.OPEN;
    chromeStatus.textContent="応答を確認できませんでした。もう一度お試しください。";
  },25000);
});
for(const [element,key,value] of [
  [media,"mediaTarget",()=>media.value],
  [audio,"audioTarget",()=>audio.value],
  [global,"globalKeys",()=>global.checked],
  [dialMode,"dialMode",()=>dialMode.value],
  [seekStep,"seekStep",()=>Number(seekStep.value)]
]) element.addEventListener("change",()=>{
  if(socket?.readyState!==WebSocket.OPEN){show();return;}
  settingsRevision++;settings={...settings,[key]:value()};send("setSettings",settings);show();
});
setInterval(()=>{requestOptions();if(lastOptionsAt&&Date.now()-lastOptionsAt>6000) showChromeConnection({state:"unavailable"});},1000);
