const enable=document.getElementById("enabled"), status=document.getElementById("status"), save=document.getElementById("save");
let loaded=false,saving=false;
function setDisabled(disabled){for(const element of [enable,save]) element.disabled=disabled;}
setDisabled(true);
chrome.storage.local.get(["enabled"]).then(v=>{
  enable.checked=Boolean(v.enabled);loaded=true;setDisabled(false);status.textContent="";
}).catch(()=>{status.textContent="設定を読み込めませんでした。拡張機能を再読み込みしてください。";});
save.addEventListener("click",async()=>{
  if(!loaded||saving) return;
  saving=true;setDisabled(true);status.textContent="設定を保存しています…";
  try {await chrome.storage.local.set({enabled:enable.checked});status.textContent="設定を保存しました。";}
  catch {status.textContent="設定を保存できませんでした。拡張機能を再読み込みしてください。";}
  finally {saving=false;setDisabled(false);}
});
