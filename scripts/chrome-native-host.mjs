import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

const client=randomUUID();
let streaming=false,streamController,streamGeneration=0,touchStream;
function tokenHeaders() {
  const token=readFileSync(join(process.env.LOCALAPPDATA,'StreamDeckMediaControls','chrome-token.txt'),'utf8').trim();
  if(!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid token');
  return {'content-type':'application/json',authorization:`Bearer ${token}`,'x-sdmc-client':client};
}
// A single authenticated receive stream carries commands independently of updates.
// Its retry loop also rereads the token after plugin restart or token replacement.
async function events() {
  if(streaming) return;
  streaming=true;const generation=++streamGeneration;let delay=250;
  while(streaming&&generation===streamGeneration) {
    let watchdog;
    const controller=new AbortController();streamController=controller;
    const touch=()=>{clearTimeout(watchdog);watchdog=setTimeout(()=>controller.abort(),12000);};
    try {
      touch();
      const response=await fetch('http://127.0.0.1:39761/chrome/events',{headers:tokenHeaders(),redirect:'error',signal:controller.signal});
      if(!response.ok||!response.body) throw Error('Stream unavailable');
      let pending='';const decoder=new TextDecoder();
      for await(const chunk of response.body) {
        touch();pending+=decoder.decode(chunk,{stream:true});
        if(pending.length>65536) throw Error('Oversized stream');
        let end;
        while((end=pending.indexOf('\n'))>=0) {
          const value=JSON.parse(pending.slice(0,end));pending=pending.slice(end+1);
          if(!['ready','heartbeat','command'].includes(value.event)) throw Error('Invalid event');
          if(value.event==='ready') touchStream=touch;
          reply(value);delay=250;
        }
      }
    } catch { /* The extension receives a disconnect marker, never a token. */ }
    finally {clearTimeout(watchdog);if(touchStream===touch) touchStream=undefined;controller.abort();}
    if(!streaming||generation!==streamGeneration) break;
    reply({event:'disconnected'});
    await new Promise(resolve=>setTimeout(resolve,delay));delay=Math.min(5000,delay*2);
  }
}

// stdout is exclusively Chrome's length-prefixed UTF-8 protocol.
let buffer=Buffer.alloc(0),active=0;
function reply(message) {
  const body=Buffer.from(JSON.stringify(message));
  if(body.length>1024*1024||process.stdout.writableLength>2*1024*1024) process.exit(1);
  const header=Buffer.alloc(4);header.writeUInt32LE(body.length);
  if(!process.stdout.write(Buffer.concat([header,body]))) process.stdin.pause();
}
process.stdout.on('drain',()=>process.stdin.resume());
process.stdout.on('error',()=>process.exit(1));
async function handle(message) {
  const id=message?.id;
  try {
    if(!Number.isSafeInteger(id)||!['','/result','/status','/events','/unsubscribe'].includes(message.path)||!message.body) throw new Error('Invalid request');
    if(message.path==='/events') {void events();reply({id,body:{ok:true}});return;}
    if(message.path==='/unsubscribe') {streaming=false;streamGeneration++;streamController?.abort();reply({id,body:{ok:true}});return;}
    const response=await fetch('http://127.0.0.1:39761/chrome'+message.path,{
      method:'POST',headers:tokenHeaders(),
      body:JSON.stringify(message.body),redirect:'error',signal:AbortSignal.timeout(2000)
    });
    if(!response.ok) throw new Error('Bridge rejected request');
    touchStream?.();
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
