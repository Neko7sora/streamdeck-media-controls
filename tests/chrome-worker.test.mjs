import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync(new URL("../chrome-extension/background.js",import.meta.url),"utf8");
function worker(enabled=true,imageResponse,hooks={}){
  let listener,access,removed,settingsChanged,disconnect,pulse;
  let connections=0;
  const settings={enabled,token:"a".repeat(64)};
  const requests=[],commands=[],images=[],probes=[],badges=[];
  const chrome={storage:{local:{async setAccessLevel(v){access=v.accessLevel;},async get(){return {...settings};}},onChanged:{addListener(fn){settingsChanged=fn;}}},runtime:{onMessage:{addListener(fn){listener=fn;}}},tabs:{onRemoved:{addListener(fn){removed=fn;}},async sendMessage(tab,message,options){commands.push({tab,message,options});if(hooks.sendMessage) return hooks.sendMessage(tab,message,options);return {ok:true};}}};
  const fetch=async(url,options)=>{
    if(!String(url).startsWith("http://127.0.0.1:39761/chrome")) {
      images.push({url,options});
      if(imageResponse) return imageResponse(url,options);
      return {ok:false,headers:new Headers()};
    }
    if(String(url).endsWith('/status')) {
      probes.push({url,options});
      return hooks.statusResponse?hooks.statusResponse():{ok:true,json:async()=>({ok:true})};
    }
    requests.push({url,options});
    assert.ok(String(url).startsWith("http://127.0.0.1:39761/chrome"));
    const body=JSON.parse(options.body);
    if(hooks.bridgeResponse) return hooks.bridgeResponse(url,body);
    return {ok:true,json:async()=>({commands:String(url).endsWith("/result")?[]:[{id:"cmd",tab_id:body.tab_id,frame_id:body.frame_id,document_id:body.document_id,title:"Track",command:"play-pause"}]})};
  };
  chrome.runtime.connectNative=name=>{
    assert.equal(name,'dev.local.media_controls');connections++;
    let receive;
    return {onMessage:{addListener(fn){receive=fn;}},onDisconnect:{addListener(fn){disconnect=fn;}},postMessage(message){
      const url='http://127.0.0.1:39761/chrome'+message.path;
      void fetch(url,{body:JSON.stringify(message.body)}).then(r=>r.json()).then(body=>receive({id:message.id,body}),()=>receive({id:message.id,error:'unavailable'}));
    }};
  };
  class OffscreenCanvas {getContext(){return {drawImage(){}};}async convertToBlob(){return new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'});}}
  chrome.runtime.id='extension-id';
  chrome.runtime.getURL=path=>`chrome-extension://extension-id/${path}`;
  chrome.action={async setBadgeText(value){badges.push(value.text);},async setBadgeBackgroundColor(){},async setTitle(){}};
  vm.runInNewContext(source,{chrome,fetch,setTimeout,clearTimeout,setInterval(fn){pulse=fn;},URL,AbortSignal,Map,Date,Number,JSON,Uint8Array,btoa,console,Headers,Blob,OffscreenCanvas,async createImageBitmap(){return {width:32,height:32,close(){}};}});
  const status=()=>new Promise(resolve=>listener({type:'BRIDGE_STATUS'},{id:chrome.runtime.id,url:chrome.runtime.getURL('options.html')},resolve));
  hooks.inspect?.({probes,badges,status,pulse:()=>pulse(),message:(message,sender,reply)=>listener(message,sender,reply)});
  return {disconnect:()=>disconnect(),connections:()=>connections,send:(media,frame=0,tab=4)=>listener({type:"MEDIA_UPDATE",media},{tab:{id:tab,title:"Tab"},frameId:frame,documentId:`doc-${frame}`,url:`https://user:password@site.test/frame-${frame}?access_token=private#secret`}),remove:id=>removed(id),changeSettings(values){const changes={};for(const [key,value] of Object.entries(values)) {changes[key]={oldValue:settings[key],newValue:value};settings[key]=value;}settingsChanged(changes,"local");},requests,commands,images,access:()=>access};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
const flush=()=>new Promise(setImmediate);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
test('connection badges probe without media, recover from failures, and stop probing when disabled',async()=>{
  let ui,fail=false;
  const w=worker(true,undefined,{inspect(value){ui=value;},async statusResponse(){if(fail) throw Error('offline');return {json:async()=>({ok:true})};}});
  await flush();
  assert.equal(ui.badges.at(-1),'ON');assert.equal(w.requests.length,0);assert.equal(w.images.length,0);
  assert.deepEqual(JSON.parse(ui.probes[0].options.body),{});
  fail=true;ui.pulse();await flush();assert.equal(ui.badges.at(-1),'!');
  fail=false;assert.equal((await ui.status()).state,'connected');assert.equal(ui.badges.at(-1),'ON');
  w.changeSettings({enabled:false});await flush();
  const count=ui.probes.length;ui.pulse();await flush();
  assert.equal(ui.probes.length,count);assert.equal(ui.badges.at(-1),'OFF');
  w.disconnect();assert.equal(ui.badges.at(-1),'OFF');
  w.changeSettings({enabled:true});await flush();assert.equal(ui.badges.at(-1),'ON');
});

test('an old successful probe cannot mark a disabled opt-in session connected',async()=>{
  const gate=deferred();let ui;
  const w=worker(true,undefined,{inspect(value){ui=value;},async statusResponse(){await gate.promise;return {json:async()=>({ok:true})};}});
  await flush();w.changeSettings({enabled:false});gate.resolve();await flush();
  assert.equal(ui.badges.at(-1),'OFF');assert.equal((await ui.status()).state,'disabled');
  const count=ui.probes.length;
  assert.equal(ui.message({type:'BRIDGE_STATUS'},{id:'extension-id',tab:{id:1}},()=>assert.fail('Content scripts cannot probe')),undefined);
  await flush();assert.equal(ui.probes.length,count);
});

test('both tab and popup options can read status while content scripts and other extensions cannot',async()=>{
  let ui;worker(true,undefined,{inspect(value){ui=value;}});await flush();
  for(const tab of [undefined,{id:42}]) {
    const reply=await new Promise(resolve=>{
      const keepAlive=ui.message({type:'BRIDGE_STATUS'},{id:'extension-id',url:'chrome-extension://extension-id/options.html?view=settings#connection',tab},resolve);
      assert.equal(keepAlive,true,'a trusted options tab must receive a response');
    });
    assert.equal(reply.state,'connected');
  }
  const before=ui.probes.length;
  for(const sender of [
    {id:'extension-id',url:'https://site.test/options.html',tab:{id:1}},
    {id:'extension-id',url:'https://site.test/',tab:undefined},
    {id:'other-extension',url:'chrome-extension://extension-id/options.html'},
    {id:'extension-id',url:'chrome-extension://other-extension/options.html'},
    {id:'extension-id',url:'chrome-extension://extension-id/options.html/forged'},
    {id:'extension-id'}
  ]) assert.equal(ui.message({type:'BRIDGE_STATUS'},sender,()=>assert.fail('untrusted sender')),undefined);
  await flush();assert.equal(ui.probes.length,before);
});
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

test('settings changes discard commands returned to an earlier opt-in session',async()=>{
 for(const change of ['disable','disable-enable']) {
  const gate=deferred();
  const w=worker(true,undefined,{async bridgeResponse(url,body){
   if(url.endsWith('/result')) return {ok:true,json:async()=>({})};
   await gate.promise;
   return {ok:true,json:async()=>({commands:[{id:'old',title:'Track',command:'play-pause',tab_id:body.tab_id,frame_id:body.frame_id,document_id:body.document_id}]})};
  }});
  w.send({title:'Track'});await flush();assert.equal(w.requests.length,1);
  if(change.startsWith('token')) {w.changeSettings({token:'b'.repeat(64)});if(change==='token-restore') w.changeSettings({token:'a'.repeat(64)});}
  else {w.changeSettings({enabled:false});if(change==='disable-enable') w.changeSettings({enabled:true});}
  gate.resolve();await flush();
  assert.equal(w.commands.length,0,change);
  assert.equal(w.requests.length,1,change);
  if(change==='disable') w.changeSettings({enabled:true});
  w.send({title:'Track'});await flush();
  assert.equal(w.commands.length,1,`${change}: fresh samples resume`);
 }
});

test('disabling while one command runs prevents dispatch of later commands',async()=>{
 const gate=deferred();
 const w=worker(true,undefined,{
  async bridgeResponse(url){return {ok:true,json:async()=>({commands:url.endsWith('/result')?[]:[{id:'first',title:'Track',command:'play-pause'},{id:'second',title:'Track',command:'stop'}]})};},
  async sendMessage(){await gate.promise;return {ok:true};}
 });
 w.send({title:'Track'});await flush();assert.equal(w.commands.length,1);
 w.changeSettings({enabled:false});gate.resolve();await flush();
 assert.equal(w.commands.length,1);
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

test('unsafe URLs and unsupported declared formats do not displace usable artwork',async()=>{
 const w=worker(true,url=>url==='https://cdn.test/album.png'
  ?new Response(new Uint8Array([137,80,78,71]),{headers:{'content-type':'image/png'}})
  :{ok:false,headers:new Headers()});
 w.send({title:'Track',artwork_candidates:[
  {src:'https://127.0.0.1/private.png',sizes:'2048x2048'},
  {src:'https://cdn.test/album.svg',sizes:'1024x1024',type:'image/svg+xml'},
  {src:'https://user:secret@cdn.test/private.png',sizes:'512x512'},
  {src:'https://cdn.test/album.png',sizes:'128x128',type:'image/png'}
 ]});await settle();
 assert.deepEqual(w.images.map(x=>x.url),['https://cdn.test/album.png','https://site.test/favicon.ico']);
 assert.match(JSON.parse(w.requests[0].options.body).media.artwork_data_url,/^data:image\/png;base64,/);
});

test('a full set of broken page icons still tries the conventional favicon within three requests',async()=>{
 const w=worker(true,url=>url==='https://site.test/favicon.ico'
  ?new Response(new Uint8Array([0,0,1,0]),{headers:{'content-type':'image/x-icon'}})
  :{ok:false,headers:new Headers()});
 w.send({title:'Track',favicon_candidates:Array.from({length:16},(_,index)=>({src:`https://cdn.test/icon-${index}.png`,sizes:`${1024-index}x${1024-index}`}))});await settle();
 assert.deepEqual(w.images.map(x=>x.url),['https://cdn.test/icon-0.png','https://cdn.test/icon-1.png','https://site.test/favicon.ico']);
 assert.match(JSON.parse(w.requests[0].options.body).media.favicon_data_url,/^data:image\/png;base64,/);
});

test('duplicate image URLs consume only one candidate and one request',async()=>{
 const w=worker(true,url=>url==='https://cdn.test/working.png'
  ?new Response(new Uint8Array([0,0,1,0]),{headers:{'content-type':'image/png'}})
  :{ok:false,headers:new Headers()});
 w.send({title:'Track',favicon_candidates:[
  ...Array.from({length:3},()=>({src:'https://cdn.test/broken.png',sizes:'512x512'})),
  {src:'https://cdn.test/working.png',sizes:'32x32'}
 ]});await settle();
 assert.deepEqual(w.images.map(x=>x.url),['https://cdn.test/broken.png','https://cdn.test/working.png']);
 assert.match(JSON.parse(w.requests[0].options.body).media.favicon_data_url,/^data:image\/png;base64,/);
});

test('queued ninth frame drains after a slot opens without another update',async()=>{
 const gate=deferred();
 const w=worker(true,undefined,{async bridgeResponse(){await gate.promise;return {ok:true,json:async()=>({commands:[]})};}});
 for(let frame=0;frame<9;frame++) w.send({title:`Track ${frame}`},frame);
 await flush();assert.equal(w.requests.length,8);
 gate.resolve();await flush();
 assert.equal(w.requests.length,9);
 assert.equal(JSON.parse(w.requests.at(-1).options.body).frame_id,8);
});

test('completed frames release their slots before the frame limit is reached',async()=>{
 const w=worker(true,undefined,{bridgeResponse:async()=>({ok:true,json:async()=>({commands:[]})})});
 for(let frame=0;frame<300;frame++) {w.send({title:`Track ${frame}`},frame);await flush();}
 assert.equal(w.requests.length,300);
 assert.equal(JSON.parse(w.requests.at(-1).options.body).frame_id,299);
});

test('closed tabs cancel queued and coalesced samples and skip returned commands',async()=>{
 const gate=deferred();
 const w=worker(true,undefined,{async bridgeResponse(_url,body){await gate.promise;return {ok:true,json:async()=>({commands:[{id:'closed',title:'Track',command:'play-pause',tab_id:body.tab_id,frame_id:body.frame_id}]})};}});
 for(let frame=0;frame<9;frame++) w.send({title:'Track'},frame);
 await flush();assert.equal(w.requests.length,8);
 w.send({title:'Later sample'},0);
 w.remove(4);
 gate.resolve();await flush();
 assert.equal(w.requests.length,8);
 assert.equal(w.commands.length,0);
 w.send({title:'Other tab'},0,5);await flush();
 const updates=w.requests.filter(x=>!x.url.endsWith('/result'));
 assert.equal(updates.length,9);
 assert.equal(JSON.parse(updates.at(-1).options.body).tab_id,5);
});

test('closing a tab during image loading prevents later favicon and metadata requests',async()=>{
 const image=deferred();
 const w=worker(true,()=>image.promise);
 w.send({title:'Track',artwork_candidates:[{src:'https://cdn.test/art.png'}]});
 await flush();assert.equal(w.images.length,1);assert.equal(w.requests.length,0);
 w.remove(4);
 image.resolve({ok:false,headers:new Headers()});await flush();
 assert.equal(w.images.length,1);
 assert.equal(w.requests.length,0);
});

test('busy frames coalesce samples and yield to an already queued frame',async()=>{
 const gates=Array.from({length:9},deferred),order=[];
 const w=worker(true,undefined,{async bridgeResponse(_url,body){order.push({frame:body.frame_id,title:body.media.title});if(body.media.title==='First') await gates[body.frame_id].promise;return {ok:true,json:async()=>({commands:[]})};}});
 for(let frame=0;frame<9;frame++) w.send({title:'First'},frame);
 await flush();
 w.send({title:'Superseded'},0);w.send({title:'Latest'},0);
 gates[0].resolve();await flush();
 assert.equal(order.length,9);
 assert.deepEqual(order.at(-1),{frame:8,title:'First'});
 for(const gate of gates) gate.resolve();await flush();
 assert.equal(order.length,10);
 assert.deepEqual(order.slice(8),[{frame:8,title:'First'},{frame:0,title:'Latest'}]);
});

test('native host disconnect rejects pending work and reconnects on the next update',async()=>{
 const gate=deferred();let first=true;
 const w=worker(true,undefined,{async bridgeResponse(){if(first){first=false;await gate.promise;}return {json:async()=>({commands:[]})};}});
 w.send({title:'Track'});await flush();assert.equal(w.connections(),1);
 w.disconnect();await flush();w.send({title:'Track'});await flush();assert.equal(w.connections(),2);
 gate.resolve();await flush();assert.equal(w.commands.length,0);
});
