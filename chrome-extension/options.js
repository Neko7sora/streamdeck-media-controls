const {t,setLanguage,localizePage}=MediaI18n;
setLanguage(chrome.i18n.getUILanguage());
localizePage(document);
const enable=document.getElementById("enabled"), status=document.getElementById("status"), save=document.getElementById("save");
let loaded=false,saving=false;
let connectionRequest=0,connectionPending=false,connectionTimeout;
let statusPort,lastStatusAt=0;
function connectStatus(){
  if(statusPort||!chrome.runtime.connect) return;
  try {
    const port=chrome.runtime.connect({name:"bridge-status"});statusPort=port;
    port.onMessage.addListener(message=>{
      if(statusPort!==port) return;
      connectionRequest++;connectionPending=false;clearTimeout(connectionTimeout);
      lastStatusAt=Date.now();showConnection(message.state);
    });
    port.onDisconnect.addListener(()=>{if(statusPort===port) {statusPort=undefined;showConnection("unavailable");}});
  } catch {statusPort=undefined;}
}
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
  const title={connected:t("connected.to.stream.deck"),disabled:t("sending.is.disabled"),checking:t("checking.connection"),disconnected:t("disconnected.from.stream.deck")}[state]??t("connection.unavailable");
  const detail={connected:t("extension.connection.idle"),disabled:t("enable.sending.and.save.to.check.the.connection"),checking:t("checking.the.connection.to.stream.deck"),disconnected:t("extension.connection.disconnectedHelp")}[state]??t("extension.connection.unavailableHelp");
  for(const [id,value] of [["connection-title",title],["connection-detail",detail]]) {
    const element=document.getElementById(id);if(element.textContent!==value) element.textContent=value;
  }
}
void refreshConnection();
connectStatus();
setInterval(()=>{
  if(statusPort) {
    if(Date.now()-lastStatusAt>6000) showConnection("unavailable");
    try {statusPort.postMessage({type:"status"});} catch {statusPort=undefined;}
  } else {connectStatus();void refreshConnection();}
},5000);
function setDisabled(disabled){for(const element of [enable,save]) element.disabled=disabled;}
setDisabled(true);
chrome.storage.local.get(["enabled"]).then(v=>{
  enable.checked=Boolean(v.enabled);loaded=true;setDisabled(false);status.textContent="";
}).catch(()=>{status.textContent=t("extension.settings.loadFailed");});
save.addEventListener("click",async()=>{
  if(!loaded||saving) return;
  saving=true;setDisabled(true);status.textContent=t("saving.settings");
  try {await chrome.storage.local.set({enabled:enable.checked});status.textContent=t("settings.saved");void refreshConnection(true);}
  catch {status.textContent=t("extension.settings.saveFailed");}
  finally {saving=false;setDisabled(false);}
});
