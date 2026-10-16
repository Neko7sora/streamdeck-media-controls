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
  assert.equal((await post("/chrome",{},"wrong")).status,401);
  assert.equal((await fetch(base+"/token")).status,404);
  assert.equal((await fetch(base+"/chrome",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"text/plain"},body:"{}"})).status,415);
  for(const invalid of ["{",[],{tab_id:-1,frame_id:0,sequence:1,media:{}},{tab_id:1,sequence:1,media:{}},{tab_id:1,frame_id:0,sequence:1,media:42}]) assert.equal((await post("/chrome",invalid)).status,400);
  const update=(frame)=>({tab_id:9,frame_id:frame,document_id:"document",sequence:Date.now(),media:{title:"Song",artist:"Artist"}});
  const command=bridge.chromeCommand(9,1,"document","Song","play-pause");
  const other=await (await post("/chrome",update(0))).json();assert.deepEqual(other.commands,[]);
  const reply=await (await post("/chrome",update(1))).json();assert.equal(reply.commands.length,1);assert.equal(reply.commands[0].frame_id,1);
  assert.deepEqual((await (await post("/chrome",update(1))).json()).commands,[]);
  await post("/chrome/result",{id:reply.commands[0].id,ok:true});await command;
  const failed=bridge.chromeCommand(9,1,"document","Song","next");const rejected=assert.rejects(failed,/unavailable|rejected/);
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
