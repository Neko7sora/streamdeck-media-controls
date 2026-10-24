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
  const elements=new Map(["enabled","token","status","save","connection","connection-title","connection-detail","retry-connection","setup","setup-summary"].map(id=>[id,{
    dataset:{},
    checked:false,value:"",textContent:"",disabled:false,open:id==="setup",listeners:{},
    addEventListener(event,fn){this.listeners[event]=fn;}
  }]));
  const writes=[];
  const timers=new Map();let nextTimer=0,poll,now=1000;
  vm.runInNewContext(source,{Date:{now:()=>now},setInterval(fn){poll=fn;},setTimeout(fn){timers.set(++nextTimer,fn);return nextTimer;},clearTimeout(id){timers.delete(id);},document:{documentElement:{},querySelectorAll:()=>[],getElementById:id=>elements.get(id)},chrome:{i18n:{getUILanguage:()=>language},runtime:{connect,async sendMessage(){return typeof connection==="function"?connection():connection;}},storage:{local:{
    get:()=>load,
    set(value){writes.push({...value});return write(value);}
  }}}});
  return {elements,writes,poll:()=>poll(),advance(ms,runPoll=true){now+=ms;if(runPoll) poll();},timeout(){for(const [id,fn] of timers){timers.delete(id);fn();}},change(value){elements.get("enabled").checked=value;elements.get("enabled").listeners.change();},save:()=>elements.get("save").listeners.click(),retry:()=>elements.get("retry-connection").listeners.click(),toggleSetup(){elements.get("setup-summary").listeners.click();elements.get("setup").open=!elements.get("setup").open;}};
}
function statusPort(){
  let receive,onDisconnect;
  return {sent:[],disconnected:false,onMessage:{addListener(fn){receive=fn;}},onDisconnect:{addListener(fn){onDisconnect=fn;}},
    postMessage(message){this.sent.push(message);},receive(message){receive(message);},
    disconnect(){this.disconnected=true;onDisconnect();}};
}
function assertDisabled(page,disabled,saveDisabled=disabled){
  assert.equal(page.elements.get("enabled").disabled,disabled,"enabled");
  assert.equal(page.elements.get("save").disabled,saveDisabled,"save");
}

test('English and unsupported Chrome languages use English connection and save messages',async()=>{
  for(const language of ['en-US','de']) {
    const page=options({language,connection:Promise.resolve({state:'connected'})});
    await flush();
    assert.equal(page.elements.get('connection-title').textContent,'Connected to Stream Deck');
    page.change(true);
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

test('a disconnected status port invalidates pending replies before reconnecting',async()=>{
  const pending=deferred(),ports=[statusPort(),statusPort()];let connections=0,requests=0;
  const page=options({connect:()=>ports[connections++],connection:()=>++requests===1?pending.promise:Promise.resolve({state:'disabled'})});
  ports[0].disconnect();
  assert.equal(page.elements.get('connection').dataset.state,'unavailable');
  pending.resolve({state:'connected'});await flush();
  assert.equal(page.elements.get('connection').dataset.state,'unavailable','pre-disconnect replies must not restore connected status');
  page.poll();await flush();
  assert.equal(connections,2);
  assert.equal(page.elements.get('connection').dataset.state,'disabled');
  ports[0].receive({state:'connected'});
  assert.equal(page.elements.get('connection').dataset.state,'disabled');
  ports[1].receive({state:'connected'});
  assert.equal(page.elements.get('connection').dataset.state,'connected');
});

test('a silent status port is released and replaced while settings edits are preserved',async()=>{
  const pending=deferred(),ports=[statusPort(),statusPort()];let connections=0,requests=0;
  const page=options({connect:()=>ports[connections++],connection:()=>++requests===1?Promise.resolve({state:'connected'}):pending.promise});
  await flush();ports[0].receive({state:'connected'});page.change(true);
  page.advance(5000);
  assert.equal(connections,1,'a healthy port should be reused');
  assert.equal(ports[0].sent.at(-1).type,'status');
  page.advance(5000);
  assert.equal(ports[0].disconnected,true);
  assert.equal(connections,2,'a silent port must not permanently suppress reconnects');
  assert.equal(page.elements.get('connection').dataset.state,'unavailable');
  ports[1].receive({state:'disabled'});
  ports[0].disconnect();ports[0].receive({state:'connected'});
  pending.resolve({state:'connected'});await flush();
  assert.equal(page.elements.get('connection').dataset.state,'disabled');
  assert.equal(page.elements.get('enabled').checked,true);
  assert.equal(page.elements.get('save').disabled,false);
  assert.equal(page.elements.get('status').dataset.state,'dirty');
  assert.deepEqual(page.writes,[]);
});

test('a failed status-port send reconnects immediately without accepting its pending reply',async()=>{
  const pending=deferred(),ports=[statusPort(),statusPort()];let connections=0,requests=0;
  ports[0].postMessage=()=>{throw Error('port closed');};
  const page=options({connect:()=>ports[connections++],connection:()=>++requests===1?pending.promise:Promise.resolve({state:'disabled'})});
  page.poll();await flush();
  assert.equal(ports[0].disconnected,true);
  assert.equal(connections,2);
  assert.equal(page.elements.get('connection').dataset.state,'disabled');
  pending.resolve({state:'connected'});await flush();
  assert.equal(page.elements.get('connection').dataset.state,'disabled');
});

test('manual retry replaces a silent status port before starting a fresh connection check',async()=>{
  const pending=deferred(),ports=[statusPort(),statusPort()];let connections=0,requests=0;
  const page=options({connect:()=>ports[connections++],connection:()=>++requests===1?Promise.resolve({state:'connected'}):pending.promise});
  await flush();page.advance(8000,false);page.retry();
  assert.equal(ports[0].disconnected,true);
  assert.equal(connections,2);
  assert.equal(page.elements.get('connection').dataset.state,'checking');
  assert.equal(page.elements.get('retry-connection').disabled,true);
  ports[0].receive({state:'disabled'});
  pending.resolve({state:'connected'});await flush();
  page.advance(2000);
  assert.equal(page.elements.get('connection').dataset.state,'connected');
  assert.equal(connections,2,'the next poll should keep the replacement port');
  assert.equal(ports[1].sent.at(-1).type,'status');
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

test('manual connection retry gives immediate progress and can recover without changing settings',async()=>{
  const retried=deferred();let calls=0;
  const page=options({load:Promise.resolve({enabled:true}),connection:()=>++calls===1?Promise.resolve({state:'disconnected'}):retried.promise});
  await flush();
  assert.equal(page.elements.get('retry-connection').disabled,false);
  page.retry();
  assert.equal(calls,2);
  assert.equal(page.elements.get('connection').dataset.state,'checking');
  assert.equal(page.elements.get('retry-connection').disabled,true);
  retried.resolve({state:'connected'});await flush();
  assert.equal(page.elements.get('connection').dataset.state,'connected');
  assert.equal(page.elements.get('retry-connection').disabled,false);
  assert.deepEqual(page.writes,[]);
});

test('manual connection retry times out and offers recovery again',async()=>{
  const stalled=deferred();let calls=0;
  const page=options({connection:()=>++calls===1?Promise.resolve({state:'disconnected'}):stalled.promise});
  await flush();page.retry();page.timeout();
  assert.equal(page.elements.get('connection').dataset.state,'unavailable');
  assert.equal(page.elements.get('retry-connection').disabled,false);
  stalled.resolve({state:'connected'});await flush();
  assert.equal(page.elements.get('connection').dataset.state,'unavailable');
});

test('setup collapses when connected and reopens for disconnected users',async()=>{
  let state='connected';
  const page=options({connection:async()=>({state})});
  assert.equal(page.elements.get('setup').open,true);
  await flush();
  assert.equal(page.elements.get('setup').open,false);
  page.retry();
  assert.equal(page.elements.get('setup').open,false,'checking must not flash open the instructions');
  await flush();state='disconnected';page.poll();await flush();
  assert.equal(page.elements.get('setup').open,true);
});

test('connection updates preserve a setup disclosure manually opened or closed',async()=>{
  for(const initial of ['connected','disconnected']) {
    let state=initial;
    const page=options({connection:async()=>({state})});await flush();
    page.toggleSetup();
    const chosen=page.elements.get('setup').open;
    state=initial==='connected'?'disconnected':'connected';
    page.poll();await flush();
    assert.equal(page.elements.get('setup').open,chosen);
    state=initial;page.poll();await flush();
    assert.equal(page.elements.get('setup').open,chosen);
  }
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
  assertDisabled(page,false,true);
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
  assertDisabled(page,false,true);
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

test("Save is available only for changes and returning to the saved value clears the pending message",async()=>{
  const page=options();
  await flush();
  assertDisabled(page,false,true);
  await page.save();
  assert.equal(page.writes.length,0,'unchanged settings must not write storage');

  page.change(true);
  assertDisabled(page,false,false);
  assert.equal(page.elements.get('status').dataset.state,'dirty');
  assert.ok(page.elements.get('status').textContent);
  page.change(false);
  assertDisabled(page,false,true);
  assert.equal(page.elements.get('status').textContent,'');

  page.change(true);
  await page.save();
  assertDisabled(page,false,true);
  assert.equal(page.elements.get('status').dataset.state,'saved');
  await page.save();
  assert.equal(page.writes.length,1,'saved settings must not be written again');
  page.change(false);
  assertDisabled(page,false,false);
  assert.equal(page.elements.get('status').dataset.state,'dirty');
  page.change(true);
  assertDisabled(page,false,true);
  assert.equal(page.elements.get('status').textContent,'');
});
