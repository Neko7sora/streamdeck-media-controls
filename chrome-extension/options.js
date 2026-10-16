const enable=document.getElementById("enabled"), token=document.getElementById("token"), status=document.getElementById("status");
chrome.storage.local.get(["enabled","token"]).then(v=>{enable.checked=Boolean(v.enabled);token.value=v.token||"";}).catch(()=>{status.textContent="設定を読み込めませんでした。拡張機能を再読み込みしてください。";});
document.getElementById("save").addEventListener("click",async()=>{
  const value=token.value.trim();
  if(enable.checked && !/^[0-9a-f]{64}$/i.test(value)){status.textContent="認証トークンは64桁の16進文字列です。";return;}
  try {await chrome.storage.local.set({enabled:enable.checked,token:value.toLowerCase()});status.textContent="設定を保存しました。";}
  catch {status.textContent="設定を保存できませんでした。拡張機能を再読み込みしてください。";}
});
