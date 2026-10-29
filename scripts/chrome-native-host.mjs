import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {request} from 'node:https';

const client=randomUUID();
let streaming=false,streamController,streamGeneration=0,touchStream;
function localRequest(path,{method='GET',body,signal}={}) {
  const directory=join(process.env.LOCALAPPDATA,'StreamDeckMediaControls');
  const token=readFileSync(join(directory,'chrome-token.txt'),'utf8').trim();
  if(!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid token');
  // Trust only this user's companion identity. TLS authenticates the receiver
  // before any bearer or media bytes leave the client, including on reconnect.
  const ca=readFileSync(join(directory,'chrome-server.pem'));
  return new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:39761,path:'/chrome'+path,method,ca,
      rejectUnauthorized:true,minVersion:'TLSv1.2',agent:false,signal,
      headers:{'content-type':'application/json',authorization:`Bearer ${token}`,'x-sdmc-client':client}},response=>{
      if(response.statusCode<200||response.statusCode>=300) {response.destroy();reject(Error('Bridge rejected request'));return;}
      resolve(response);
    });
    req.on('error',reject);req.end(body);
  });
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
      const response=await localRequest('/events',{signal:controller.signal});
      let pending='';const decoder=new TextDecoder();
      for await(const chunk of response) {
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
    const response=await localRequest(message.path,{
      method:'POST',body:JSON.stringify(message.body),signal:AbortSignal.timeout(2000)
    });
    const chunks=[];let size=0;
    for await(const chunk of response) {
      size+=chunk.length;
      if(size>1024*1024) {response.destroy();throw Error('Oversized response');}
      chunks.push(chunk);
    }
    touchStream?.();
    reply({id,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});
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
