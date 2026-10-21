import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {load} from './load.mjs';
const bridge=await load('chrome-server');
const hostSource=await readFile(new URL('../scripts/chrome-native-host.mjs',import.meta.url),'utf8');

test('real Native Messaging + authenticated HTTP stream pushes commands, reconnects, and resynchronizes after restart',async t=>{
  const token='b'.repeat(64);let server=bridge.startChromeServer(()=>{},{token,port:0});await once(server,'listening');
  const port=server.address().port;
  await mkdir(new URL('.generated/',import.meta.url),{recursive:true});
  const root=await mkdtemp(fileURLToPath(new URL('.generated/transport-',import.meta.url)));
  await mkdir(join(root,'StreamDeckMediaControls'));
  await writeFile(join(root,'StreamDeckMediaControls/chrome-token.txt'),token);
  const script=join(root,'host.mjs');await writeFile(script,hostSource.replaceAll('39761',String(port)));
  const child=spawn(process.execPath,[script],{windowsHide:true,env:{...process.env,LOCALAPPDATA:root},stdio:['pipe','pipe','pipe']});
  const messages=[],waiters=[];let buffer=Buffer.alloc(0),id=0,stderr='';
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  child.stdout.on('data',chunk=>{
    buffer=Buffer.concat([buffer,chunk]);
    while(buffer.length>=4&&buffer.length>=4+buffer.readUInt32LE(0)) {
      const size=buffer.readUInt32LE(0),message=JSON.parse(buffer.subarray(4,size+4));buffer=buffer.subarray(size+4);messages.push(message);
      for(const waiter of [...waiters]) if(waiter.predicate(message)) {waiters.splice(waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(message);}
    }
  });
  const waitFor=(predicate)=>new Promise((resolve,reject)=>{
    const waiter={predicate,resolve,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(Error(`Native message timed out; ${stderr}`));},4000)};waiters.push(waiter);
  });
  const request=async(path,body)=>{
    const current=++id,reply=waitFor(m=>m.id===current),data=Buffer.from(JSON.stringify({id:current,path,body})),header=Buffer.alloc(4);header.writeUInt32LE(data.length);
    child.stdin.write(Buffer.concat([header,data]));const result=await reply;assert.equal(result.error,undefined);return result.body;
  };
  t.after(async()=>{child.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
  assert.equal((await fetch(`http://127.0.0.1:${port}/chrome/events`)).status,401);
  assert.equal((await request('/status',{})).protocol,2);
  const contact=bridge.chromeConnectionStatus().lastSeen;
  let ready=waitFor(m=>m.event==='ready');await request('/events',{});const first=await ready;
  assert.equal(bridge.chromeConnectionStatus().lastSeen,contact,'opening a native receive stream alone does not renew the Chrome worker lease');
  const media={protocol:2,tab_id:5,frame_id:2,document_id:'doc',sequence:Date.now(),base:null,media:{title:'Track',browser_media:{element_type:'audio',target_id:'media-1'},controls:{toggle:true,seek:true}},images:{}};
  assert.equal((await request('',media)).ok,true);
  const latency=[];
  for(let sample=0;sample<20;sample++) {
    const pushed=waitFor(m=>m.event==='command'),started=performance.now();
    const done=bridge.chromeCommand(5,2,'doc','Track',sample%2?'seek':'play-pause',sample%2?20:undefined,'media-1');
    const message=await pushed;latency.push(performance.now()-started);
    assert.equal(message.command.document_id,'doc');assert.equal(message.command.frame_id,2);
    await request('/result',{id:message.command.id,ok:true});await done;
  }
  latency.sort((a,b)=>a-b);assert.ok(latency[18]<500,`p95 ${latency[18]}ms must not depend on five-second state updates`);
  t.diagnostic(JSON.stringify({command_samples:latency.length,p50_ms:latency[10],p95_ms:latency[18],max_ms:latency[19],state_updates_during_commands:0}));
  ready=waitFor(m=>m.event==='ready');server.closeAllConnections();await ready;
  ready=waitFor(m=>m.event==='ready'&&m.epoch!==first.epoch);
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  server=bridge.startChromeServer(()=>{},{token,port});await once(server,'listening');await ready;
  const lost=await request('',{...media,base:media.sequence,sequence:media.sequence+1,media:{playback_state:'paused'}});assert.equal(lost.resync,true);
  assert.equal((await request('',{...media,sequence:Date.now()})).ok,true);
  const pushed=waitFor(m=>m.event==='command'),done=bridge.chromeCommand(5,2,'doc','Track','stop',undefined,'media-1');
  const message=await pushed;await request('/result',{id:message.command.id,ok:true});await done;
  await request('/unsubscribe',{});const count=messages.filter(m=>m.event==='ready').length;
  ready=waitFor(m=>m.event==='ready');await request('/events',{});await ready;
  assert.equal(messages.filter(m=>m.event==='ready').length,count+1);
});
