const enable=document.getElementById("enabled"), status=document.getElementById("status"), save=document.getElementById("save");
let loaded=false,saving=false;
let connectionRequest=0,connectionPending=false,connectionTimeout;
async function refreshConnection(force=false){
  if(connectionPending&&!force) return;
  const request=++connectionRequest;
  connectionPending=true;clearTimeout(connectionTimeout);
  // A silent worker must not leave a stale connected indicator indefinitely.
  connectionTimeout=setTimeout(()=>{
    if(request!==connectionRequest) return;
    connectionRequest++;connectionPending=false;showConnection("unavailable");
  },6000);
  let state="unavailable";
  try {
    const response=await chrome.runtime.sendMessage({type:"BRIDGE_STATUS"});
    if(["connected","disabled","checking","disconnected"].includes(response?.state)) state=response.state;
  } catch {}
  if(request!==connectionRequest) return;
  clearTimeout(connectionTimeout);connectionPending=false;showConnection(state);
}
function showConnection(state){
  document.getElementById("connection").dataset.state=state;
  const title={connected:"Stream Deck に接続済み",disabled:"送信は無効です",checking:"接続を確認中",disconnected:"Stream Deck に未接続"}[state]??"接続を確認できません";
  const detail={connected:"連携は正常です。メディアページを再生すると情報が送信されます。",disabled:"送信を有効にして保存すると、接続を確認します。",checking:"Stream Deck への接続を確認しています。",disconnected:"Stream Deck を起動し、連携を登録してください。登録済みの場合は再登録して拡張機能を再読み込みしてください。"}[state]??"拡張機能の接続状態を取得できません。拡張機能を再読み込みし、この画面を開き直してください。";
  for(const [id,value] of [["connection-title",title],["connection-detail",detail]]) {
    const element=document.getElementById(id);if(element.textContent!==value) element.textContent=value;
  }
}
void refreshConnection();
setInterval(()=>{void refreshConnection();},5000);
function setDisabled(disabled){for(const element of [enable,save]) element.disabled=disabled;}
setDisabled(true);
chrome.storage.local.get(["enabled"]).then(v=>{
  enable.checked=Boolean(v.enabled);loaded=true;setDisabled(false);status.textContent="";
}).catch(()=>{status.textContent="設定を読み込めませんでした。拡張機能を再読み込みしてください。";});
save.addEventListener("click",async()=>{
  if(!loaded||saving) return;
  saving=true;setDisabled(true);status.textContent="設定を保存しています…";
  try {await chrome.storage.local.set({enabled:enable.checked});status.textContent="設定を保存しました。";void refreshConnection(true);}
  catch {status.textContent="設定を保存できませんでした。拡張機能を再読み込みしてください。";}
  finally {saving=false;setDisabled(false);}
});
