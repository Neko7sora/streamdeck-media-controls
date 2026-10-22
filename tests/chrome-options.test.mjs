import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source=readFileSync(new URL("../chrome-extension/localization.js",import.meta.url),"utf8")+'\n'+readFileSync(new URL("../chrome-extension/options.js",import.meta.url),"utf8");
const flush=()=>new Promise(setImmediate);
function deferred(){
  let resolve,reject;
  const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});
  return {promise,resolve,reject};
}
function options({language="ja",load=Promise.resolve({}),write=async()=>{},connect,connection=Promise.resolve({state:'disabled'})}={}){
  const elements=new Map(["enabled","token","status","save","connection","connection-title","connection-detail"].map(id=>[id,{
    dataset:{},
    checked:false,value:"",textContent:"",disabled:false,listeners:{},
    addEventListener(event,fn){this.listeners[event]=fn;}
  }]));
  const writes=[];
  const timers=new Map();let nextTimer=0,poll;
  vm.runInNewContext(source,{setInterval(fn){poll=fn;},setTimeout(fn){timers.set(++nextTimer,fn);return nextTimer;},clearTimeout(id){timers.delete(id);},document:{documentElement:{},querySelectorAll:()=>[],getElementById:id=>elements.get(id)},chrome:{i18n:{getUILanguage:()=>language},runtime:{connect,async sendMessage(){return typeof connection==="function"?connection():connection;}},storage:{local:{
    get:()=>load,
    set(value){writes.push({...value});return write(value);}
  }}}});
  return {elements,writes,poll:()=>poll(),timeout(){for(const [id,fn] of timers){timers.delete(id);fn();}},save:()=>elements.get("save").listeners.click()};
}
function assertDisabled(page,disabled){
  for(const id of ["enabled","save"]) assert.equal(page.elements.get(id).disabled,disabled,id);
}

test('English and unsupported Chrome languages use English connection and save messages',async()=>{
  for(const language of ['en-US','de']) {
    const page=options({language,connection:Promise.resolve({state:'connected'})});
    await flush();
    assert.equal(page.elements.get('connection-title').textContent,'Connected to Stream Deck');
    await page.save();
    assert.equal(page.elements.get('status').textContent,'Settings saved.');
  }
});

test('popup receives pushed changes and ignores an older status request after a push',async()=>{
  const gate=deferred(),sent=[];let receive,disconnect;
  const port={onMessage:{addListener(fn){receive=fn;}},onDisconnect:{addListener(fn){disconnect=fn;}},postMessage(value){sent.push(value);}};
  const page=options({connection:gate.promise,connect:()=>port});
  receive({state:'connected'});gate.resolve({state:'disabled'});await flush();
  assert.equal(page.elements.get('connection').dataset.state,'connected');
  page.poll();assert.equal(sent.at(-1).type,'status');
  receive({state:'disabled'});assert.equal(page.elements.get('connection').dataset.state,'disabled');
  disconnect();assert.equal(page.elements.get('connection').dataset.state,'unavailable');
});

test('popup shows live connection, disabled sending and connection failures separately from saved settings',async()=>{
  for(const [state,label] of [['connected','接続済み'],['disabled','送信は無効'],['disconnected','未接続']]) {
    const page=options({load:Promise.resolve({enabled:true}),connection:Promise.resolve({state})});await flush();
    assert.equal(page.elements.get('connection').dataset.state,state);
    assert.ok(page.elements.get('connection-title').textContent.includes(label));
    assert.equal(page.elements.get('status').textContent,'');
  }
  const failure=deferred();const page=options({connection:failure.promise});failure.reject(Error('worker unavailable'));await flush();
  assert.equal(page.elements.get('connection').dataset.state,'unavailable');
  assert.match(page.elements.get('connection-title').textContent,/確認できません/);
  assert.doesNotMatch(page.elements.get('connection-detail').textContent,/連携を登録/);
});

test('missing or malformed worker responses do not claim that Stream Deck is disconnected',async()=>{
  for(const response of [undefined,{}, {state:'unknown'}]) {
    const page=options({connection:Promise.resolve(response)});await flush();
    assert.equal(page.elements.get('connection').dataset.state,'unavailable');
    assert.doesNotMatch(page.elements.get('connection-title').textContent,/未接続/);
  }
});

test('a stalled connection check expires, ignores late success and recovers on the next poll',async()=>{
  const initial=deferred(),stalled=deferred();let calls=0;
  const page=options({connection:()=>++calls===1?initial.promise:calls===2?stalled.promise:Promise.resolve({state:'disconnected'})});
  initial.resolve({state:'connected'});await flush();
  assert.equal(page.elements.get('connection').dataset.state,'connected');
  page.poll();page.poll();
  assert.equal(calls,2,'polling must not accumulate requests while the worker is silent');
  page.timeout();
  assert.equal(page.elements.get('connection').dataset.state,'unavailable');
  stalled.resolve({state:'connected'});await flush();
  assert.equal(page.elements.get('connection').dataset.state,'unavailable','an expired reply cannot revive a connected indicator');
  page.poll();await flush();
  assert.equal(page.elements.get('connection').dataset.state,'disconnected');
});

test('saving settings starts a new connection check and an older response cannot undo it',async()=>{
  const earlier=deferred(),latest=deferred();let calls=0;
  const page=options({load:Promise.resolve({enabled:true}),connection:()=>++calls===1?earlier.promise:latest.promise});
  await flush();page.elements.get('enabled').checked=false;
  await page.save();
  assert.equal(calls,2,'saving must not wait for the previous connection check');
  latest.resolve({state:'disabled'});await flush();
  assert.equal(page.elements.get('connection').dataset.state,'disabled');
  earlier.resolve({state:'connected'});await flush();
  assert.equal(page.elements.get('connection').dataset.state,'disabled');
  page.timeout();
  assert.equal(page.elements.get('connection').dataset.state,'disabled');
});

test("options cannot overwrite saved settings before their initial read finishes",async()=>{
  const load=deferred(),page=options({load:load.promise});
  assertDisabled(page,true);
  await page.save();
  assert.equal(page.writes.length,0);
  load.resolve({enabled:true});
  await flush();
  assertDisabled(page,false);
  assert.equal(page.elements.get("enabled").checked,true);
  page.elements.get("enabled").checked=false;
  await page.save();
  assert.deepEqual(page.writes,[{enabled:false}]);
});

test("failed initial reads keep controls disabled and never save empty defaults",async()=>{
  const load=deferred(),page=options({load:load.promise});
  load.reject(new Error("Storage unavailable"));
  await flush();
  assertDisabled(page,true);
  assert.match(page.elements.get("status").textContent,/読み込めませんでした/);
  await page.save();
  assert.equal(page.writes.length,0);
});

test("options serialize saves without a pairing token",async()=>{
  const write=deferred(),page=options({write:()=>write.promise});
  await flush();
  page.elements.get("enabled").checked=true;
  const saved=page.save();
  assertDisabled(page,true);
  await page.save();
  assert.deepEqual(page.writes,[{enabled:true}]);
  write.resolve();
  await saved;
  assertDisabled(page,false);
  assert.match(page.elements.get("status").textContent,/保存しました/);
});

test("failed saves preserve edits and release the form for retry",async()=>{
  let attempts=0;
  const page=options({write:async()=>{if(++attempts===1) throw new Error("Storage unavailable");}});
  await flush();
  page.elements.get("enabled").checked=true;
  page.elements.get("token").value="c".repeat(64);
  await page.save();
  assertDisabled(page,false);
  assert.equal(page.elements.get("enabled").checked,true);
  assert.match(page.elements.get("status").textContent,/保存できませんでした/);
  await page.save();
  assert.equal(page.writes.length,2);
  assert.match(page.elements.get("status").textContent,/保存しました/);
});
