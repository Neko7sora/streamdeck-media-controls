import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync(new URL("../chrome-extension/background.js",import.meta.url),"utf8");
function worker(enabled=true){
  let listener,access;
  const requests=[],commands=[];
  const chrome={storage:{local:{async setAccessLevel(v){access=v.accessLevel;},async get(){return {enabled,token:"a".repeat(64)};}},onChanged:{addListener(){}}},runtime:{onMessage:{addListener(fn){listener=fn;}}},tabs:{onRemoved:{addListener(){}},async sendMessage(tab,message,options){commands.push({tab,message,options});return {ok:true};}}};
  const fetch=async(url,options)=>{
    requests.push({url,options});
    assert.ok(String(url).startsWith("http://127.0.0.1:39761/chrome"));
    const body=JSON.parse(options.body);
    return {ok:true,json:async()=>({commands:String(url).endsWith("/result")?[]:[{id:"cmd",tab_id:body.tab_id,frame_id:body.frame_id,document_id:body.document_id,title:"Track",command:"play-pause"}]})};
  };
  vm.runInNewContext(source,{chrome,fetch,URL,AbortSignal,Map,Date,Number,JSON,Uint8Array,btoa,console});
  return {send:(media,frame=0)=>listener({type:"MEDIA_UPDATE",media},{tab:{id:4,title:"Tab"},frameId:frame,documentId:`doc-${frame}`,url:`https://user:password@site.test/frame-${frame}?access_token=private#secret`}),requests,commands,access:()=>access};
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
  const w=worker(false);w.send({title:"Track",artwork_candidates:[{src:"https://cdn.test/a.png"}]});await settle();assert.equal(w.requests.length,0);
});
