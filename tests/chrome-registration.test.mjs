import {test} from "node:test";
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,mkdir,writeFile,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {load} from "./load.mjs";

const script=fileURLToPath(new URL("../scripts/register-chrome-native-host.ps1",import.meta.url));
const powershell=join(process.env.SystemRoot??"C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe");
const run=promisify(execFile);
const first="a".repeat(32),second="b".repeat(32),other="c".repeat(32);
const manifest={name:"Stream Deck Media Metadata Bridge (Local)",permissions:["nativeMessaging"],background:{service_worker:"background.js"}};

test("registration ignores impostor labels and requires exactly one explicitly authorized ID",{skip:process.platform!=="win32"},async()=>{
  const root=await mkdtemp(join(tmpdir(),"chrome-registration-"));
  try {
    await mkdir(join(root,"Default"));
    const prefPath=join(root,"Default","Preferences");
    const original=JSON.stringify({extensions:{settings:{[first]:{manifest,state:1},[second]:{manifest,state:1},[other]:{manifest,state:0}}}});
    await writeFile(prefPath,original);
    const args=["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",script,"-ChromeUserDataDir",root,"-NodePath","does-not-exist"];
    // Exercise normal mode: fail before any host or registry write.
    await assert.rejects(run(powershell,args,{windowsHide:true}),error=>error.code===2&&error.stdout.includes("Specify -ExtensionId"));
    const {stdout}=await run(powershell,[...args,"-DetectOnly","-ExtensionId",first],{windowsHide:true});
    assert.equal(stdout.trim(),first);
    assert.equal(await readFile(prefPath,"utf8"),original);
    for(const id of ["invalid",first+","+second,first+";whoami","A".repeat(32)]) {
      await assert.rejects(run(powershell,[...args,"-DetectOnly","-ExtensionId",id],{windowsHide:true}),error=>error.code!==0);
    }
    await rm(join(root,"Default"),{recursive:true,force:true});
    const explicit=await run(powershell,[...args,"-DetectOnly","-ExtensionId",first],{windowsHide:true});
    assert.equal(explicit.stdout.trim(),first);
  } finally {await rm(root,{recursive:true,force:true});}
});

test("registration runs only when requested, rejects concurrent work, and never retries automatically",{skip:process.platform!=="win32"},async t=>{
  const state={calls:[],kills:0};globalThis.__chromeRegistrationTest=state;
  const mockPort={name:"registration-process",setup(build){
    build.onResolve({filter:/^node:child_process$/},()=>({path:"process",namespace:"registration-test"}));
    build.onLoad({filter:/.*/,namespace:"registration-test"},()=>({contents:`export function execFile(file,args,options,callback){const s=globalThis.__chromeRegistrationTest;s.calls.push({file,args,options,callback});return {kill(){s.kills++;}};}`}));
  }};
  const {registerChromeHost,stopChromeRegistration}=await load("chrome-registration",[mockPort]);
  t.mock.timers.enable({apis:["setTimeout"]});
  const logs=[],log=message=>logs.push(message);
  try {
    t.mock.timers.tick(120000);assert.equal(state.calls.length,0,"loading the module must not register anything");
    for(const id of [undefined,"", "invalid",first+second]) assert.equal((await registerChromeHost(id,log)).status,"failed");
    assert.equal(state.calls.length,0);
    const firstAttempt=registerChromeHost(first,log);
    assert.equal(state.calls.length,1);
    assert.equal(state.calls[0].file,powershell);
    assert.equal(state.calls[0].args[state.calls[0].args.indexOf("-ExtensionId")+1],first);
    assert.equal(state.calls[0].args.at(-1),process.execPath);
    assert.equal(state.calls[0].options.windowsHide,true);
    assert.equal(state.calls[0].options.timeout,20000);
    assert.equal((await registerChromeHost(second,log)).status,"failed","another ID cannot share a pending authorization");
    t.mock.timers.tick(120000);assert.equal(state.calls.length,1);
    state.calls[0].callback({code:2});assert.equal((await firstAttempt).status,"not-found");
    t.mock.timers.tick(120000);assert.equal(state.calls.length,1,"missing extensions do not trigger polling");
    const secondAttempt=registerChromeHost(first,log);assert.equal(state.calls.length,2);
    state.calls[1].callback(null);assert.equal((await secondAttempt).status,"registered");
    t.mock.timers.tick(120000);assert.equal(state.calls.length,2);
    const failedAttempt=registerChromeHost(first,log);state.calls[2].callback({code:1,message:"Access denied"});
    assert.equal((await failedAttempt).status,"failed");assert.match(logs.at(-1),/Access denied/);
    const stoppedAttempt=registerChromeHost(first,log);stopChromeRegistration();assert.equal(state.kills,1);
    state.calls[3].callback({code:"ABORT_ERR",message:"Stopped"});assert.equal((await stoppedAttempt).status,"failed");
    t.mock.timers.tick(120000);assert.equal(state.calls.length,4);
  } finally {stopChromeRegistration();delete globalThis.__chromeRegistrationTest;}
});

test("registration replaces old origins with the selected ID using an isolated host and registry stub",{skip:process.platform!=="win32"},async()=>{
  const root=await mkdtemp(join(tmpdir(),"chrome-register-install-"));
  try {
    const host=join(root,"StreamDeckMediaControls","native-host");await mkdir(host,{recursive:true});
    const installed=join(host,"dev.n7s.media_controls.json");
    await writeFile(installed,JSON.stringify({allowed_origins:[`chrome-extension://${first}/`,`chrome-extension://${second}/`]}));
    const harness=join(root,"register-test.ps1");
    await writeFile(harness,String.raw`param([string]$Script,[string]$Node,[string]$Id)
function Test-Path { param([string]$LiteralPath) if ($LiteralPath -like 'HKCU:*') { return $false }; Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath }
function New-Item { param([string]$Path,[string]$ItemType,[switch]$Force) if ($Path -like 'HKCU:*') { return }; Microsoft.PowerShell.Management\New-Item -Path $Path -ItemType $ItemType -Force:$Force }
function Get-Item { param([string]$LiteralPath) if ($LiteralPath -like 'HKCU:*') { return (New-Object PSObject | Add-Member ScriptMethod GetValue { param($name) return '' } -PassThru) }; throw 'Unexpected Get-Item' }
function Set-Item { param([string]$Path,[string]$Value) if ($Path -notlike 'HKCU:*') { throw 'Unexpected Set-Item' }; [IO.File]::WriteAllText((Join-Path $env:LOCALAPPDATA 'registry-target.txt'),$Value) }
& $Script -ExtensionId $Id -NodePath $Node
`);
    await run(powershell,["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",harness,"-Script",script,"-Node",process.execPath,"-Id",first],{windowsHide:true,env:{...process.env,LOCALAPPDATA:root}});
    assert.deepEqual(JSON.parse(await readFile(installed,"utf8")).allowed_origins,[`chrome-extension://${first}/`]);
    assert.equal(await readFile(join(root,"registry-target.txt"),"utf8"),installed);
    assert.equal(await readFile(join(host,"chrome-native-host.mjs"),"utf8"),await readFile(new URL("../scripts/chrome-native-host.mjs",import.meta.url),"utf8"));
  } finally {await rm(root,{recursive:true,force:true});}
});
