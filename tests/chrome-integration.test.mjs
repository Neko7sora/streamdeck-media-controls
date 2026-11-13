import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {load} from './load.mjs';
import {tls,httpsFetch as fetch} from './tls-fixture.mjs';

async function setup(t,saved={}) {
  const bridge=await load('chrome-server'),servers=[];
  const driver={saved:structuredClone(saved),starts:0,registrations:[],logs:[],
    async read(){return structuredClone(this.saved);},
    async write(value){if(this.failSave) throw Error('save failed');this.saved=value;},
    start(){this.starts++;if(this.failStart) throw Error('port in use');const server=bridge.startChromeServer(()=>{},{tls,token:'d'.repeat(64),port:0});servers.push(server);return server;},
    async register(id){this.registrations.push(id);return this.registration??{status:'registered',message:'Registered'};}};
  globalThis.__chromeIntegrationTest=driver;
  const mocks={sdk:`const d=globalThis.__chromeIntegrationTest;export default {
    settings:{getGlobalSettings:()=>d.read(),setGlobalSettings:v=>d.write(v),onDidReceiveGlobalSettings(fn){d.receive=fn;return {dispose(){d.disposed=true;}};}},
    logger:{info:s=>d.logs.push(s),warn:s=>d.logs.push(s),error:s=>d.logs.push(s)}};`,
    bridge:`export const PORT=39761;export const startChromeServer=()=>globalThis.__chromeIntegrationTest.start();`,
    registration:`export const registerChromeHost=id=>globalThis.__chromeIntegrationTest.register(id);`};
  const ports={name:'chrome-integration-ports',setup(build){
    build.onResolve({filter:/@elgato\/streamdeck$|\.\/chrome-server\.js$|\.\/chrome-registration\.js$/},args=>({path:args.path.includes('chrome-server')?'bridge':args.path.includes('chrome-registration')?'registration':'sdk',namespace:'test'}));
    build.onLoad({filter:/.*/,namespace:'test'},args=>({contents:mocks[args.path],loader:'js'}));
  }};
  const services=[];
  const fresh=async()=>{const service=await load('chrome-integration',[ports]);services.push(service);return service;};
  t.after(async()=>{const closing=servers.filter(s=>s.listening).map(s=>once(s,'close'));for(const s of services) s.stopChromeIntegration();await Promise.all(closing);delete globalThis.__chromeIntegrationTest;});
  const post=(path,body)=>fetch(`https://127.0.0.1:${servers.at(-1).address().port}${path}`,{method:'POST',headers:{authorization:'Bearer '+'d'.repeat(64),'content-type':'application/json'},body:JSON.stringify(body)});
  return {driver,bridge,servers,fresh,service:await fresh(),post};
}

test('Chrome disconnect persists across restart and reconnect retains registration and unrelated preferences',async t=>{
  const id='a'.repeat(32),f=await setup(t,{chromeBridgeEnabled:false,chromeExtensionId:id,icueBridgeEnabled:true,other:42});
  await f.service.initializeChromeIntegration();
  assert.equal(f.driver.starts,0);
  assert.equal(f.service.chromeIntegrationStatus().state,'disabled');
  assert.equal(f.service.chromeIntegrationStatus().extensionId,id);
  await f.service.setChromeIntegrationEnabled(true);
  assert.equal(f.service.chromeIntegrationStatus().state,'running');
  await f.service.setChromeIntegrationEnabled(false);
  assert.equal(f.servers[0].listening,false);
  f.service.stopChromeIntegration();
  const restarted=await f.fresh();await restarted.initializeChromeIntegration();
  assert.equal(f.driver.starts,1,'saved off never opens the receive port on startup');
  assert.equal(restarted.chromeIntegrationStatus().state,'disabled');
  assert.deepEqual(f.driver.saved,{chromeBridgeEnabled:false,chromeExtensionId:id,icueBridgeEnabled:true,other:42});
  assert.deepEqual(f.driver.registrations,[],'reconnect never silently registers an extension');
});

test('Chrome disconnect closes authenticated streams, rejects queued commands and clears sessions immediately',{timeout:5000},async t=>{
  const f=await setup(t);await f.service.initializeChromeIntegration();
  await f.post('/chrome',{tab_id:17,frame_id:0,document_id:'doc',sequence:1,media:{title:'Track'}});
  assert.equal(f.bridge.chromeConnectionStatus().sessions,1);
  const response=await fetch(`https://127.0.0.1:${f.servers[0].address().port}/chrome/events`,{headers:{authorization:'Bearer '+'d'.repeat(64),'x-sdmc-client':'11111111-1111-4111-8111-111111111111'}});
  const reader=response.body.getReader();await reader.read();
  const failed=assert.rejects(f.bridge.chromeCommand(17,0,'doc','Track','play-pause',undefined,'media-1'),/stopped/);
  await f.service.setChromeIntegrationEnabled(false);await failed;
  await reader.read().catch(()=>{});
  await assert.rejects(f.bridge.chromeCommand(17,0,'doc','Track','play-pause',undefined,'media-1'),/stopped/);
  await f.service.setChromeIntegrationEnabled(true);
  await f.post('/chrome/status',{});
  assert.equal(f.bridge.chromeConnectionStatus().sessions,0,'old targets must not survive reconnect');
  await Promise.all([f.service.setChromeIntegrationEnabled(false),f.service.setChromeIntegrationEnabled(true),f.service.setChromeIntegrationEnabled(false)]);
  assert.equal(f.servers.some(s=>s.listening),false);
});

test('Chrome reconfiguration validates IDs, saves only successful registrations and enables reconnect',async t=>{
  const first='a'.repeat(32),second='b'.repeat(32),f=await setup(t,{chromeBridgeEnabled:false,chromeExtensionId:first,other:'keep'});
  await f.service.initializeChromeIntegration();
  for(const id of [undefined,'',first+second,'invalid']) assert.equal((await f.service.configureChromeIntegration(id)).status,'failed');
  assert.deepEqual(f.driver.registrations,[]);
  f.driver.registration={status:'failed',message:'failed'};
  assert.equal((await f.service.configureChromeIntegration(second)).status,'failed');
  assert.equal(f.driver.saved.chromeExtensionId,first);
  assert.equal(f.driver.starts,0);
  f.driver.registration=undefined;
  assert.equal((await f.service.configureChromeIntegration(second)).status,'registered');
  assert.equal(f.service.chromeIntegrationStatus().extensionId,second);
  assert.equal(f.service.chromeIntegrationStatus().state,'running');
  assert.deepEqual(f.driver.saved,{chromeBridgeEnabled:true,chromeExtensionId:second,other:'keep'});
  let finish;f.driver.registration=new Promise(resolve=>{finish=resolve;});
  const configuring=f.service.configureChromeIntegration(first);
  assert.equal((await f.service.configureChromeIntegration(second)).status,'failed');
  finish({status:'registered',message:'Registered'});await configuring;
  assert.equal(f.driver.saved.chromeExtensionId,first);
});

test('Chrome save failures preserve the current connection, and startup errors can be retried',async t=>{
  const f=await setup(t);await f.service.initializeChromeIntegration();
  f.driver.failSave=true;
  await assert.rejects(f.service.setChromeIntegrationEnabled(false),/save failed/);
  assert.equal(f.servers[0].listening,true);
  f.driver.failSave=false;await f.service.setChromeIntegrationEnabled(false);
  f.driver.failStart=true;await f.service.setChromeIntegrationEnabled(true);
  assert.equal(f.service.chromeIntegrationStatus().state,'error');
  f.driver.failStart=false;await f.service.setChromeIntegrationEnabled(true);
  assert.equal(f.service.chromeIntegrationStatus().state,'running');
  f.driver.saved={chromeBridgeEnabled:false};f.driver.receive({settings:f.driver.saved});
  await once(f.servers.at(-1),'close');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.service.chromeIntegrationStatus().state,'disabled');
});

test('Chrome waits for settings and never opens a port if shutdown occurs during loading',async t=>{
  const f=await setup(t);let release;f.driver.read=()=>new Promise(resolve=>{release=resolve;});
  const initializing=f.service.initializeChromeIntegration();await new Promise(resolve=>setImmediate(resolve));
  f.service.stopChromeIntegration();release({});await initializing;
  assert.equal(f.driver.starts,0);
  await assert.rejects(f.service.setChromeIntegrationEnabled(true),/Plugin stopped/);
});
