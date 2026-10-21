// Read-only, simultaneous legacy/v2 observation of the same Windows desktop.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {load} from '../tests/load.mjs';
const {NativeWire}=await load('native-wire');
async function measure(delta) {
  const child=spawn(fileURLToPath(new URL('../dev.local.media-controls.sdPlugin/native/media-info.exe',import.meta.url)),['--watch',...(delta?['--delta']:[])],{windowsHide:true});
  let bytes=0,packets=0,snapshots=0,stderr='',maxSessions=0;
  const wire=new NativeWire();
  child.stdout.on('data',chunk=>{bytes+=chunk.length;});child.stderr.on('data',chunk=>{stderr+=chunk;});
  createInterface({input:child.stdout}).on('line',line=>{
    packets++;const value=JSON.parse(line),snapshot=value.native_wire===2?wire.decode(value):value;
    if(snapshot) {snapshots++;maxSessions=Math.max(maxSessions,snapshot.sessions.length);}
  });
  const timer=setTimeout(()=>child.stdin.end(),6200),[code]=await once(child,'close');clearTimeout(timer);
  if(code!==0||!snapshots) throw Error(`Native measurement failed: ${stderr}`);
  return {window_ms:6200,bytes,packets,decoded_changes:snapshots,max_media_sessions:maxSessions};
}
const [before,after]=await Promise.all([measure(false),measure(true)]);
const result={scope:'Two concurrent read-only helper processes on the same Windows desktop, legacy full snapshots versus --delta. Includes stdout newlines. Session availability and external audio changes affect results.',before,after};
const output=process.argv.find(x=>x.startsWith('--output='))?.slice(9);if(output) await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
