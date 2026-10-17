const enable=document.getElementById("enabled"), token=document.getElementById("token"), status=document.getElementById("status"), save=document.getElementById("save");
let loaded=false,saving=false;
function setDisabled(disabled){for(const element of [enable,token,save]) element.disabled=disabled;}
setDisabled(true);
chrome.storage.local.get(["enabled","token"]).then(v=>{
  enable.checked=Boolean(v.enabled);token.value=v.token||"";loaded=true;setDisabled(false);status.textContent="";
}).catch(()=>{status.textContent="設定を読み込めませんでした。拡張機能を再読み込みしてください。";});
save.addEventListener("click",async()=>{
  if(!loaded||saving) return;
  const value=token.value.trim();
  if(enable.checked && !/^[0-9a-f]{64}$/i.test(value)){status.textContent="認証トークンは64桁の16進文字列です。";return;}
  saving=true;setDisabled(true);status.textContent="設定を保存しています…";
  try {await chrome.storage.local.set({enabled:enable.checked,token:value.toLowerCase()});status.textContent="設定を保存しました。";}
  catch {status.textContent="設定を保存できませんでした。拡張機能を再読み込みしてください。";}
  finally {saving=false;setDisabled(false);}
});
