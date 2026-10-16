import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

const source=await readFile(new URL("../chrome-extension/bridge-isolated.js",import.meta.url),"utf8");
function bridge(sendMessage) {
  let listener;
  const window={addEventListener(type,fn){if(type==="message") listener=fn;}};
  const origin="https://media.test";
  const chrome={runtime:{sendMessage,onMessage:{addListener(){}}}};
  vm.runInNewContext(source,{window,location:{origin},chrome,setTimeout,clearTimeout});
  return media=>listener({source:window,origin,data:{kind:"__streamdeck_media_metadata_v1__",media}});
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
