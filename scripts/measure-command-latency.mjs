// Real local HTTP + Native Messaging, with a paused page's 1Hz legacy updates.
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {load} from '../tests/load.mjs';
const baseline=process.argv.find(x=>x.startsWith('--baseline='))?.slice(11);
if(!baseline||!/^[a-f0-9]{40}$/.test(baseline)) throw Error('Use --baseline=<40-character Git commit>');
const old=file=>execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8'});
async function measure(before) {
  const plugin={name:'baseline-server',setup(build){build.onLoad({filter:/chrome-server\.ts$/},()=>({contents:old('src/chrome-server.ts'),loader:'ts'}));}};
  const bridge=await load('chrome-server',before?[plugin]:[]),token='d'.repeat(64);
  const server=bridge.startChromeServer(()=>{},{token,port:0});await once(server,'listening');
  await mkdir(new URL('../tests/.generated/',import.meta.url),{recursive:true});
  const root=await mkdtemp(fileURLToPath(new URL('../tests/.generated/latency-',import.meta.url)));
  await mkdir(join(root,'StreamDeckMediaControls'));await writeFile(join(root,'StreamDeckMediaControls/chrome-token.txt'),token);
  const script=join(root,'host.mjs');
  const host=before?old('scripts/chrome-native-host.mjs'):await readFile(new URL('chrome-native-host.mjs',import.meta.url),'utf8');
  await writeFile(script,host.replaceAll('39761',String(server.address().port)));
  const child=spawn(process.execPath,[script],{windowsHide:true,env:{...process.env,LOCALAPPDATA:root}});
  let buffer=Buffer.alloc(0),sequence=0;const waits=[],latencies=[];
  child.stdout.on('data',chunk=>{
    buffer=Buffer.concat([buffer,chunk]);
    while(buffer.length>=4&&buffer.length>=4+buffer.readUInt32LE(0)) {
      const size=buffer.readUInt32LE(0),value=JSON.parse(buffer.subarray(4,size+4));buffer=buffer.subarray(size+4);
      for(const waiter of [...waits]) if(waiter.match(value)) {waits.splice(waits.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(value);}
    }
  });
  const wait=match=>new Promise((resolve,reject)=>{const entry={match,resolve,timer:setTimeout(()=>reject(Error('Host response timed out')),5000)};waits.push(entry);});
  const post=async(path,body)=>{
    const id=++sequence,response=wait(m=>m.id===id),data=Buffer.from(JSON.stringify({id,path,body})),header=Buffer.alloc(4);header.writeUInt32LE(data.length);child.stdin.write(Buffer.concat([header,data]));
    const value=await response;if(value.error) throw Error(value.error);return value.body;
  };
  const update=()=>post('',{tab_id:1,frame_id:0,document_id:'doc',sequence:Date.now(),media:{title:'Track',playback_state:'paused',browser_media:{target_id:'media-1',element_type:'audio'},controls:{toggle:true}}});
  try {
    if(!before) {const ready=wait(m=>m.event==='ready');await post('/events',{});await ready;}
    await update();
    for(let sample=0;sample<20;sample++) {
      let poll;
      if(before) {
        poll=delay(1000).then(async()=>{const response=await update();for(const command of response.commands) await post('/result',{id:command.id,ok:true});});
        await delay(sample*50);
      }
      const pushed=before?undefined:wait(m=>m.event==='command'),started=performance.now();
      const done=bridge.chromeCommand(1,0,'doc','Track','play-pause',undefined,'media-1');
      if(!before) {const message=await pushed;await post('/result',{id:message.command.id,ok:true});}
      await done;latencies.push(performance.now()-started);await poll;
    }
    latencies.sort((a,b)=>a-b);
    return {samples:20,p50_ms:latencies[10],p95_ms:latencies[18],max_ms:latencies[19],mean_ms:latencies.reduce((n,v)=>n+v,0)/20};
  } finally {
    child.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});
  }
}
const result={baseline_commit:baseline,scope:'Command promise completion, including real localhost HTTP and Native Messaging result acknowledgement; no browser or hardware. Legacy: twenty phases from 0 to 950ms in a 1Hz paused-page interval. New: no state updates during twenty commands.',before:await measure(true),after:await measure(false)};
const output=process.argv.find(x=>x.startsWith('--output='))?.slice(9);if(output) await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
