import {test} from "node:test";
import assert from "node:assert/strict";
import {once} from "node:events";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {load} from "./load.mjs";
const bridge=await load("chrome-server");
test("loopback bridge authenticates, validates, routes exact-frame commands and acknowledges errors",async t=>{
  const token="a".repeat(64),server=bridge.startChromeServer(()=>{},{token,port:0});
  await once(server,"listening");
  t.after(()=>{server.closeAllConnections();server.close();});
  const address=server.address();assert.equal(address.address,"127.0.0.1");
  const base=`http://127.0.0.1:${address.port}`;
  const post=(path,body,auth=token)=>fetch(base+path,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${auth}`},body:typeof body==="string"?body:JSON.stringify(body)});
  assert.equal(bridge.chromeConnectionStatus().state,'disconnected');
  assert.equal((await post('/chrome/status',{},'wrong')).status,401);
  assert.equal((await post('/chrome/status',[])).status,400);
  assert.equal(bridge.chromeConnectionStatus().state,'disconnected');
  assert.equal((await post('/chrome/status',{})).status,200);
  const live=bridge.chromeConnectionStatus();
  assert.equal(live.state,'connected');assert.equal(live.sessions,0);
  assert.equal(bridge.chromeConnectionStatus(live.lastSeen+14999).state,'connected');
  assert.equal(bridge.chromeConnectionStatus(live.lastSeen+15000).state,'disconnected');
  assert.equal((await post("/chrome",{},"wrong")).status,401);
  assert.equal((await fetch(base+"/token")).status,404);
  assert.equal((await fetch(base+"/chrome",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"text/plain"},body:"{}"})).status,415);
  for(const invalid of ["{",[],{tab_id:-1,frame_id:0,sequence:1,media:{}},{tab_id:1,sequence:1,media:{}},{tab_id:1,frame_id:0,sequence:1,media:42}]) assert.equal((await post("/chrome",invalid)).status,400);
  const update=(frame)=>({tab_id:9,frame_id:frame,document_id:"document",sequence:Date.now(),media:{title:"Song",artist:"Artist"}});
  await assert.rejects(bridge.chromeCommand(9,1,"document","Song","play-pause"),/reload the extension and media page/);
  const command=bridge.chromeCommand(9,1,"document","Song","play-pause",undefined,"media-1");
  const other=await (await post("/chrome",update(0))).json();assert.deepEqual(other.commands,[]);
  const reply=await (await post("/chrome",update(1))).json();assert.equal(reply.commands.length,1);assert.equal(reply.commands[0].frame_id,1);assert.equal(reply.commands[0].target_id,"media-1");
  assert.deepEqual((await (await post("/chrome",update(1))).json()).commands,[]);
  await post("/chrome/result",{id:reply.commands[0].id,ok:true});await command;
  const failed=bridge.chromeCommand(9,1,"document","Song","next",undefined,"media-1");const rejected=assert.rejects(failed,/unavailable|rejected/);
  const next=await (await post("/chrome",update(1))).json();await post("/chrome/result",{id:next.commands[0].id,ok:false});await rejected;
  assert.equal((await post("/chrome",{...update(1),media:null})).status,200);
});
test("Windows pairing token has a restricted DACL and survives bridge restart",{skip:process.platform!=="win32"},async t=>{
  const root=await mkdtemp(fileURLToPath(new URL(".generated/token-",import.meta.url)));
  const original=process.env.LOCALAPPDATA;process.env.LOCALAPPDATA=root;
  t.after(async()=>{if(original===undefined) delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=original;await rm(root,{recursive:true,force:true});});
  const path=join(root,"StreamDeckMediaControls/chrome-token.txt");
  for(let i=0;i<2;i++){
    const server=bridge.startChromeServer(()=>{},{port:0});await once(server,"listening");
    const token=(await readFile(path,"utf8")).trim();assert.match(token,/^[a-f0-9]{64}$/);
    const script=`$ErrorActionPreference='Stop';$a=[IO.File]::GetAccessControl($env:SDMC_TEST_FILE); $s=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if(-not $a.AreAccessRulesProtected -and -not $a.Access[0].IsInherited){exit 1}; foreach($r in $a.Access){$id=$r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; if($id -ne $s -and $id -ne 'S-1-5-18'){exit 2}}`;
    execFileSync(join(process.env.SystemRoot,"System32/WindowsPowerShell/v1.0/powershell.exe"),["-NoProfile","-NonInteractive","-Command",script],{windowsHide:true,env:{...process.env,SDMC_TEST_FILE:path}});
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    if(i===0) t.token=token;else assert.equal(token,t.token);
  }
});

test('profile namespaces isolate polling, acknowledgements and reconnected command streams',{timeout:10000},async t=>{
  const token='c'.repeat(64),server=bridge.startChromeServer(()=>{},{token,port:0});
  await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const oldHost='11111111-1111-4111-8111-111111111111',newHost='22222222-2222-4222-8222-222222222222';
  const controllers=[];
  t.after(()=>{for(const controller of controllers) controller.abort();server.closeAllConnections();server.close();});
  const post=async(path,body,host)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`,...(host?{'x-sdmc-client':host}:{})},body:JSON.stringify(body)});
  const update=(client,sequence=1)=>({protocol:2,client_id:client,tab_id:90,frame_id:0,document_id:'same-doc',sequence,base:null,media:{title:client===a?'Profile A':'Profile B'},images:{}});
  await post('/chrome/status',{});
  const initial=bridge.chromeConnectionStatus().sessions;
  for(const invalid of [null,17,'','bad:id','a'.repeat(1000)]) assert.equal((await post('/chrome',{...update(a),client_id:invalid})).status,400);
  assert.equal((await post('/chrome',update(a))).status,200);
  assert.equal((await post('/chrome',update(b))).status,200);
  assert.equal(bridge.chromeConnectionStatus().sessions,initial+2,'matching tab and document IDs coexist');
  const pending=bridge.chromeCommand(90,0,'same-doc','Profile A','play-pause',undefined,'media-1',a);
  let completed=false;pending.then(()=>{completed=true;});
  assert.deepEqual((await (await post('/chrome',update(b,2))).json()).commands,[]);
  const reply=await (await post('/chrome',update(a,2))).json();
  assert.equal(reply.commands.length,1);assert.equal(reply.commands[0].client_id,a);
  const result={id:reply.commands[0].id,ok:true};
  await post('/chrome/result',{...result,client_id:b});
  assert.equal(completed,false,'another profile cannot acknowledge the operation');
  await post('/chrome/result',result);
  assert.equal(completed,false,'legacy results cannot acknowledge namespaced operations');
  await post('/chrome/result',{...result,client_id:a});await pending;

  const subscribe=async host=>{
    const controller=new AbortController();controllers.push(controller);
    const response=await fetch(base+'/chrome/events',{headers:{authorization:`Bearer ${token}`,'x-sdmc-client':host},signal:controller.signal});
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    return async()=>{
      while(!buffer.includes('\n')) {const value=await reader.read();assert.equal(value.done,false);buffer+=decoder.decode(value.value,{stream:true});}
      const end=buffer.indexOf('\n'),event=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);return event;
    };
  };
  // A native-host restart replaces only the transport owner, not the profile identity.
  const oldEvents=await subscribe(oldHost);assert.equal((await oldEvents()).event,'ready');
  await post('/chrome',update(a,3),oldHost);
  const newEvents=await subscribe(newHost);assert.equal((await newEvents()).event,'ready');
  await post('/chrome',{...update(a,4),base:3,media:{playback_state:'paused'}},newHost);
  await post('/chrome',update(a,3),oldHost);
  assert.equal(bridge.chromeConnectionStatus().sessions,initial+2,'host reconnects preserve the existing session');
  // A second profile's navigation must not delete A's stream owner or delta base.
  await post('/chrome',{...update(b,3),document_id:'next-doc'},oldHost);
  const pushed=bridge.chromeCommand(90,0,'same-doc','Profile A','stop',undefined,'media-1',a);
  const event=await newEvents();assert.equal(event.event,'command');assert.equal(event.command.client_id,a);
  await post('/chrome/result',{id:event.command.id,ok:true,client_id:a},newHost);await pushed;
  const delta=await (await post('/chrome',{...update(a,5),base:4,media:{title:'Still A'}},newHost)).json();
  assert.equal(delta.ok,true);assert.equal(delta.resync,undefined);
  await post('/chrome',{...update(b,4),document_id:'next-doc',media:null},oldHost);
  assert.equal(bridge.chromeConnectionStatus().sessions,initial+1);
  await post('/chrome',{...update(a,6),media:null},newHost);
  await post('/chrome',update(a,5),oldHost);
  assert.equal(bridge.chromeConnectionStatus().sessions,initial,'delayed data cannot revive cleared media');
});
