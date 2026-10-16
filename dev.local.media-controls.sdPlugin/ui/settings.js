let socket,context,action,settings={},sessions=[],audioTargets=[],settingsRevision=0;
const media=document.getElementById("media"),audio=document.getElementById("audio"),global=document.getElementById("global"),details=document.getElementById("details");
const dialMode=document.getElementById("dial-mode"),seekStep=document.getElementById("seek-step");
function send(event,payload){if(socket?.readyState===WebSocket.OPEN) socket.send(JSON.stringify({event,context,action,payload}));}
function requestOptions(){send("sendToPlugin",{request:"options",settingsRevision});}
function populate(select,items,current,defaultValue,defaultLabel){
  select.replaceChildren();
  const add=(id,label)=>{const option=document.createElement("option");option.value=id;option.textContent=label;select.append(option);};
  add(defaultValue,defaultLabel);
  for(const item of items) if(item.id!==defaultValue) add(item.id,item.label);
  if(current!==defaultValue&&!items.some(x=>x.id===current)) add(current,"切断済み — 対象を再選択してください");
  select.value=current;
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
  socket.onopen=()=>{socket.send(JSON.stringify({event:registerEvent,uuid}));requestOptions();};
  socket.onmessage=event=>{
    const msg=JSON.parse(event.data);
    if(msg.event==="didReceiveSettings"){settingsRevision++;settings=msg.payload.settings??{};show();}
    if(msg.event==="sendToPropertyInspector"){
      if(msg.payload.settingsRevision===settingsRevision&&msg.payload.settings!=null){
        settings=msg.payload.settings;settingsRevision++;
      }
      sessions=msg.payload.sessions??[];
      audioTargets=msg.payload.audio??[];
      show();
    }
  };
  socket.onclose=()=>{document.getElementById("status").textContent="プラグインとの接続が切れました";};
};
for(const [element,key,value] of [
  [media,"mediaTarget",()=>media.value],
  [audio,"audioTarget",()=>audio.value],
  [global,"globalKeys",()=>global.checked],
  [dialMode,"dialMode",()=>dialMode.value],
  [seekStep,"seekStep",()=>Number(seekStep.value)]
]) element.addEventListener("change",()=>{
  settingsRevision++;settings={...settings,[key]:value()};send("setSettings",settings);show();
});
setInterval(requestOptions,1000);
