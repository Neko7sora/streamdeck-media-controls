import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync(new URL("../chrome-extension/background.js",import.meta.url),"utf8");
function worker(enabled=true,imageResponse){
  let listener,access;
  const requests=[],commands=[],images=[];
  const chrome={storage:{local:{async setAccessLevel(v){access=v.accessLevel;},async get(){return {enabled,token:"a".repeat(64)};}},onChanged:{addListener(){}}},runtime:{onMessage:{addListener(fn){listener=fn;}}},tabs:{onRemoved:{addListener(){}},async sendMessage(tab,message,options){commands.push({tab,message,options});return {ok:true};}}};
  const fetch=async(url,options)=>{
    if(!String(url).startsWith("http://127.0.0.1:39761/chrome")) {
      images.push({url,options});
      if(imageResponse) return imageResponse(url,options);
      return {ok:false,headers:new Headers()};
    }
    requests.push({url,options});
    assert.ok(String(url).startsWith("http://127.0.0.1:39761/chrome"));
    const body=JSON.parse(options.body);
    return {ok:true,json:async()=>({commands:String(url).endsWith("/result")?[]:[{id:"cmd",tab_id:body.tab_id,frame_id:body.frame_id,document_id:body.document_id,title:"Track",command:"play-pause"}]})};
  };
  class OffscreenCanvas {getContext(){return {drawImage(){}};}async convertToBlob(){return new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'});}}
  vm.runInNewContext(source,{chrome,fetch,URL,AbortSignal,Map,Date,Number,JSON,Uint8Array,btoa,console,Headers,Blob,OffscreenCanvas,async createImageBitmap(){return {width:32,height:32,close(){}};}});
  return {send:(media,frame=0)=>listener({type:"MEDIA_UPDATE",media},{tab:{id:4,title:"Tab"},frameId:frame,documentId:`doc-${frame}`,url:`https://user:password@site.test/frame-${frame}?access_token=private#secret`}),requests,commands,images,access:()=>access};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
test("MV3 worker uses trusted storage, routes per document, and resumes from stored opt-in after restart",async()=>{
  for(let i=0;i<2;i++){
    const w=worker();w.send({title:"Track",artwork_candidates:[null,{src:1}]},2);await settle();
    assert.equal(w.access(),"TRUSTED_CONTEXTS");assert.equal(w.requests.length,2);
    const body=JSON.parse(w.requests[0].options.body);assert.equal(body.frame_id,2);assert.equal(body.document_id,"doc-2");assert.equal(body.media.page_url,"https://site.test/frame-2");
    assert.equal(w.commands[0].options.documentId,"doc-2");assert.equal(JSON.stringify(w.commands).includes("a".repeat(64)),false);
  }
});
test("disabled extension sends neither metadata nor artwork requests",async()=>{
  const w=worker(false);w.send({title:"Track",artwork_candidates:[{src:"https://cdn.test/a.png"}],favicon_candidates:[{src:"https://cdn.test/favicon.ico"}]});await settle();assert.equal(w.requests.length,0);assert.equal(w.images.length,0);
});

test('worker normalizes ICO favicons, caches them separately, and ignores forged image fields',async()=>{
 const w=worker(true,()=>new Response(new Uint8Array([0,0,1,0]),{headers:{'content-type':'image/x-icon'}}));
 const media={title:'Track',favicon_candidates:[{src:'https://cdn.test/site.ico',sizes:'32x32'}],favicon_data_url:'forged',app_icon_data_url:'forged'};
 w.send(media);await settle();
 const payload=JSON.parse(w.requests[0].options.body).media;
 assert.match(payload.favicon_data_url,/^data:image\/png;base64,/);assert.equal(payload.app_icon_data_url,null);
 assert.equal(payload.artwork_data_url,undefined);assert.equal(w.images.length,1);
 assert.equal(w.images[0].options.credentials,'omit');assert.equal(w.images[0].options.redirect,'error');
 w.send({...media,title:'Next track'});await settle();assert.equal(w.images.length,1);
});

test('unsafe favicon URLs are skipped and the sender origin supplies favicon.ico',async()=>{
 const w=worker();w.send({title:'Track',favicon_candidates:[{src:'https://127.0.0.1/a.ico'},{src:'file:///secret.ico'}]});await settle();
 assert.deepEqual(w.images.map(x=>x.url),['https://site.test/favicon.ico']);
 assert.equal(JSON.parse(w.requests[0].options.body).media.favicon_data_url,undefined);
});
