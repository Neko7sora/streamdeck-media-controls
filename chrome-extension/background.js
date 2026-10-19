const NATIVE_HOST="dev.local.media_controls";
let nativePort,requestId=0;
let connectionState,checkingConnection;
const connectionLabels={checking:"接続を確認中",connected:"Stream Deck に接続済み",disconnected:"Stream Deck に未接続",disabled:"送信は無効です"};
function setConnectionState(state) {
  if(connectionState===state) return;
  connectionState=state;
  void chrome.action.setBadgeText({text:{checking:"…",connected:"ON",disconnected:"!",disabled:"OFF"}[state]});
  void chrome.action.setBadgeBackgroundColor({color:{checking:"#596579",connected:"#157a46",disconnected:"#a44800",disabled:"#596579"}[state]});
  void chrome.action.setTitle({title:`Media Bridge：${connectionLabels[state]}`});
}
const nativeRequests=new Map();
function connectNative() {
  if(nativePort) return nativePort;
  const port=chrome.runtime.connectNative(NATIVE_HOST);nativePort=port;
  port.onMessage.addListener(message=>{
    const pending=nativeRequests.get(message?.id);if(!pending) return;
    nativeRequests.delete(message.id);clearTimeout(pending.timer);
    if(message.error) pending.reject(new Error(message.error));else pending.resolve(message.body);
  });
  port.onDisconnect.addListener(()=>{
    void chrome.runtime.lastError;
    if(nativePort!==port) return;
    nativePort=undefined;
    if(connectionState!=="disabled") setConnectionState("disconnected");
    for(const pending of nativeRequests.values()) {clearTimeout(pending.timer);pending.reject(new Error("Native host disconnected"));}
    nativeRequests.clear();
  });
  return port;
}
const cachedArtwork=new Map();
let settingsGeneration=0;
// Content scripts cannot access extension settings.
const storageReady=chrome.storage.local.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"});
function checkConnection() {
  if(checkingConnection) return checkingConnection;
  const generation=settingsGeneration;
  checkingConnection=(async()=>{
    try {
      await storageReady;
      const {enabled=false}=await chrome.storage.local.get(["enabled"]);
      if(generation!==settingsGeneration) return;
      if(!enabled) {setConnectionState("disabled");return;}
      const response=await post("/status",{});
      if(generation===settingsGeneration) setConnectionState(response?.ok===true?"connected":"disconnected");
    } catch {if(generation===settingsGeneration) setConnectionState("disconnected");}
  })().finally(()=>{checkingConnection=undefined;});
  return checkingConnection;
}
setConnectionState("checking");
void checkConnection();
setInterval(()=>{if(connectionState!=="disabled") void checkConnection();},5000);
async function artworkFor(tab,media,icon=false,fallback) {
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
  if(cached?.signature===signature && Date.now()<cached.expires) return cached.data;
  let data;
  for(const art of top) {
    try {
      const response=await fetch(art.src,{credentials:"omit",referrerPolicy:"no-referrer",redirect:"error",signal:AbortSignal.timeout(2500)});
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
  }
  cachedArtwork.set(tab,{signature,data,expires:Date.now()+(data?300000:5000)});
  if(cachedArtwork.size>64) cachedArtwork.delete(cachedArtwork.keys().next().value);
  return data;
}
const frames=new Map();
const queuedFrames=[];
let activeJobs=0;
let lastErrorLog=0;
function logUnavailable(){if(Date.now()-lastErrorLog>30000){lastErrorLog=Date.now();console.warn("Local media bridge unavailable; retrying on the next update.");}}
async function post(path,body) {
  const port=connectNative(),id=++requestId;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{nativeRequests.delete(id);reject(new Error("Native request timed out"));},4000);
    nativeRequests.set(id,{resolve,reject,timer});
    try {port.postMessage({id,path,body});} catch(error) {nativeRequests.delete(id);clearTimeout(timer);reject(error);}
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
        else frames.delete(state.key);
      } else {
        cachedArtwork.delete(state.key);
        cachedArtwork.delete(`favicon:${state.key}`);
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
  let fallbackFavicon;
  // The sender address provides the conventional fallback, never an unrelated tab/frame.
  try {const url=new URL(update.sender.url);fallbackFavicon={src:new URL("/favicon.ico",url.origin).href};} catch {}
  const artwork=await artworkFor(key,media);
  if(!currentFrame(state) || generation!==settingsGeneration) return;
  const favicon=await artworkFor(`favicon:${key}`,{favicon_candidates:media.favicon_candidates},true,fallbackFavicon);
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
    const response=await post("",{tab_id:state.tab,frame_id:frame,document_id:update.sender.documentId,sequence:Date.now(),media:payload});
    if(generation===settingsGeneration) setConnectionState("connected");
    for(const command of response.commands??[]) {
      const current=await chrome.storage.local.get(["enabled"]);
      if(!currentFrame(state) || generation!==settingsGeneration || !current.enabled) return;
      let result={ok:false};
      try {result=await chrome.tabs.sendMessage(state.tab,{type:"MEDIA_COMMAND",command},{documentId:update.sender.documentId,frameId:frame});} catch {}
      await post("/result",{id:command.id,ok:result?.ok===true});
    }
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
  const frame=sender.frameId??0, key=`${sender.tab.id}:${frame}`;
  let state=frames.get(key);
  if(!state && frames.size>=256) return;
  if(!state) {state={key,tab:sender.tab.id,frame,running:false,queued:false,closed:false,latest:null};frames.set(key,state);}
  state.latest={media:message.media,sender};
  queueFrame(state);
  drainFrames();
});
chrome.tabs.onRemoved.addListener(id=>{
  for(const [key,state] of frames) if(state.tab===id) {
    state.closed=true;state.latest=null;frames.delete(key);
  }
  for(let i=queuedFrames.length-1;i>=0;i--) if(queuedFrames[i].tab===id) queuedFrames.splice(i,1);
  for(const key of cachedArtwork.keys()) if(key.startsWith(`${id}:`) || key.startsWith(`favicon:${id}:`)) cachedArtwork.delete(key);
  drainFrames();
});
chrome.storage.onChanged.addListener((changes,area)=>{
  cachedArtwork.clear();
  // An interrupted opt-in session stays invalid even if the same settings return.
  if(area==="local" && changes.enabled) {
    settingsGeneration++;
    setConnectionState(changes.enabled.newValue?"checking":"disabled");
    // Finish any old probe before checking the new opt-in generation.
    void Promise.resolve(checkingConnection).then(()=>checkConnection());
  }
});
