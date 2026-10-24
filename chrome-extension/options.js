const {t,setLanguage,localizePage}=MediaI18n;
setLanguage(chrome.i18n.getUILanguage());
localizePage(document);
const enable=document.getElementById("enabled"), status=document.getElementById("status"), save=document.getElementById("save");
const retryConnection=document.getElementById("retry-connection"),setup=document.getElementById("setup");
let loaded=false,saving=false,savedEnabled=false;
let setupChosen=false;
let connectionRequest=0,connectionPending=false,connectionTimeout;
let statusPort,lastStatusAt=0;
function releaseStatus(port){
  if(statusPort!==port) return;
  statusPort=undefined;
  // A reply started before the disconnect cannot restore a stale connected state.
  connectionRequest++;connectionPending=false;clearTimeout(connectionTimeout);
  try {port.disconnect();} catch {}
  showConnection("unavailable");
}
function connectStatus(){
  if(statusPort&&Date.now()-lastStatusAt>6000) releaseStatus(statusPort);
  if(statusPort||!chrome.runtime.connect) return;
  try {
    const port=chrome.runtime.connect({name:"bridge-status"});statusPort=port;lastStatusAt=Date.now();
    port.onMessage.addListener(message=>{
      if(statusPort!==port) return;
      connectionRequest++;connectionPending=false;clearTimeout(connectionTimeout);
      lastStatusAt=Date.now();showConnection(message.state);
    });
    port.onDisconnect.addListener(()=>{releaseStatus(port);});
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
  if(!["connected","disabled","checking","disconnected"].includes(state)) state="unavailable";
  document.getElementById("connection").dataset.state=state;
  retryConnection.disabled=state==="checking";
  retryConnection.textContent=t(state==="checking"?"checking.connection":"extension.connection.checkAgain");
  // Automatic status updates must never override a disclosure the user opened or closed.
  if(!setupChosen&&state!=="checking"&&state!=="unavailable") setup.open=state!=="connected";
  const title={connected:t("connected.to.stream.deck"),disabled:t("sending.is.disabled"),checking:t("checking.connection"),disconnected:t("disconnected.from.stream.deck")}[state]??t("connection.unavailable");
  const detail={connected:t("extension.connection.idle"),disabled:t("enable.sending.and.save.to.check.the.connection"),checking:t("checking.the.connection.to.stream.deck"),disconnected:t("extension.connection.disconnectedHelp")}[state]??t("extension.connection.unavailableHelp");
  for(const [id,value] of [["connection-title",title],["connection-detail",detail]]) {
    const element=document.getElementById(id);if(element.textContent!==value) element.textContent=value;
  }
}
document.getElementById("setup-summary").addEventListener("click",()=>{setupChosen=true;});
retryConnection.addEventListener("click",()=>{
  connectStatus();showConnection("checking");void refreshConnection(true);
});
void refreshConnection();
connectStatus();
setInterval(()=>{
  if(statusPort) {
    if(Date.now()-lastStatusAt>6000) releaseStatus(statusPort);
    else try {statusPort.postMessage({type:"status"});} catch {releaseStatus(statusPort);}
  }
  if(!statusPort) {connectStatus();void refreshConnection();}
},5000);
function isDirty(){return loaded&&enable.checked!==savedEnabled;}
function updateControls(){
  enable.disabled=!loaded||saving;
  save.disabled=!loaded||saving||!isDirty();
}
function showSettingsStatus(message,state){status.textContent=message;status.dataset.state=state;}
updateControls();
chrome.storage.local.get(["enabled"]).then(v=>{
  savedEnabled=Boolean(v.enabled);enable.checked=savedEnabled;loaded=true;updateControls();showSettingsStatus("","idle");
}).catch(()=>{showSettingsStatus(t("extension.settings.loadFailed"),"error");});
enable.addEventListener("change",()=>{
  if(!loaded||saving) return;
  updateControls();showSettingsStatus(isDirty()?t("extension.settings.unsaved"):"",isDirty()?"dirty":"idle");
});
save.addEventListener("click",async()=>{
  if(!loaded||saving||!isDirty()) return;
  const enabled=enable.checked;
  saving=true;updateControls();showSettingsStatus(t("saving.settings"),"saving");
  try {
    await chrome.storage.local.set({enabled});savedEnabled=enabled;
    showSettingsStatus(t("settings.saved"),"saved");void refreshConnection(true);
  }
  catch {showSettingsStatus(t("extension.settings.saveFailed"),"error");}
  finally {saving=false;updateControls();}
});
