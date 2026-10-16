const ENDPOINT="http://127.0.0.1:39761/chrome";
const cachedArtwork=new Map();
// Content scripts never receive the pairing token.
const storageReady=chrome.storage.local.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"});
async function artworkFor(tab,media,icon=false) {
  const images=icon?media.favicon_candidates:media.artwork_candidates;
  const candidates=Array.isArray(images) ? images.slice(0,16).filter(a=>a&&typeof a.src==="string"&&a.src.length<=2048) : [];
  const parseSize = (x) => {
    const sizes=String(x.sizes??"").slice(0,100).matchAll(/(\d+)x(\d+)/gi);
    return Math.max(0,...Array.from(sizes,s=>Math.min(16384,Number(s[1]))*Math.min(16384,Number(s[2]))));
  };
  const top = [...candidates].sort((a,b)=>parseSize(b)-parseSize(a)).slice(0,3);
  const signature=JSON.stringify([media.title,media.artist,media.album,top.map(x=>x.src)]);
  const cached=cachedArtwork.get(tab);
  if(cached?.signature===signature && Date.now()<cached.expires) return cached.data;
  let data;
  for(const art of top) {
    try {
      const url=new URL(art.src);
      // Refuse internal IPs, file and extension protocols, userinfo, and redirects.
      if(url.protocol!=="https:" || url.username || url.password || (url.port&&url.port!=="443") || !url.hostname.includes(".")) continue;
      if(/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|.*\.local$)/i.test(url.hostname)) continue;
      const response=await fetch(url.href,{credentials:"omit",referrerPolicy:"no-referrer",redirect:"error",signal:AbortSignal.timeout(2500)});
      const mime=(response.headers.get("content-type")??"").split(";")[0].toLowerCase();
      const bytes=Number(response.headers.get("content-length")??0);
      const allowed=["image/png","image/jpeg","image/webp",...(icon?["image/x-icon","image/vnd.microsoft.icon"]:[])];
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
let activeJobs=0;
let lastErrorLog=0;
function logUnavailable(){if(Date.now()-lastErrorLog>30000){lastErrorLog=Date.now();console.warn("Local media bridge unavailable; retrying on the next update.");}}
async function post(path,token,body) {
  const r=await fetch(ENDPOINT+path,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(2000)});
  if(!r.ok) throw new Error(`Local bridge HTTP ${r.status}`);
  return r.json();
}
function pageAddress(value){try{const u=new URL(value);return /^https?:$/.test(u.protocol)?u.origin+u.pathname:"";}catch{return "";}}
chrome.runtime.onMessage.addListener((message,sender,_reply)=>{
  if(message?.type!=="MEDIA_UPDATE" || !Number.isSafeInteger(sender.tab?.id)) return;
  const frame=sender.frameId??0, key=`${sender.tab.id}:${frame}`;
  let state=frames.get(key);
  if(!state && frames.size>=256) return;
  if(!state) {state={running:false,latest:null};frames.set(key,state);}
  state.latest={media:message.media,sender};
  if(state.running) return;
  if(activeJobs>=8) return;
  activeJobs++;
  state.running=true;
  void (async()=>{try {while(state.latest) {
    const update=state.latest;state.latest=null;
    await storageReady;
    const {enabled=false,token=""}=await chrome.storage.local.get(["enabled","token"]);
    if(!enabled || !/^[a-f0-9]{64}$/.test(token)) continue;
    const media=update.media;
    if(!media || typeof media!=="object" || Array.isArray(media) || JSON.stringify(media).length>64000) continue;
    const faviconCandidates=Array.isArray(media.favicon_candidates)?media.favicon_candidates.slice(0,16):[];
    // The sender address provides the conventional fallback, never an unrelated tab/frame.
    try {const url=new URL(update.sender.url);faviconCandidates.push({src:new URL("/favicon.ico",url.origin).href});} catch {}
    const payload={
      ...media,
      page_url:pageAddress(update.sender.url),
      page_title:update.sender.tab.title??"",
      artwork_data_url:await artworkFor(key,media),
      app_icon_data_url:null,
      favicon_data_url:await artworkFor(`favicon:${key}`,{favicon_candidates:faviconCandidates},true)
    };
    try {
      const current=await chrome.storage.local.get(["enabled","token"]);
      if(!current.enabled || current.token!==token) continue;
      const response=await post("",token,{tab_id:sender.tab.id,frame_id:frame,document_id:update.sender.documentId,sequence:Date.now(),media:payload});
      for(const command of response.commands??[]) {
        let result={ok:false};
        try {result=await chrome.tabs.sendMessage(sender.tab.id,{type:"MEDIA_COMMAND",command},{documentId:update.sender.documentId,frameId:frame});} catch {}
        await post("/result",token,{id:command.id,ok:result?.ok===true});
      }
    } catch {logUnavailable();}
  }} finally {state.running=false;activeJobs--;}})().catch(()=>{state.running=false;logUnavailable();});
  if(frames.size>256) {for(const [k,v] of frames) if(!v.running) {frames.delete(k);break;}}
});
chrome.tabs.onRemoved.addListener(id=>{for(const key of frames.keys()) if(key.startsWith(`${id}:`)) {frames.delete(key);cachedArtwork.delete(key);cachedArtwork.delete(`favicon:${key}`);}});
chrome.storage.onChanged.addListener(()=>cachedArtwork.clear());
