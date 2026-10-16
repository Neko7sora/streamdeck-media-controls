const ENDPOINT="http://127.0.0.1:39761/chrome";
const cachedArtwork=new Map();
async function artworkFor(tab,media) {
  const candidates=Array.isArray(media.artwork_candidates) ? media.artwork_candidates : [];
  const parseSize = (x) => {
    const size=String(x.sizes??"").match(/(\d+)x(\d+)/i);
    return size ? Number(size[1])*Number(size[2]) : 0;
  };
  const top = [...candidates].sort((a,b)=>parseSize(b)-parseSize(a)).slice(0,3);
  const signature=top.map(x=>x.src).join("|");
  const cached=cachedArtwork.get(tab);
  if(cached?.signature===signature) return cached.data;
  let data;
  for(const art of top) {
    try {
      const url=new URL(art.src);
      // Refuse internal IPs, file and extension protocols, userinfo, and redirects.
      if(url.protocol!=="https:" || url.username || url.password) continue;
      if(/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|.*\.local$)/i.test(url.hostname)) continue;
      const response=await fetch(url.href,{credentials:"omit",redirect:"error",signal:AbortSignal.timeout(2500)});
      const mime=(response.headers.get("content-type")??"").split(";")[0].toLowerCase();
      const bytes=Number(response.headers.get("content-length")??0);
      if(!response.ok || !["image/png","image/jpeg","image/webp"].includes(mime) || bytes>350000) continue;
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
      let binary="";
      for(let i=0;i<raw.length;i+=8192) binary+=String.fromCharCode(...raw.subarray(i,i+8192));
      data=`data:${mime};base64,${btoa(binary)}`;
      break;
    } catch { /* image unavailable: Windows image is fallback */ }
  }
  cachedArtwork.set(tab,{signature,data});
  return data;
}
chrome.runtime.onMessage.addListener((message,sender)=>{
  if(message?.type!=="MEDIA_UPDATE" || !Number.isSafeInteger(sender.tab?.id)) return;
  void (async()=>{
    const {enabled=false,token=""}=await chrome.storage.local.get(["enabled","token"]);
    if(!enabled || !/^[a-f0-9]{64}$/.test(token)) return;
    const media=message.media;
    if(!media || typeof media!=="object") return;
    const payload={
      ...media,
      page_url:sender.tab.url??"",
      page_title:sender.tab.title??"",
      artwork_data_url:await artworkFor(sender.tab.id,media)
    };
    try {
      await fetch(ENDPOINT,{
        method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${token}`},
        body:JSON.stringify({tab_id:sender.tab.id,media:payload}),signal:AbortSignal.timeout(2000)
      });
    } catch { /* plugin not running */ }
  })();
});
chrome.tabs?.onRemoved?.addListener(id=>cachedArtwork.delete(id));
