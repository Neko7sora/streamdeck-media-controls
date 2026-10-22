importScripts("localization.js");
const {t,setLanguage}=MediaI18n;
setLanguage(chrome.i18n.getUILanguage());
const NATIVE_HOST="dev.local.media_controls";
let nativePort,requestId=0;
let connectionState,checkingConnection;
let protocol=1,bridgeEpoch,streamStarted=false,lastContact=-Infinity,lastPostContact=-Infinity,wireGeneration=0;
const sentImages=new Set(),imageIds=new Map();
const transferringImages=new Set();
let wireSequence=0;
const commandQueues=new Map();
let queuedCommands=0;
function queueCommand(command,frameState) {
  if(!command||typeof command.id!=="string") return;
  if(queuedCommands>=32) {void post("/result",{id:command.id,ok:false}).catch(logUnavailable);return;}
  const key=`${command.tab_id}:${command.frame_id}:${command.document_id}`,generation=settingsGeneration;
  const previous=commandQueues.get(key)??Promise.resolve();queuedCommands++;
  const next=previous.then(()=>receiveCommand(command,generation,frameState)).finally(()=>{queuedCommands--;if(commandQueues.get(key)===next) commandQueues.delete(key);});
  commandQueues.set(key,next);
  return next;
}
function contact(){lastContact=Date.now();if(connectionState!=="disabled") setConnectionState("connected");}
function resetWire(){wireGeneration++;sentImages.clear();transferringImages.clear();for(const state of frames.values()) {state.sent=undefined;state.sequence=undefined;}}
function replayFrames(){for(const state of frames.values()) if(state.sample&&Date.now()-state.sample.receivedAt<15000) {state.latest??=state.sample;queueFrame(state);}drainFrames();}
async function receiveCommand(command,generation,frameState) {
  if(!command||typeof command.id!=="string"||!Number.isSafeInteger(command.tab_id)||!Number.isSafeInteger(command.frame_id)||typeof command.document_id!=="string") return;
  if(generation!==settingsGeneration) return;
  try {
    const {enabled=false}=await chrome.storage.local.get(["enabled"]);
    if(!enabled||generation!==settingsGeneration||frameState&&!currentFrame(frameState)) return;
    if(command.client_id!==undefined&&command.client_id!==await getBridgeClientId()) return;
    if(generation!==settingsGeneration||frameState&&!currentFrame(frameState)) return;
    // The content bridge and page independently revalidate document and target ID.
    let result={ok:false};
    try {result=await chrome.tabs.sendMessage(command.tab_id,{type:"MEDIA_COMMAND",command},{documentId:command.document_id,frameId:command.frame_id});} catch {}
    if(generation===settingsGeneration) await post("/result",{id:command.id,ok:result?.ok===true});
  } catch {logUnavailable();}
}
const connectionLabels={checking:t("checking.connection"),connected:t("connected.to.stream.deck"),disconnected:t("disconnected.from.stream.deck"),disabled:t("sending.is.disabled")};
const statusPorts=new Set();
function setConnectionState(state) {
  if(connectionState===state) return;
  connectionState=state;
  for(const port of statusPorts) {try {port.postMessage({state});} catch {statusPorts.delete(port);}}
  void chrome.action.setBadgeText({text:{checking:"…",connected:"ON",disconnected:"!",disabled:"OFF"}[state]});
  void chrome.action.setBadgeBackgroundColor({color:{checking:"#596579",connected:"#157a46",disconnected:"#a44800",disabled:"#596579"}[state]});
  void chrome.action.setTitle({title:`Media Bridge：${connectionLabels[state]}`});
}
const nativeRequests=new Map();
chrome.runtime.onConnect?.addListener(port=>{
  const sender=port.sender;
  if(port.name!=="bridge-status"||sender?.id!==chrome.runtime.id||sender.url?.split(/[?#]/,1)[0]!==chrome.runtime.getURL("options.html")) {port.disconnect();return;}
  if(statusPorts.size>=8) {port.disconnect();return;}
  statusPorts.add(port);port.onDisconnect.addListener(()=>statusPorts.delete(port));
  port.onMessage.addListener(message=>{if(message?.type==="status") {port.postMessage({state:connectionState});}});
  port.postMessage({state:connectionState});
});
function connectNative() {
  if(nativePort) return nativePort;
  const port=chrome.runtime.connectNative(NATIVE_HOST);nativePort=port;
  port.onMessage.addListener(message=>{
    if(nativePort!==port) return;
    if(message?.event) {
      if(message.event==="disconnected") {if(connectionState!=="disabled") setConnectionState("disconnected");lastContact=-Infinity;resetWire();return;}
      if(connectionState==="disabled") return;
      contact();
      if(message.event==="ready") {bridgeEpoch=message.epoch;resetWire();replayFrames();}
      if(message.event==="command") queueCommand(message.command);
      // An idle stream needs an end-to-end acknowledgement: an alive native
      // host alone must not keep a suspended Chrome worker marked connected.
      if(message.event==="heartbeat"&&Date.now()-lastPostContact>=5000) void post("/status",{}).catch(()=>{if(connectionState!=="disabled") setConnectionState("disconnected");});
      return;
    }
    const pending=nativeRequests.get(message?.id);if(!pending) return;
    nativeRequests.delete(message.id);clearTimeout(pending.timer);
    if(message.error) pending.reject(new Error(message.error));else {lastPostContact=Date.now();pending.resolve(message.body);}
  });
  port.onDisconnect.addListener(()=>{
    void chrome.runtime.lastError;
    if(nativePort!==port) return;
    nativePort=undefined;
    streamStarted=false;lastContact=-Infinity;resetWire();
    if(connectionState!=="disabled") setConnectionState("disconnected");
    for(const pending of nativeRequests.values()) {clearTimeout(pending.timer);pending.reject(new Error("Native host disconnected"));}
    nativeRequests.clear();
  });
  return port;
}
const cachedArtwork=new Map();
const sharedArtwork=new Map();
function trimSharedArtwork() {
  let bytes=[...sharedArtwork.values()].reduce((n,asset)=>n+(asset.data?.length??0),0);
  for(const [key,asset] of sharedArtwork) {
    if(bytes<=16_000_000&&sharedArtwork.size<=64) break;
    if(asset.pending) continue;
    bytes-=asset.data?.length??0;sharedArtwork.delete(key);
  }
}
const queuedArtwork=[];
let activeArtworkJobs=0;
function discardArtwork(key) {
  const entry=cachedArtwork.get(key);
  if(!entry) return;
  cachedArtwork.delete(key);
  if(entry.asset) {
    entry.asset.users.delete(entry);
    if(!entry.asset.users.size&&entry.asset.pending) {entry.asset.controller?.abort();sharedArtwork.delete(entry.asset.key);}
  } else entry.controller?.abort();
  const queued=queuedArtwork.indexOf(entry);
  if(queued>=0) queuedArtwork.splice(queued,1);
}
function drainArtwork() {
  while(activeArtworkJobs<8 && queuedArtwork.length) {
    const entry=queuedArtwork.shift();
    if(cachedArtwork.get(entry.key)!==entry) continue;
    activeArtworkJobs++;
    void loadArtwork(entry).then(data=>{
      if(cachedArtwork.get(entry.key)!==entry) return;
      const changed=data&&data!==entry.data;
      entry.data=data??entry.data;
      entry.expires=Date.now()+(data?300000:5000);
      if(protocol===2&&changed) {
        const state=frames.get(entry.key.replace(/^favicon:/,""));
        if(state?.sample) {state.latest??=state.sample;queueFrame(state);drainFrames();}
      }
    }).finally(()=>{entry.pending=false;activeArtworkJobs--;drainArtwork();});
  }
}
let settingsGeneration=0;
// Content scripts cannot access extension settings.
const storageReady=chrome.storage.local.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"});
let bridgeClientId,loadingClientId;
function getBridgeClientId() {
  if(bridgeClientId) return Promise.resolve(bridgeClientId);
  if(loadingClientId) return loadingClientId;
  // Persist one identity per extension profile; native host connections are temporary.
  // Initialize only when sending is enabled, and retry failed storage operations later.
  loadingClientId=(async()=>{
    await storageReady;
    const stored=(await chrome.storage.local.get(["bridgeClientId"])).bridgeClientId;
    const valid=typeof stored==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(stored);
    const id=valid?stored:crypto.randomUUID();
    if(!valid) await chrome.storage.local.set({bridgeClientId:id});
    bridgeClientId=id;return id;
  })().finally(()=>{loadingClientId=undefined;});
  return loadingClientId;
}
function checkConnection() {
  if(checkingConnection) return checkingConnection;
  if(protocol===2&&Date.now()-lastContact<10000) return Promise.resolve();
  const generation=settingsGeneration;
  checkingConnection=(async()=>{
    try {
      await storageReady;
      const {enabled=false}=await chrome.storage.local.get(["enabled"]);
      if(generation!==settingsGeneration) return;
      if(!enabled) {setConnectionState("disabled");return;}
      const response=await post("/status",{});
      if(generation===settingsGeneration&&response?.protocol===2) {
        protocol=2;
        if(bridgeEpoch!==response.epoch) {bridgeEpoch=response.epoch;resetWire();replayFrames();}
        contact();
        if(!streamStarted) {
          try {await post("/events",{});streamStarted=true;}
          catch {protocol=1;resetWire();}
        }
      }
      if(generation===settingsGeneration) setConnectionState(response?.ok===true?"connected":"disconnected");
    } catch {if(generation===settingsGeneration) setConnectionState("disconnected");}
  })().finally(()=>{checkingConnection=undefined;});
  return checkingConnection;
}
setConnectionState("checking");
void checkConnection();
setInterval(()=>{if(connectionState!=="disabled") void checkConnection();},5000);
function artworkFor(tab,media,icon=false,fallback) {
  const images=icon?media.favicon_candidates:media.artwork_candidates;
  const allowed=["image/png","image/jpeg","image/webp",...(icon?["image/x-icon","image/vnd.microsoft.icon"]:[])];
  const declared=Array.isArray(images)?images.slice(0,16):[];
  if(fallback) declared.push(fallback);
  const seen=new Set();
  const candidates=declared.flatMap(art=>{
    if(!art||typeof art.src!=="string"||art.src.length>2048) return [];
    const type=typeof art.type==="string"?art.type.split(";")[0].trim().toLowerCase():"";
    if(type&&!allowed.includes(type)) return [];
    try {
      const url=new URL(art.src);
      // Refuse internal IPs, file and extension protocols, userinfo, and redirects.
      if(url.protocol!=="https:" || url.username || url.password || (url.port&&url.port!=="443") || !url.hostname.includes(".")) return [];
      if(/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|.*\.local$)/i.test(url.hostname) || seen.has(url.href)) return [];
      seen.add(url.href);
      return [{...art,src:url.href}];
    } catch {return [];}
  });
  const parseSize = (x) => {
    const sizes=String(x.sizes??"").slice(0,100).matchAll(/(\d+)x(\d+)/gi);
    return Math.max(0,...Array.from(sizes,s=>Math.min(16384,Number(s[1]))*Math.min(16384,Number(s[2]))));
  };
  const ranked=[...candidates].sort((a,b)=>parseSize(b)-parseSize(a));
  let top=ranked.slice(0,3);
  // Reserve one of the bounded attempts for the conventional favicon, even when
  // the page declares many larger icons that fail to load.
  const conventional=fallback&&candidates.find(art=>art.src===fallback.src);
  if(conventional&&!top.includes(conventional)) top=[...ranked.slice(0,2),conventional];
  const signature=JSON.stringify([media.title,media.artist,media.album,top.map(x=>x.src)]);
  const cached=cachedArtwork.get(tab);
  if(cached?.signature===signature && (cached.pending || Date.now()<cached.expires)) return cached.data;
  // Images must not delay metadata or command polling. Keep a matching cached
  // image during refresh; newly loaded images join the next fresh page sample.
  const entry={key:tab,signature,top,icon,allowed,data:cached?.signature===signature?cached.data:undefined,pending:true};
  discardArtwork(tab);
  cachedArtwork.set(tab,entry);
  queuedArtwork.push(entry);
  if(cachedArtwork.size>64) discardArtwork(cachedArtwork.keys().next().value);
  drainArtwork();
  return entry.data;
}
async function loadArtwork(entry) {
  if(protocol!==2) return downloadArtwork(entry);
  // A new track can reuse a mutable artwork URL. Revalidate on track changes;
  // only the resulting content hash, rather than the URL, suppresses transfer.
  const key=JSON.stringify([entry.icon,entry.signature]);
  let asset=sharedArtwork.get(key);
  if(asset&&(asset.pending||asset.expires>Date.now())) {
    asset.users.add(entry);entry.asset=asset;return asset.promise;
  }
  asset={key,users:new Set([entry]),top:entry.top,icon:entry.icon,allowed:entry.allowed,pending:true};
  entry.asset=asset;sharedArtwork.set(key,asset);
  asset.promise=downloadArtwork(asset).then(data=>{asset.data=data;asset.expires=Date.now()+(data?300000:5000);return data;}).finally(()=>{asset.pending=false;trimSharedArtwork();});
  trimSharedArtwork();
  return asset.promise;
}
function validArtwork(entry) {return entry.users?sharedArtwork.get(entry.key)===entry&&entry.users.size>0:cachedArtwork.get(entry.key)===entry;}
async function downloadArtwork(entry) {
  const {top,icon,allowed}=entry;
  let data;
  for(const art of top) {
    if(!validArtwork(entry)) break;
    const controller=new AbortController();entry.controller=controller;
    const timeout=setTimeout(()=>controller.abort(),2500);
    try {
      const response=await fetch(art.src,{credentials:"omit",referrerPolicy:"no-referrer",redirect:"error",signal:controller.signal});
      if(!validArtwork(entry)) break;
      const mime=(response.headers.get("content-type")??"").split(";")[0].toLowerCase();
      const bytes=Number(response.headers.get("content-length")??0);
      if(!response.ok || !allowed.includes(mime) || bytes>350000) continue;
      const reader=response.body?.getReader();
      if(!reader) continue;
      const chunks=[];let n=0;let tooLarge=false;
      while(true) {
        const {done,value}=await reader.read();
        if(done) break;
        n+=value.length;
        if(n>350000) {tooLarge=true;await reader.cancel();break;}
        chunks.push(value);
      }
      if(tooLarge) continue;
      const raw=new Uint8Array(n);
      let offset=0;
      for(const piece of chunks) {raw.set(piece,offset);offset+=piece.length;}
      let output=raw,outputMime=mime;
      if(icon) {
        // Chrome decodes ICO as well as raster favicons; only bounded PNG leaves the worker.
        const bitmap=await createImageBitmap(new Blob([raw],{type:mime}));
        try {
          if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>16_777_216) continue;
          const canvas=new OffscreenCanvas(32,32),ctx=canvas.getContext("2d");
          const scale=Math.min(32/bitmap.width,32/bitmap.height),w=bitmap.width*scale,h=bitmap.height*scale;
          ctx.drawImage(bitmap,(32-w)/2,(32-h)/2,w,h);
          output=new Uint8Array(await (await canvas.convertToBlob({type:"image/png"})).arrayBuffer());
          outputMime="image/png";
        } finally {bitmap.close();}
      }
      let binary="";
      for(let i=0;i<output.length;i+=8192) binary+=String.fromCharCode(...output.subarray(i,i+8192));
      data=`data:${outputMime};base64,${btoa(binary)}`;
      break;
    } catch { /* image unavailable: Windows image is fallback */ }
    finally {clearTimeout(timeout);if(entry.controller===controller) entry.controller=undefined;}
  }
  return data;
}
const frames=new Map();
const queuedFrames=[];
let activeJobs=0;
let lastErrorLog=0;
function logUnavailable(){if(Date.now()-lastErrorLog>30000){lastErrorLog=Date.now();console.warn("Local media bridge unavailable; retrying on the next update.");}}
async function post(path,body) {
  const generation=settingsGeneration,clientId=await getBridgeClientId();
  if(generation!==settingsGeneration) throw new Error("Sending settings changed");
  const port=connectNative(),id=++requestId;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{nativeRequests.delete(id);reject(new Error("Native request timed out"));},4000);
    nativeRequests.set(id,{resolve,reject,timer});
    try {port.postMessage({id,path,body:{...body,client_id:clientId}});} catch(error) {nativeRequests.delete(id);clearTimeout(timer);reject(error);}
  });
}
function pageAddress(value){try{const u=new URL(value);return /^https?:$/.test(u.protocol)?u.origin+u.pathname:"";}catch{return "";}}
function currentFrame(state){return !state.closed && frames.get(state.key)===state;}
function queueFrame(state) {
  if(!currentFrame(state) || state.running || state.queued || !state.latest) return;
  state.queued=true;
  queuedFrames.push(state);
}
function drainFrames() {
  while(activeJobs<8 && queuedFrames.length) {
    const state=queuedFrames.shift();
    state.queued=false;
    if(!currentFrame(state) || !state.latest) continue;
    activeJobs++;
    state.running=true;
    // Process one sample per turn so a busy frame cannot starve other frames.
    void processFrame(state).catch(logUnavailable).finally(()=>{
      state.running=false;
      activeJobs--;
      if(currentFrame(state)) {
        if(state.latest) queueFrame(state);
        else if(protocol!==2) frames.delete(state.key);
      } else {
        discardArtwork(state.key);
        discardArtwork(`favicon:${state.key}`);
      }
      drainFrames();
    });
  }
}
async function processFrame(state) {
  const key=state.key,frame=state.frame;
  const generation=settingsGeneration;
  const update=state.latest;state.latest=null;
  await storageReady;
  const {enabled=false}=await chrome.storage.local.get(["enabled"]);
  if(!currentFrame(state) || generation!==settingsGeneration || !enabled) return;
  const media=update.media;
  if(!media || typeof media!=="object" || Array.isArray(media) || JSON.stringify(media).length>64000) return;
  if(protocol===2) state.sample=update;
  let fallbackFavicon;
  // The sender address provides the conventional fallback, never an unrelated tab/frame.
  try {const url=new URL(update.sender.url);fallbackFavicon={src:new URL("/favicon.ico",url.origin).href};} catch {}
  const hasMedia=!!media.title||!!media.artist||!!media.browser_media?.element_type;
  const artwork=hasMedia?artworkFor(key,media):undefined;
  if(!currentFrame(state) || generation!==settingsGeneration) return;
  const favicon=hasMedia?artworkFor(`favicon:${key}`,{favicon_candidates:media.favicon_candidates},true,fallbackFavicon):undefined;
  const payload={
    ...media,
    page_url:pageAddress(update.sender.url),
    page_title:update.sender.tab.title??"",
    artwork_data_url:artwork,
    app_icon_data_url:null,
    favicon_data_url:favicon
  };
  try {
    const current=await chrome.storage.local.get(["enabled"]);
    if(!currentFrame(state) || generation!==settingsGeneration || !current.enabled) return;
    const response=protocol===2?await sendDelta(state,update,payload):await post("",{tab_id:state.tab,frame_id:frame,document_id:update.sender.documentId,sequence:Date.now(),media:payload});
    if(generation!==settingsGeneration||!currentFrame(state)) return;
    if(response.skipped!==true) contact();
    // Polling can overlap a reconnecting command stream. Enqueue the whole
    // response before waiting so neither transport can overtake earlier work.
    const commands=[];
    for(const command of response.commands??[]) commands.push(queueCommand({...command,tab_id:state.tab,frame_id:frame,document_id:update.sender.documentId},state));
    await Promise.all(commands);
  } catch {if(generation===settingsGeneration) setConnectionState("disconnected");logUnavailable();}
}
chrome.runtime.onMessage.addListener((message,sender,_reply)=>{
  // Options pages can be opened in a normal tab as well as an action popup.
  // Authenticate the extension page URL; a content script also has our ID.
  if(message?.type==="BRIDGE_STATUS" && sender.id===chrome.runtime.id && typeof sender.url==="string" && sender.url.split(/[?#]/,1)[0]===chrome.runtime.getURL("options.html")) {
    void checkConnection().then(()=>_reply({state:connectionState}));
    return true;
  }
  if(message?.type!=="MEDIA_UPDATE" || !Number.isSafeInteger(sender.tab?.id)) return;
  _reply?.({protocol:protocol===2&&streamStarted?2:1});
  const frame=sender.frameId??0, key=`${sender.tab.id}:${frame}`;
  let state=frames.get(key);
  if(!state && frames.size>=256) {
    const idle=[...frames.values()].find(s=>!s.running&&!s.queued);
    if(!idle) return;
    idle.closed=true;frames.delete(idle.key);discardArtwork(idle.key);discardArtwork(`favicon:${idle.key}`);
  }
  if(!state) {state={key,tab:sender.tab.id,frame,running:false,queued:false,closed:false,latest:null};frames.set(key,state);}
  state.latest={media:message.media,sender,receivedAt:Date.now()};
  queueFrame(state);
  drainFrames();
});

async function imageId(data) {
  if(imageIds.has(data)) return imageIds.get(data);
  const bytes=new TextEncoder().encode(data),digest=await crypto.subtle.digest("SHA-256",bytes);
  const id=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  imageIds.set(data,id);
  // This is a hashing memo, not the image lifetime or transfer acknowledgement.
  let memoBytes=[...imageIds.keys()].reduce((n,s)=>n+s.length,0);
  while(imageIds.size>64||memoBytes>16_000_000) {const key=imageIds.keys().next().value;memoBytes-=key.length;imageIds.delete(key);}
  return id;
}
async function sendDelta(state,update,payload) {
  const generation=settingsGeneration,epoch=bridgeEpoch,wireVersion=wireGeneration;
  const normalized=JSON.parse(JSON.stringify(payload)),images={};
  for(const field of ["artwork_data_url","favicon_data_url"]) {
    const data=normalized[field];
    if(typeof data==="string") {const id=await imageId(data);images[id]=data;normalized[field]={image:id};}
    else normalized[field]=null;
  }
  for(let attempt=0;attempt<2;attempt++) {
    if(!currentFrame(state)||generation!==settingsGeneration||epoch!==bridgeEpoch||wireVersion!==wireGeneration) return {skipped:true};
    const previous=state.documentId===update.sender.documentId?state.sent:undefined;
    const patch={};
    for(const field of new Set([...Object.keys(previous??{}),...Object.keys(normalized)])) {
      if(!previous||JSON.stringify(previous[field])!==JSON.stringify(normalized[field])) patch[field]=normalized[field]??null;
    }
    if(previous&&!Object.keys(patch).length&&Date.now()-(state.lastSent??0)<5000) return {skipped:true};
    const sequence=wireSequence=Math.max(wireSequence+1,Date.now());
    const transfer=Object.fromEntries(Object.entries(images).filter(([id])=>!sentImages.has(id)&&!transferringImages.has(id)));
    // A different frame may already be transferring these bytes. Publish its
    // metadata now and attach the image after that transfer completes.
    const deferredImages=[];
    for(const field of ["artwork_data_url","favicon_data_url"]) {
      const id=normalized[field]?.image;
      if(id&&transferringImages.has(id)&&!sentImages.has(id)) {normalized[field]=previous?.[field]??null;patch[field]=normalized[field];deferredImages.push(id);}
    }
    for(const id of Object.keys(transfer)) transferringImages.add(id);
    let response;
    try {response=await post("",{protocol:2,tab_id:state.tab,frame_id:state.frame,document_id:update.sender.documentId,sequence,base:previous?state.sequence:null,media:patch,images:transfer});}
    finally {
      if(wireVersion===wireGeneration) for(const id of Object.keys(transfer)) transferringImages.delete(id);
    }
    if(generation!==settingsGeneration||epoch!==bridgeEpoch||wireVersion!==wireGeneration) return {skipped:true};
    if(response.resync||response.epoch&&response.epoch!==epoch) {state.sent=undefined;state.sequence=undefined;sentImages.clear();if(response.epoch&&response.epoch!==epoch) {bridgeEpoch=response.epoch;resetWire();replayFrames();return {};}continue;}
    if(response.missing) {for(const id of response.missing) sentImages.delete(id);continue;}
    if(response.ok===false) throw Error("Delta rejected");
    state.sent=normalized;state.sequence=sequence;state.documentId=update.sender.documentId;state.lastSent=Date.now();
    for(const id of Object.keys(transfer)) sentImages.add(id);
    if(Object.keys(transfer).length) replayFrames();
    if(deferredImages.length) state.waitingImages=true;
    if(sentImages.size>256) sentImages.clear();
    return response;
  }
  throw Error("Delta resynchronization failed");
}
chrome.tabs.onRemoved.addListener(id=>{
  for(const [key,state] of frames) if(state.tab===id) {
    state.closed=true;state.latest=null;frames.delete(key);
  }
  for(let i=queuedFrames.length-1;i>=0;i--) if(queuedFrames[i].tab===id) queuedFrames.splice(i,1);
  for(const key of cachedArtwork.keys()) if(key.startsWith(`${id}:`) || key.startsWith(`favicon:${id}:`)) discardArtwork(key);
  drainFrames();
});
chrome.storage.onChanged.addListener((changes,area)=>{
  for(const key of cachedArtwork.keys()) discardArtwork(key);
  // An interrupted opt-in session stays invalid even if the same settings return.
  if(area==="local" && changes.enabled) {
    settingsGeneration++;
    lastContact=-Infinity;resetWire();
    if(!changes.enabled.newValue) {
      if(streamStarted) void post("/unsubscribe",{}).catch(()=>{});
      streamStarted=false;
      for(const state of frames.values()) {state.closed=true;state.latest=null;}
      frames.clear();queuedFrames.length=0;sharedArtwork.clear();imageIds.clear();
    }
    setConnectionState(changes.enabled.newValue?"checking":"disabled");
    // Finish any old probe before checking the new opt-in generation.
    void Promise.resolve(checkingConnection).then(()=>checkConnection());
  }
});
