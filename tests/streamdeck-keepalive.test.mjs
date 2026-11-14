import {test} from "node:test";
import assert from "node:assert/strict";
import {load} from "./load.mjs";

test("idle host probes continue without visible actions and stop on shutdown",async t=>{
  const {startStreamDeckKeepalive}=await load("streamdeck/streamdeck-keepalive");
  t.mock.timers.enable({apis:["setInterval"]});
  let calls=0;
  const errors=[];
  const stop=startStreamDeckKeepalive(async()=>{calls++;},message=>errors.push(message));t.after(stop);
  assert.equal(calls,0);
  for(let minute=0;minute<10;minute++) {
    for(let quarter=0;quarter<4;quarter++) {t.mock.timers.tick(15000);await Promise.resolve();}
  }
  assert.equal(calls,40);assert.deepEqual(errors,[]);
  stop();stop();t.mock.timers.tick(60000);await Promise.resolve();
  assert.equal(calls,40);
});

test("an unanswered host probe stays bounded and resumes after a late reply",async t=>{
  const {startStreamDeckKeepalive}=await load("streamdeck/streamdeck-keepalive");
  t.mock.timers.enable({apis:["setInterval"]});
  let calls=0,reply;
  const stop=startStreamDeckKeepalive(()=>{calls++;return new Promise(resolve=>{reply=resolve;});},()=>{});t.after(stop);
  t.mock.timers.tick(15000);assert.equal(calls,1);
  t.mock.timers.tick(3600000);assert.equal(calls,1);
  reply({});await Promise.resolve();
  t.mock.timers.tick(15000);assert.equal(calls,2);
  stop();reply({});await Promise.resolve();
  t.mock.timers.tick(60000);assert.equal(calls,2);
});

test("probe failures are handled and late failures after shutdown stay quiet",async t=>{
  const {startStreamDeckKeepalive}=await load("streamdeck/streamdeck-keepalive");
  t.mock.timers.enable({apis:["setInterval"]});
  const errors=[];let calls=0,reject;
  const stop=startStreamDeckKeepalive(()=>{
    calls++;if(calls===1) throw Error("unavailable");
    return new Promise((_,fail)=>{reject=fail;});
  },message=>errors.push(message));t.after(stop);
  t.mock.timers.tick(15000);await Promise.resolve();
  assert.deepEqual(errors,["Stream Deck keepalive: Error: unavailable"]);
  t.mock.timers.tick(15000);assert.equal(calls,2);
  stop();reject(Error("closed"));await Promise.resolve();
  assert.equal(errors.length,1);
});
