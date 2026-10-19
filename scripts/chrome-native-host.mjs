import {readFileSync} from 'node:fs';
import {join} from 'node:path';

// stdout is exclusively Chrome's length-prefixed UTF-8 protocol.
let buffer=Buffer.alloc(0),active=0;
function reply(message) {
  const body=Buffer.from(JSON.stringify(message));
  if(body.length>1024*1024) process.exit(1);
  const header=Buffer.alloc(4);header.writeUInt32LE(body.length);
  if(!process.stdout.write(Buffer.concat([header,body]))) process.stdin.pause();
}
process.stdout.on('drain',()=>process.stdin.resume());
process.stdout.on('error',()=>process.exit(1));
async function handle(message) {
  const id=message?.id;
  try {
    if(!Number.isSafeInteger(id)||!['','/result','/status'].includes(message.path)||!message.body) throw new Error('Invalid request');
    const token=readFileSync(join(process.env.LOCALAPPDATA,'StreamDeckMediaControls','chrome-token.txt'),'utf8').trim();
    if(!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid token');
    const response=await fetch('http://127.0.0.1:39761/chrome'+message.path,{
      method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
      body:JSON.stringify(message.body),redirect:'error',signal:AbortSignal.timeout(2000)
    });
    if(!response.ok) throw new Error('Bridge rejected request');
    reply({id,body:await response.json()});
  } catch {reply({id,error:'Local bridge unavailable; start the Stream Deck plugin.'});}
  finally {active--;}
}
process.stdin.on('data',chunk=>{
  buffer=Buffer.concat([buffer,chunk]);
  while(buffer.length>=4) {
    const size=buffer.readUInt32LE(0);
    if(size===0||size>1_750_000) process.exit(1);
    if(buffer.length<4+size) break;
    let message;
    try {message=JSON.parse(buffer.subarray(4,4+size).toString('utf8'));} catch {process.exit(1);}
    buffer=buffer.subarray(4+size);
    if(active>=16) process.exit(1);
    active++;void handle(message);
  }
});
process.stdin.on('end',()=>process.exit(buffer.length?1:0));
process.stdin.on('error',()=>process.exit(1));
