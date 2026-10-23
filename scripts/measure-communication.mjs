// Replays identical clocks/events against an immutable baseline and the worktree.
// Byte counts are UTF-8 application payloads, excluding HTTP/TCP/USB framing.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {worker} from '../tests/worker-harness.mjs';
import {inspector} from '../tests/settings-harness.mjs';
import {load} from '../tests/load.mjs';
const {InspectorUpdates}=await load('inspector-updates');
const baseline=process.argv.find(x=>x.startsWith('--baseline='))?.slice(11);
if(!baseline||!/^[a-f0-9]{40}$/.test(baseline)) throw Error('Use --baseline=<40-character Git commit>');
const source=(file,before)=>before?execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8',maxBuffer:4_000_000}):readFileSync(file,'utf8');
const flush=async()=>{for(let i=0;i<8;i++) await new Promise(setImmediate);};
const settled=async w=>{const start=performance.now();do {await flush();if(performance.now()-start>2000) throw Error('Worker did not settle');} while(w.busy());};
const bytes=value=>Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value));
function measureInspector(before) {
  const pi=inspector({mediaTarget:'a'},{sourceText:source('dev.n7s.media-controls.sdPlugin/ui/settings.js',before)}),updates=new InspectorUpdates();
  let offset=1,requestBytes=0,responseBytes=0,requests=0,responses=0,full=0;
  const payload=second=>({sessions:[{id:'a',label:second<45?'Track':'Next',details:JSON.stringify({title:second<45?'Track':'Next',artist:'Artist',observed_at:second*1000,subtitle:'x'.repeat(4096)})}],audio:[{id:'master',volume:second<30?0.5:0.6,muted:false}],chromeConnection:{state:'connected',sessions:1,lastSeen:second*1000}});
  const receive=value=>{responseBytes+=bytes(value);responses++;pi.receive('sendToPropertyInspector',value);};
  const drain=second=>{
    while(offset<pi.messages.length) {
      const request=pi.messages[offset++].payload;requestBytes+=bytes(request);requests++;
      if(request.request==='options') {full++;receive({...(before?{}:{protocol:2}),settings:{mediaTarget:'a'},settingsRevision:request.settingsRevision,...payload(second)});}
      else if(['watch','alive'].includes(request.request)) receive({response:'alive',protocol:2,chromeConnection:payload(second).chromeConnection});
    }
  };
  drain(0);updates.changes(payload(0));
  for(let second=1;second<=60;second++) {
    if(!before) {const changed=updates.changes(payload(second));if(Object.keys(changed).length) receive({protocol:2,response:'optionsChanged',...changed});}
    pi.advance(1000);drain(second);
  }
  return {requests,responses,full_list_responses:full,payload_bytes:requestBytes+responseBytes};
}
async function trace(before,active) {
  let now=10000,next=0;const timers=new Map(),intervals=[],listeners=[],events=new Map(),updates=[];
  const element={currentSrc:'https://media.test/audio',tagName:'AUDIO',readyState:4,paused:false,ended:false,seeking:false,currentTime:10,duration:600,playbackRate:1,volume:1,muted:false,loop:false,seekable:{length:1,start:()=>0,end:()=>600},buffered:{length:1,start:()=>0,end:()=>600}};
  const mediaSession={metadata:active?{title:'Track',artist:'Artist',album:'Album',artwork:[{src:'https://cdn.test/album.png',sizes:'512x512',type:'image/png'}]}:null,playbackState:active?'playing':'none',setPositionState(){}};
  const window={addEventListener(type,fn){if(type==='message') listeners.push(fn);},postMessage(data){for(const fn of listeners) void fn({source:window,origin:'https://site.test',data});}};
  const shared={window,location:{origin:'https://site.test'},Date:{now:()=>now},setTimeout(fn,delay){const id=++next;timers.set(id,{at:now+delay,fn});return id;},clearTimeout(id){timers.delete(id);},setInterval(fn,period){intervals.push({fn,period});}};
  vm.runInNewContext(source('chrome-extension/bridge-isolated.js',before),{...shared,chrome:{runtime:{onMessage:{addListener(){}},async sendMessage(message){updates.push({at:now,media:message.media});return before?undefined:{protocol:2};}}}});
  vm.runInNewContext(source('chrome-extension/page-main.js',before),{...shared,navigator:{mediaSession},document:{querySelectorAll(selector){return selector==='audio,video'&&active?[element]:[];},addEventListener(type,fn){events.set(type,fn);}}});
  await flush();
  for(let elapsed=250;elapsed<=60000;elapsed+=250) {
    now=10000+elapsed;element.currentTime=10+elapsed/1000;
    for(const [id,timer] of [...timers]) if(timer.at<=now) {timers.delete(id);timer.fn();}
    for(const interval of intervals) if(elapsed%interval.period===0) interval.fn();
    if(active) events.get('timeupdate')?.({type:'timeupdate'});
    await flush();
  }
  return updates;
}
async function run(before) {
  const idle=await trace(before,false),playing=await trace(before,true);let now=10000,ui;
  const w=worker(true,async()=>new Response(new Uint8Array(200000),{headers:{'content-type':'image/png'}}),{
    source:source('chrome-extension/background.js',before),protocol2:!before,now:()=>now,inspect(value){ui=value;},async bridgeResponse(){return {json:async()=>({ok:true,commands:[]})};}
  });await settled(w);
  for(const update of playing) {
    now=update.at;w.send(update.media);await settled(w);
    if((now-10000)%5000===0) {if(!before) ui.event({event:'heartbeat'});ui.pulse();await flush();}
  }
  const payloads=w.requests.filter(x=>!x.url.endsWith('/result'));
  return {idle_page_updates_60s:idle.length,playing_updates_60s:playing.length,local_state_requests:payloads.length,local_state_payload_bytes:payloads.reduce((n,r)=>n+bytes(r.options.body),0),native_request_messages:w.nativeMessages.length,native_request_bytes:w.nativeMessages.reduce((n,m)=>n+bytes(m)+4,0),image_content_transfers:payloads.reduce((n,r)=>{const b=JSON.parse(r.options.body);return n+(before?Number(!!b.media.artwork_data_url):Object.values(b.images??{}).filter(s=>s.length>10000).length);},0),external_image_fetches:w.images.length,status_requests:w.requests.length-payloads.length+ui.probes.length,page_to_extension_bytes:playing.reduce((n,u)=>n+bytes({type:'MEDIA_UPDATE',media:u.media}),0)};
}
const result={baseline_commit:baseline,workload:'60 seconds; one playing page; timeupdate at 4Hz; discovery at 1Hz; 200000-byte artwork; one favicon; unchanged metadata; separate idle page. Inspector: one 4KiB detail record, volume change at 30s and track change at 45s.',payload_scope:'UTF-8 JSON request bodies; excludes HTTP, TCP, Native Messaging headers, stream heartbeats and USB framing',before:{...await run(true),inspector:measureInspector(true)},after:{...await run(false),inspector:measureInspector(false)}};
if(process.argv.includes('--verify')) {
  assert.equal(result.after.idle_page_updates_60s,1);
  assert.ok(result.after.playing_updates_60s<=13);
  assert.ok(result.after.local_state_payload_bytes<300000);
  assert.equal(result.after.image_content_transfers,1);
  assert.ok(result.after.inspector.payload_bytes<15000);
}
const output=process.argv.find(x=>x.startsWith('--output='))?.slice(9);
if(output) writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
