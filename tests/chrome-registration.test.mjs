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

test("registration detects only this extension across Chrome profiles without writing profile files",{skip:process.platform!=="win32"},async()=>{
  const root=await mkdtemp(join(tmpdir(),"chrome-registration-"));
  try {
    const extension=join(root,"extension with spaces");await mkdir(extension);
    await writeFile(join(extension,"manifest.json"),JSON.stringify(manifest));
    const prefs={extensions:{settings:{
      [first]:{path:extension},[other]:{manifest:{...manifest,name:"Another extension"}},
      ["d".repeat(32)]:{manifest,state:0},["invalid-id"]:{manifest}
    }}};
    await mkdir(join(root,"Default"));await mkdir(join(root,"Profile 2"));
    const prefPath=join(root,"Default","Secure Preferences"),original=JSON.stringify(prefs);
    await writeFile(prefPath,original);
    await writeFile(join(root,"Default","Preferences"),"{ incomplete");
    await writeFile(join(root,"Profile 2","Preferences"),JSON.stringify({extensions:{settings:{[first]:{manifest},[second]:{manifest}}}}));
    const {stdout}=await run(powershell,["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",script,"-ChromeUserDataDir",root,"-NodePath",process.execPath,"-DetectOnly"],{windowsHide:true});
    assert.deepEqual(stdout.trim().split(/\r?\n/),[first,second]);
    assert.equal(await readFile(prefPath,"utf8"),original);
  } finally {await rm(root,{recursive:true,force:true});}
});

test("no extension returns a retryable status; explicit ID works without any profile",{skip:process.platform!=="win32"},async()=>{
  const root=await mkdtemp(join(tmpdir(),"chrome-empty-"));
  try {
    const args=["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",script,"-ChromeUserDataDir",root,"-NodePath",process.execPath,"-DetectOnly"];
    await assert.rejects(run(powershell,args,{windowsHide:true}),error=>error.code===2&&error.stdout.includes("not found yet"));
    const {stdout}=await run(powershell,[...args,"-ExtensionId",first],{windowsHide:true});
    assert.equal(stdout.trim(),first);
    await assert.rejects(run(powershell,[...args,"-ExtensionId","invalid"],{windowsHide:true}),error=>error.code!==0);
  } finally {await rm(root,{recursive:true,force:true});}
});

test("registration runs only when requested, shares pending work, and never retries automatically",{skip:process.platform!=="win32"},async t=>{
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
    const firstAttempt=registerChromeHost(log);
    assert.equal(state.calls.length,1);
    assert.equal(state.calls[0].file,powershell);
    assert.equal(state.calls[0].args.at(-1),process.execPath);
    assert.equal(state.calls[0].options.windowsHide,true);
    assert.equal(state.calls[0].options.timeout,20000);
    assert.equal(registerChromeHost(log),firstAttempt,"another click shares the pending registration");
    t.mock.timers.tick(120000);assert.equal(state.calls.length,1);
    state.calls[0].callback({code:2});assert.equal((await firstAttempt).status,"not-found");
    t.mock.timers.tick(120000);assert.equal(state.calls.length,1,"missing extensions do not trigger polling");
    const secondAttempt=registerChromeHost(log);assert.equal(state.calls.length,2);
    state.calls[1].callback(null);assert.equal((await secondAttempt).status,"registered");
    t.mock.timers.tick(120000);assert.equal(state.calls.length,2);
    const failedAttempt=registerChromeHost(log);state.calls[2].callback({code:1,message:"Access denied"});
    assert.equal((await failedAttempt).status,"failed");assert.match(logs.at(-1),/Access denied/);
    const stoppedAttempt=registerChromeHost(log);stopChromeRegistration();assert.equal(state.kills,1);
    state.calls[3].callback({code:"ABORT_ERR",message:"Stopped"});assert.equal((await stoppedAttempt).status,"failed");
    t.mock.timers.tick(120000);assert.equal(state.calls.length,4);
  } finally {stopChromeRegistration();delete globalThis.__chromeRegistrationTest;}
});
