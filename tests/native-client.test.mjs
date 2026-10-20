import {test} from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {PassThrough,Writable} from "node:stream";
import {setImmediate} from "node:timers/promises";
import {load} from "./load.mjs";

async function harness() {
  const driver={children:[],spawn(){
    const child=new EventEmitter();
    child.killed=false;child.writes=[];child.nextWriteError=undefined;
    child.stdin=new Writable({write(bytes,_encoding,callback){
      child.writes.push(JSON.parse(bytes.toString()));
      callback(child.nextWriteError);
    }});
    child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.kill=()=>{child.killed=true;return true;};
    child.output=value=>child.stdout.write(JSON.stringify(value)+"\n");
    driver.children.push(child);return child;
  }};
  globalThis.__nativeClientTest=driver;
  const mocks={name:"native-process",setup(build){
    build.initialOptions.define={"process.platform":'"win32"'};
    build.onResolve({filter:/^node:child_process$/},()=>({path:"child-process",namespace:"native-test"}));
    build.onLoad({filter:/.*/,namespace:"native-test"},()=>({contents:"const driver=globalThis.__nativeClientTest;export const spawn=(...args)=>driver.spawn(...args);",loader:"js"}));
  }};
  try {return {driver,client:await load("native-client",[mocks])};}
  finally {delete globalThis.__nativeClientTest;}
}

const snapshot={current:null,sessions:[],audio:null};

test("native commands expire at the client timeout and cannot override their expiry",async t=>{
  const {driver,client}=await harness();
  const now=1_000_000;
  t.mock.timers.enable({apis:["setTimeout","setInterval","Date"],now});
  const stop=client.startNative(()=>{},()=>{});t.after(stop);
  const child=driver.children[0];
  let settled=false;
  const command=client.nativeCommand({command:"mute",target:"master",expires_at:now+60000});
  void command.then(()=>{settled=true;},()=>{settled=true;});
  const pending=assert.rejects(command,/timed out/);
  assert.equal(child.writes[0].expires_at,now+5000);
  t.mock.timers.tick(4999);
  await Promise.resolve();
  assert.equal(settled,false);
  assert.equal(Date.now(),child.writes[0].expires_at-1);
  t.mock.timers.tick(1);
  await pending;
  assert.equal(settled,true);
  // A late reply to the expired request must not settle a subsequent command.
  const recovered=client.nativeCommand({command:"next",session_id:"new"});
  assert.equal(child.writes[1].expires_at,now+10000);
  child.output({reply:child.writes[0].id,ok:false,error:"Command expired before execution"});
  child.output({reply:child.writes[1].id,ok:true});
  await recovered;
});

test("a broken native input pipe rejects commands and restarts without unhandled stream errors",async t=>{
  const {driver,client}=await harness();
  t.mock.timers.enable({apis:["setTimeout","setInterval"]});
  const snapshots=[],errors=[];
  const stop=client.startNative(value=>snapshots.push(value),value=>errors.push(value));
  t.after(stop);
  const old=driver.children[0];old.output(snapshot);
  const pending=assert.rejects(client.nativeCommand({command:"next",session_id:"old"}),/disconnected/);
  old.nextWriteError=new Error("simulated EPIPE");
  const failed=assert.rejects(client.nativeCommand({command:"next",session_id:"old"}),/EPIPE/);
  await Promise.all([pending,failed]);await setImmediate();
  assert.equal(old.killed,true);
  assert.deepEqual(errors,["Windows helper input: simulated EPIPE"]);
  assert.equal(snapshots.length,2);
  await assert.rejects(client.nativeCommand({command:"next"}),/unavailable/);
  t.mock.timers.tick(3000);
  assert.equal(driver.children.length,2);
  const replacement=driver.children[1];
  const recovered=client.nativeCommand({command:"next",session_id:"new"});
  // Old process events must not clear a replacement's pending command or restart it.
  old.output(snapshot);old.emit("close",1);old.emit("error",new Error("late failure"));
  replacement.output({reply:replacement.writes[0].id,ok:true});
  await recovered;
  assert.equal(snapshots.length,2);assert.equal(errors.length,1);
  t.mock.timers.tick(3000);
  assert.equal(driver.children.length,2);
});

test("stopping native polling immediately rejects pending commands and suppresses late output and restarts",async t=>{
  const {driver,client}=await harness();
  t.mock.timers.enable({apis:["setTimeout","setInterval"]});
  const snapshots=[],errors=[];
  const stop=client.startNative(value=>snapshots.push(value),value=>errors.push(value));
  t.after(stop);
  const child=driver.children[0];child.output(snapshot);
  const rejected=assert.rejects(client.nativeCommand({command:"next"}),/disconnected/);
  stop();stop();await rejected;
  await assert.rejects(client.nativeCommand({command:"next"}),/unavailable/);
  child.output(snapshot);child.emit("close",0);child.stderr.write("late stderr");
  child.stdin.emit("error",new Error("late EPIPE"));
  child.stdout.emit("error",new Error("late output failure"));
  t.mock.timers.tick(30000);
  assert.equal(child.killed,true);assert.equal(driver.children.length,1);
  assert.equal(snapshots.length,1);assert.deepEqual(errors,[]);
});

test("stopping an older polling instance cannot kill or reject commands of a newer helper",async t=>{
  const {driver,client}=await harness();
  t.mock.timers.enable({apis:["setTimeout","setInterval"]});
  const stopOld=client.startNative(()=>{},()=>{});t.after(stopOld);
  const oldPending=assert.rejects(client.nativeCommand({command:"next"}),/disconnected/);
  const stopNew=client.startNative(()=>{},()=>{});t.after(stopNew);
  const replacement=driver.children[1];
  const newPending=client.nativeCommand({command:"previous"});
  stopOld();await oldPending;
  assert.equal(driver.children[0].killed,true);assert.equal(replacement.killed,false);
  driver.children[0].emit("close",0);
  replacement.output({reply:replacement.writes[0].id,ok:true});await newPending;
});

test("commands reject an ended input stream before writing",async t=>{
  const {driver,client}=await harness();
  const stop=client.startNative(()=>{},()=>{});t.after(stop);
  const child=driver.children[0];child.stdin.end();
  await assert.rejects(client.nativeCommand({command:"next"}),/unavailable/);
  assert.equal(child.writes.length,0);
});
