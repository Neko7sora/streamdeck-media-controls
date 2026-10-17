import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source=readFileSync(new URL("../chrome-extension/options.js",import.meta.url),"utf8");
const flush=()=>new Promise(setImmediate);
function deferred(){
  let resolve,reject;
  const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});
  return {promise,resolve,reject};
}
function options({load=Promise.resolve({}),write=async()=>{}}={}){
  const elements=new Map(["enabled","token","status","save"].map(id=>[id,{
    checked:false,value:"",textContent:"",disabled:false,listeners:{},
    addEventListener(event,fn){this.listeners[event]=fn;}
  }]));
  const writes=[];
  vm.runInNewContext(source,{document:{getElementById:id=>elements.get(id)},chrome:{storage:{local:{
    get:()=>load,
    set(value){writes.push({...value});return write(value);}
  }}}});
  return {elements,writes,save:()=>elements.get("save").listeners.click()};
}
function assertDisabled(page,disabled){
  for(const id of ["enabled","save"]) assert.equal(page.elements.get(id).disabled,disabled,id);
}

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
