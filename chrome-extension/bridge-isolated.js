(() => {
  window.addEventListener("message",event=>{
    if(event.source!==window || event.origin!==location.origin) return;
    if(!event.data || event.data.kind!=="__streamdeck_media_metadata_v1__") return;
    chrome.runtime.sendMessage({type:"MEDIA_UPDATE",media:event.data.media}).catch(()=>{});
  });
})();
