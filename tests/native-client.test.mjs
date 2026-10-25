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

test("a failed native delta clears stale media and restarts from a complete snapshot",async t=>{
  const {driver,client}=await harness();
  t.mock.timers.enable({apis:["setTimeout","setInterval","Date"],now:1_000_000});
  const snapshots=[],errors=[];
  const stop=client.startNative(value=>snapshots.push(value),value=>errors.push(value));t.after(stop);
  const old=driver.children[0];
  old.output({native_wire:2,reset:true,changes:{current:"old",sessions:[{session_id:"old",title:"Old track"}],audio:null},images:{}});
  assert.equal(snapshots.at(-1).current.title,"Old track");
  const pending=assert.rejects(client.nativeCommand({command:"next",session_id:"old"}),/disconnected/);
  // A missing image invalidates the delta base. Subsequent empty heartbeats
  // cannot reconstruct it, so keeping this helper alive would freeze old media.
  old.output({native_wire:2,changes:{sessions:[{session_id:"old",title:"Lost update",artwork_data_url:{image:"missing"}}]},images:{}});
  assert.equal(old.killed,true);
  await pending;
  assert.deepEqual(snapshots.at(-1),snapshot);
  assert.match(errors[0],/Missing native image/);
  old.output({native_wire:2,changes:{},images:{}});
  old.output({...snapshot,sessions:[{title:"Late output"}]});
  assert.equal(snapshots.length,2);
  await assert.rejects(client.nativeCommand({command:"next",session_id:"old"}),/unavailable/);
  t.mock.timers.tick(2999);assert.equal(driver.children.length,1);
  t.mock.timers.tick(1);assert.equal(driver.children.length,2);
  const replacement=driver.children[1];
  replacement.output({native_wire:2,reset:true,changes:{current:"new",sessions:[{session_id:"new",title:"Recovered",artwork_data_url:{image:"1"}}],audio:null},images:{1:"data:image/png;base64,AQ=="}});
  assert.equal(snapshots.at(-1).current.title,"Recovered");
  assert.equal(snapshots.at(-1).current.artwork_data_url,"data:image/png;base64,AQ==");
  const recovered=client.nativeCommand({command:"next",session_id:"new"});
  replacement.output({reply:replacement.writes[0].id,ok:true});await recovered;
});

test("malformed native JSON and invalid snapshots trigger one recovery and discard the rest of the chunk",async t=>{
  for(const line of ["{broken JSON}",JSON.stringify({current:null,sessions:"invalid"})]) {
    await t.test(line,async t=>{
      const {driver,client}=await harness();
      t.mock.timers.enable({apis:["setTimeout","setInterval"]});
      const snapshots=[],errors=[];
      const stop=client.startNative(value=>snapshots.push(value),value=>errors.push(value));t.after(stop);
      const child=driver.children[0];
      child.stdout.write(line+"\n"+JSON.stringify({...snapshot,sessions:[{title:"Stale output"}]})+"\n");
      assert.equal(child.killed,true);
      assert.deepEqual(snapshots,[snapshot]);
      assert.equal(errors.length,1);
      assert.match(errors[0],/^Native output:/);
      child.emit("close",1);
      t.mock.timers.tick(3000);assert.equal(driver.children.length,2);
      driver.children[1].output({...snapshot,sessions:[{title:"Recovered"}]});
      assert.equal(snapshots.at(-1).sessions[0].title,"Recovered");
    });
  }
});

test("snapshot callback failures do not restart a healthy helper or prevent protocol recovery",async t=>{
  const {driver,client}=await harness();
  t.mock.timers.enable({apis:["setTimeout","setInterval"]});
  const errors=[];
  const stop=client.startNative(()=>{throw Error("Display subscriber failed");},value=>errors.push(value));t.after(stop);
  const child=driver.children[0];child.output(snapshot);
  assert.equal(child.killed,false);
  assert.match(errors[0],/Native snapshot callback:.*Display subscriber failed/);
  const command=client.nativeCommand({command:"mute",target:"master"});
  child.output({reply:child.writes[0].id,ok:true});await command;
  child.stdout.write("invalid JSON\n");
  assert.equal(child.killed,true);
  t.mock.timers.tick(3000);assert.equal(driver.children.length,2);
  driver.children[1].output(snapshot);
  assert.equal(driver.children[1].killed,false);
});

test("oversized complete native lines are rejected before publishing their contents",async t=>{
  const {driver,client}=await harness();
  t.mock.timers.enable({apis:["setTimeout","setInterval"]});
  const snapshots=[],errors=[];
  const stop=client.startNative(value=>snapshots.push(value),value=>errors.push(value));t.after(stop);
  const child=driver.children[0];
  const pending=assert.rejects(client.nativeCommand({command:"next"}),/disconnected/);
  // Trailing JSON whitespace keeps this a valid snapshot, so an unbounded
  // readline parser would publish it before a later data listener checks size.
  const oversized=Buffer.alloc(64_000_002,32);
  oversized.write(JSON.stringify({...snapshot,sessions:[{title:"Must not be published"}]}));
  oversized[oversized.length-1]=10;
  child.stdout.write(oversized);
  await pending;
  assert.deepEqual(snapshots,[snapshot]);
  assert.deepEqual(errors,["Windows helper output exceeded limit"]);
  assert.equal(child.killed,true);
  t.mock.timers.tick(3000);
  assert.equal(driver.children.length,2);
  driver.children[1].output({...snapshot,sessions:[{title:"Recovered"}]});
  assert.equal(snapshots.at(-1).sessions[0].title,"Recovered");
});

test("native line limits include a partial line after the last newline in each chunk",async t=>{
  const {driver,client}=await harness();
  t.mock.timers.enable({apis:["setTimeout","setInterval"]});
  const snapshots=[],errors=[];
  const stop=client.startNative(value=>snapshots.push(value),value=>errors.push(value));t.after(stop);
  const child=driver.children[0];
  const first=Buffer.concat([Buffer.from(JSON.stringify(snapshot)+"\n"),Buffer.alloc(32_000_001,32)]);
  child.stdout.write(first);
  assert.equal(child.killed,false);
  const second=Buffer.concat([Buffer.alloc(32_000_000,32),Buffer.from(JSON.stringify({...snapshot,sessions:[{title:"Too large"}]})+"\n")]);
  child.stdout.write(second);
  assert.equal(child.killed,true);
  assert.equal(snapshots.length,2);
  assert.ok(snapshots.every(value=>value.sessions.length===0));
  assert.deepEqual(errors,["Windows helper output exceeded limit"]);
});

test("native JSON lines preserve split UTF-8, CRLF, batched lines and a final unterminated line",async t=>{
  const {driver,client}=await harness();
  const snapshots=[],errors=[];
  const stop=client.startNative(value=>snapshots.push(value),value=>errors.push(value));t.after(stop);
  const child=driver.children[0];
  const line=title=>JSON.stringify({...snapshot,sessions:[{title}]});
  const unicode=Buffer.from(line("日本語")+"\r\n");
  const split=unicode.indexOf(Buffer.from("日"))+1;
  child.stdout.write(unicode.subarray(0,split));
  assert.equal(snapshots.length,0);
  child.stdout.write(unicode.subarray(split,unicode.length-1));
  assert.equal(snapshots.length,0);
  child.stdout.write(Buffer.from("\n"+line("Second")+"\n"+line("Final")));
  assert.deepEqual(snapshots.map(value=>value.sessions[0].title),["日本語","Second"]);
  child.stdout.end();await setImmediate();
  assert.deepEqual(snapshots.map(value=>value.sessions[0].title),["日本語","Second","Final"]);
  assert.deepEqual(errors,[]);
});
