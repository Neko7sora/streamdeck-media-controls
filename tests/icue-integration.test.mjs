import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {load} from './load.mjs';
import {tls, httpsFetch as fetch} from './tls-fixture.mjs';
import {icueBackend} from './icue-backend.mjs';
const {startIcueServer} = await load('icue-server');

async function setup(t, saved = {}) {
  const fixture = icueBackend(), servers = [];
  const driver = {saved:structuredClone(saved), starts:0, writes:[], logs:[],
    async read() {return structuredClone(this.saved);},
    async write(value) {if (this.failSave) throw new Error('save failed'); this.saved=value; this.writes.push(value);},
    start() {
      this.starts++;
      if (this.failStart) throw new Error('credentials unavailable');
      const server = startIcueServer(fixture.backend, {tls, token:'c'.repeat(64), port:0});
      servers.push(server); return {server, tokenFile:'test-token-file'};
    }};
  globalThis.__icueIntegrationTest = driver;
  const mocks = {sdk:`const d=globalThis.__icueIntegrationTest;export default {
    settings:{getGlobalSettings:()=>d.read(),setGlobalSettings:v=>d.write(v),
      onDidReceiveGlobalSettings(fn){d.receive=fn;return {dispose(){d.disposed=true;}};}},
    logger:{info:s=>d.logs.push(s),error:s=>d.logs.push(s)}};`,
    runtime:`export const startIcueBridge=()=>globalThis.__icueIntegrationTest.start();`};
  const ports = {name:'integration-ports', setup(build) {
    build.onResolve({filter:/@elgato\/streamdeck$|\.\/icue-runtime\.js$/}, args => ({
      path:args.path.includes('icue-runtime')?'runtime':'sdk', namespace:'test'}));
    build.onLoad({filter:/.*/, namespace:'test'}, args => ({contents:mocks[args.path], loader:'js'}));
  }};
  const services = [];
  const fresh = async () => {const service=await load('icue-integration',[ports]); services.push(service); return service;};
  t.after(async () => {
    const closing=servers.filter(server=>server.listening).map(server=>once(server,'close'));
    for (const service of services) service.stopIcueIntegration();
    await Promise.all(closing);
    delete globalThis.__icueIntegrationTest;
  });
  return {driver, fixture, servers, fresh, service:await fresh()};
}

test('saved global off prevents startup and survives plugin reload without changing other settings', async t => {
  const f=await setup(t,{icueBridgeEnabled:false,other:'keep'});
  await f.service.initializeIcueIntegration();
  assert.equal(f.driver.starts,0);
  assert.equal(f.service.icueIntegrationStatus().state,'disabled');
  await f.service.setIcueIntegrationEnabled(true);
  assert.equal(f.service.icueIntegrationStatus().state,'running');
  assert.equal(f.driver.saved.other,'keep');
  await f.service.setIcueIntegrationEnabled(false);
  assert.equal(f.servers[0].listening,false);
  f.service.stopIcueIntegration();
  const restarted=await f.fresh();
  await restarted.initializeIcueIntegration();
  assert.equal(f.driver.starts,1,'saved off must not transiently open a port after restarting');
  assert.equal(restarted.icueIntegrationStatus().enabled,false);
  assert.equal(f.driver.disposed,true);
});

test('switching off closes authenticated iCUE streams and rapid toggles leave only the final state', {timeout:5000}, async t => {
  const f=await setup(t);
  await f.service.initializeIcueIntegration();
  assert.equal(f.service.icueIntegrationStatus().state,'running');
  const server=f.servers[0];
  const released=new Promise(resolve=>{
    const subscribe=f.fixture.backend.subscribe;
    f.fixture.backend.subscribe=callback=>{const unsubscribe=subscribe(callback);return ()=>{unsubscribe();resolve();};};
  });
  const response=await fetch(`https://127.0.0.1:${server.address().port}/events`,{
    headers:{authorization:'Bearer '+'c'.repeat(64), origin:'null'}});
  const reader=response.body.getReader();await reader.read();
  assert.equal(f.fixture.listeners.size,1);
  const closed=once(server,'close');
  await f.service.setIcueIntegrationEnabled(false);await closed;
  await released;
  assert.equal(f.fixture.listeners.size,0);
  await reader.cancel().catch(()=>{});
  await Promise.all([f.service.setIcueIntegrationEnabled(true),f.service.setIcueIntegrationEnabled(false),
    f.service.setIcueIntegrationEnabled(true),f.service.setIcueIntegrationEnabled(false)]);
  assert.equal(f.servers.some(server=>server.listening),false);
  assert.equal(f.driver.saved.icueBridgeEnabled,false);
  assert.equal(f.service.icueIntegrationStatus().state,'disabled');
});

test('save failures retain the running bridge; startup errors remain recoverable and global events apply', async t => {
  const f=await setup(t,{other:42});
  await f.service.initializeIcueIntegration();
  f.driver.failSave=true;
  await assert.rejects(f.service.setIcueIntegrationEnabled(false),/save failed/);
  assert.equal(f.service.icueIntegrationStatus().state,'running');
  assert.equal(f.servers[0].listening,true);
  f.driver.failSave=false;
  await f.service.setIcueIntegrationEnabled(false);
  f.driver.failStart=true;
  await f.service.setIcueIntegrationEnabled(true);
  assert.equal(f.service.icueIntegrationStatus().state,'error');
  f.driver.failStart=false;
  await f.service.setIcueIntegrationEnabled(true);
  assert.equal(f.service.icueIntegrationStatus().state,'running');
  const closed=once(f.servers.at(-1),'close');
  f.driver.saved={other:42,icueBridgeEnabled:false};
  f.driver.receive({settings:f.driver.saved});await closed;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.service.icueIntegrationStatus().state,'disabled');
  assert.equal(f.driver.saved.other,42);
});

test('shutdown during an initial settings read never starts a bridge', async t => {
  const f=await setup(t);
  let release;
  f.driver.read=()=>new Promise(resolve=>{release=resolve;});
  const initializing=f.service.initializeIcueIntegration();
  await new Promise(resolve=>setImmediate(resolve));
  f.service.stopIcueIntegration();release({});await initializing;
  assert.equal(f.driver.starts,0);
  await assert.rejects(f.service.setIcueIntegrationEnabled(true),/Plugin stopped/);
});
