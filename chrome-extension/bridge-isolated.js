(() => {
  const tag="__streamdeck_media_metadata_v1__",pending=new Map();
  let lastSent=0;
  window.addEventListener("message",event=>{
    if(event.source!==window||event.origin!==location.origin) return;
    if(event.data?.kind===tag+"_result") {
      const done=pending.get(event.data.id);if(done) {pending.delete(event.data.id);done({ok:event.data.ok===true});}
    }
    if(event.data?.kind!==tag||Date.now()-lastSent<250) return;
    lastSent=Date.now();
    // A page may forge MAIN-world messages. Treat every field as untrusted.
    try {if(JSON.stringify(event.data.media).length>64000) return;} catch {return;}
    chrome.runtime.sendMessage({type:"MEDIA_UPDATE",media:event.data.media}).catch(()=>{});
  });
  chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
    if(message?.type!=="MEDIA_COMMAND") return;
    const c=message.command;
    if(!c||typeof c.id!=="string") return;
    const timer=setTimeout(()=>{pending.delete(c.id);reply({ok:false});},2000);
    pending.set(c.id,result=>{clearTimeout(timer);reply(result);});
    window.postMessage({kind:tag+"_command",command:c},location.origin);
    return true;
  });
})();
