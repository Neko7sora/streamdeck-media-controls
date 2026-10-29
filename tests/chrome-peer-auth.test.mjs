import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer as httpServer} from 'node:http';
import {createServer as httpsServer} from 'node:https';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tls,untrustedTls} from './tls-fixture.mjs';
import {load} from './load.mjs';

const source=await readFile(new URL('../scripts/chrome-native-host.mjs',import.meta.url),'utf8');
const token='e'.repeat(64),privateMedia='private-media-must-not-reach-an-impostor';
async function host(t,port,certificate=tls.cert) {
  await mkdir(new URL('.generated/',import.meta.url),{recursive:true});
  const root=await mkdtemp(fileURLToPath(new URL('.generated/peer-',import.meta.url)));
  const directory=join(root,'StreamDeckMediaControls');await mkdir(directory);
  await writeFile(join(directory,'chrome-token.txt'),token);
  if(certificate!==null) await writeFile(join(directory,'chrome-server.pem'),certificate);
  const script=join(root,'host.mjs');await writeFile(script,source.replaceAll('39761',String(port)));
  const child=spawn(process.execPath,[script],{windowsHide:true,env:{...process.env,LOCALAPPDATA:root},stdio:['pipe','pipe','pipe']});
  const messages=[],waiters=[];let bytes=Buffer.alloc(0),id=0;
  child.stdout.on('data',chunk=>{
    bytes=Buffer.concat([bytes,chunk]);
    while(bytes.length>=4&&bytes.length>=4+bytes.readUInt32LE(0)) {
      const size=bytes.readUInt32LE(0),message=JSON.parse(bytes.subarray(4,size+4));bytes=bytes.subarray(size+4);
      messages.push(message);
      for(const waiter of [...waiters]) if(waiter.match(message)) {waiters.splice(waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(message);}
    }
  });
  const wait=match=>{
    const old=messages.find(match);if(old) return Promise.resolve(old);
    return new Promise((resolve,reject)=>{const w={match,resolve,timer:setTimeout(()=>reject(Error('Host response timed out')),4000)};waiters.push(w);});
  };
  const request=async(path,body={})=>{
    const current=++id,result=wait(m=>m.id===current),data=Buffer.from(JSON.stringify({id:current,path,body})),header=Buffer.alloc(4);
    header.writeUInt32LE(data.length);child.stdin.write(Buffer.concat([header,data]));return result;
  };
  t.after(async()=>{
    for(const w of waiters) clearTimeout(w.timer);
    const exited=once(child,'exit');child.kill();await exited;
    await rm(root,{recursive:true,force:true});
  });
  return {request,wait,messages,directory};
}
async function listen(t,server,port=0) {
  server.listen(port,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  return server.address().port;
}

for(const kind of ['plaintext','wrong-certificate']) {
  test(`port-squatting ${kind} peer receives no bearer/media and cannot inject events`,async t=>{
    let requests=0,connections=0;const wire=[];
    const handler=(_req,res)=>{requests++;res.end(JSON.stringify({ok:true,protocol:2}));};
    const server=kind==='plaintext'?httpServer(handler):httpsServer(untrustedTls,handler);
    server.on('connection',socket=>{connections++;socket.on('data',chunk=>wire.push(chunk));});
    const port=await listen(t,server),client=await host(t,port);
    for(const path of ['/status','','/result']) assert.ok((await client.request(path,{title:privateMedia})).error);
    await client.request('/events');await client.wait(m=>m.event==='disconnected');await client.request('/unsubscribe');
    assert.equal(requests,0,'TLS must reject the peer before HTTP headers or bodies');
    assert.ok(connections>0,'exercise a real connection, not a sandbox/network failure');
    const observed=Buffer.concat(wire).toString('latin1');
    assert.equal(observed.includes(token),false);assert.equal(observed.includes(privateMedia),false);
    assert.equal(client.messages.some(m=>m.event==='ready'||m.event==='command'),false);
  });
}

for(const certificate of [null,'not a certificate']) {
  test(`missing/malformed private trust file fails closed (${certificate===null?'missing':'malformed'})`,async t=>{
    let requests=0;const server=httpsServer(tls,(_req,res)=>{requests++;res.end('{}');});
    const port=await listen(t,server),client=await host(t,port,certificate);
    assert.ok((await client.request('/status',{title:privateMedia})).error);
    await client.request('/events');await client.wait(m=>m.event==='disconnected');await client.request('/unsubscribe');
    assert.equal(requests,0);
  });
}

test('reconnect reloads the private pin and rejects replacement listeners',async t=>{
  let trusted=httpsServer(tls,(_req,res)=>res.end('{"ok":true}'));
  const port=await listen(t,trusted),client=await host(t,port);
  assert.equal((await client.request('/status')).body.ok,true);
  trusted.closeAllConnections();await new Promise(resolve=>trusted.close(resolve));
  let requests=0;trusted=httpsServer(untrustedTls,(_req,res)=>{requests++;res.end('{"ok":true}');});
  await listen(t,trusted,port);
  assert.ok((await client.request('/status',{title:privateMedia})).error);assert.equal(requests,0);
  // A legitimate identity replacement is read from the same private trust file.
  await writeFile(join(client.directory,'chrome-server.pem'),untrustedTls.cert);
  assert.equal((await client.request('/status')).body.ok,true);assert.equal(requests,1);
});

test('bridge has no token-only plaintext server configuration',async()=>{
  const bridge=await load('chrome-server');
  assert.throws(()=>bridge.startChromeServer(()=>{},{token,port:0}),/TLS credentials/);
});
