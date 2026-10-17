import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

const source=await readFile(new URL("../chrome-extension/bridge-isolated.js",import.meta.url),"utf8");
function bridge(sendMessage) {
  let listener,now=10000,nextTimer=0;
  const timers=new Map();
  const window={addEventListener(type,fn){if(type==="message") listener=fn;}};
  const origin="https://media.test";
  const chrome={runtime:{sendMessage,onMessage:{addListener(){}}}};
  vm.runInNewContext(source,{window,location:{origin},chrome,Date:{now:()=>now},
    setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,at:now+delay});return id;},
    clearTimeout(id){timers.delete(id);}});
  const send=media=>listener({source:window,origin,data:{kind:"__streamdeck_media_metadata_v1__",media}});
  send.advance=async ms=>{
    const end=now+ms;
    while(true) {
      const next=Array.from(timers).filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next) break;
      const [id,timer]=next;timers.delete(id);now=timer.at;await timer.fn();
    }
    now=end;
  };
  return send;
}

test("isolated bridge forwards media updates",async()=>{
  const sent=[];
  const send=bridge(message=>{sent.push(message);return Promise.resolve();});
  const media={title:"Track"};
  await send(media);
  assert.equal(sent.length,1);
  assert.equal(sent[0].type,"MEDIA_UPDATE");
  assert.equal(sent[0].media,media);
});

test("isolated bridge handles synchronous extension context invalidation",async()=>{
  const send=bridge(()=>{throw new Error("Extension context invalidated.");});
  await assert.doesNotReject(()=>send({title:"Track"}));
});

test("isolated bridge handles rejected runtime messages",async()=>{
  const send=bridge(()=>Promise.reject(new Error("Receiving end does not exist.")));
  await assert.doesNotReject(()=>send({title:"Track"}));
});

test("isolated bridge delivers the latest pause and seek state at the throttle boundary",async()=>{
  const sent=[];
  const send=bridge(message=>{sent.push(message);return Promise.resolve();});
  await send({title:"Track",playback_state:"playing",timeline:{position_sec:10}});
  await send.advance(50);
  await send({title:"Track",playback_state:"paused",timeline:{position_sec:10}});
  await send.advance(50);
  const latest={title:"Track",playback_state:"paused",timeline:{position_sec:40}};
  await send(latest);
  await send.advance(149);
  assert.equal(sent.length,1);
  await send.advance(1);
  assert.equal(sent.length,2);
  assert.equal(sent[1].media,latest);
  await send.advance(1000);
  assert.equal(sent.length,2);
});

test("invalid updates do not replace a pending valid media update",async()=>{
  const sent=[];
  const send=bridge(message=>{sent.push(message);return Promise.resolve();});
  await send({title:"Track",playback_state:"playing"});
  await send.advance(50);
  const latest={title:"Track",playback_state:"paused"};
  await send(latest);
  await send({title:"x".repeat(64000)});
  await send(undefined);
  await send.advance(200);
  assert.equal(sent.length,2);
  assert.equal(sent[1].media,latest);
});

test("queued updates handle synchronous extension context invalidation",async()=>{
  let attempts=0;
  const send=bridge(()=>{attempts++;throw new Error("Extension context invalidated.");});
  await send({title:"Track",playback_state:"playing"});
  await send({title:"Track",playback_state:"paused"});
  await assert.doesNotReject(()=>send.advance(250));
  assert.equal(attempts,2);
});
