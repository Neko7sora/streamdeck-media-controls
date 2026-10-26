(() => {
  // Match the MAIN-world guard: opaque sandboxed frames cannot use this bridge.
  const origin=window.origin;
  if(!origin || origin==="null" || origin!==location.origin) return;
  const tag="__streamdeck_media_metadata_v1__",pending=new Map();
  let lastSent=-Infinity,latestMedia,updateTimer;
  async function sendLatest() {
    updateTimer=undefined;
    lastSent=Date.now();
    const media=latestMedia;latestMedia=undefined;
    // Reloading/disabling the extension can invalidate scripts in existing tabs.
    // sendMessage may throw synchronously, before it returns a Promise.
    try {
      const response=await chrome.runtime.sendMessage({type:"MEDIA_UPDATE",media});
      window.postMessage?.({kind:tag+"_transport",protocol:response?.protocol===2?2:1},origin);
    } catch {}
  }
  window.addEventListener("message",async event=>{
    if(event.source!==window||event.origin!==origin) return;
    if(event.data?.kind===tag+"_result") {
      const done=pending.get(event.data.id);if(done) {pending.delete(event.data.id);done({ok:event.data.ok===true});}
    }
    if(event.data?.kind!==tag) return;
    // A page may forge MAIN-world messages. Treat every field as untrusted.
    try {if(JSON.stringify(event.data.media).length>64000) return;} catch {return;}
    latestMedia=event.data.media;
    const delay=250-(Date.now()-lastSent);
    if(delay<=0) {
      if(updateTimer!==undefined) clearTimeout(updateTimer);
      await sendLatest();
    } else if(updateTimer===undefined) {
      // Preserve the final pause/seek update in a burst instead of waiting for a heartbeat.
      updateTimer=setTimeout(sendLatest,delay);
    }
  });
  chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
    if(message?.type!=="MEDIA_COMMAND") return;
    const c=message.command;
    if(!c||typeof c.id!=="string") return;
    const timer=setTimeout(()=>{pending.delete(c.id);reply({ok:false});},2000);
    pending.set(c.id,result=>{clearTimeout(timer);reply(result);});
    window.postMessage({kind:tag+"_command",command:c},origin);
    return true;
  });
})();
