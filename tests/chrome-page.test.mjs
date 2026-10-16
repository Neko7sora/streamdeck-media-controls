import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync(new URL("../chrome-extension/page-main.js",import.meta.url),"utf8");
function page(players=[]) {
  const messages=[],events=new Map(),session={metadata:null,playbackState:"none",setPositionState(){}};
  const window={postMessage(v){messages.push(v);},addEventListener(name,fn){events.set(name,fn);}};
  let tick;
  const context={window,navigator:{mediaSession:session},document:{title:"Private page title",querySelectorAll(){return players;},addEventListener(){}},location:{origin:"https://example.test"},setInterval(fn){tick=fn;},Number,Array};
  vm.runInNewContext(source,context);
  return {session,messages,events,window,tick:()=>tick()};
}
test("empty pages do not invent track titles; setPositionState reset clears stale position",()=>{
  const p=page();assert.equal(p.messages.at(-1).media.title,"");
  p.session.metadata={title:"Track",artist:"Artist",artwork:[]};
  p.session.setPositionState({position:45,duration:100});
  p.tick();assert.equal(p.messages.at(-1).media.timeline.position_sec,45);
  p.events.get("message")({source:p.window,origin:"https://example.test",data:{kind:"__streamdeck_media_metadata_v1___command",command:{id:"1",title:"Track",command:"play-pause"}}});
  assert.equal(p.messages.at(-1).ok,false);
  p.session.setPositionState();
  p.tick();assert.equal(p.messages.at(-1).media.timeline.position_sec,undefined);
  p.session.setPositionState({position:70,duration:100});
  p.session.metadata={title:"New track",artist:"Artist",artwork:[]};
  p.tick();assert.equal(p.messages.at(-1).media.timeline.position_sec,undefined);
});
test("ambiguous media elements do not enable arbitrary controls",()=>{
  const element={currentSrc:"a",readyState:4,paused:false,ended:false};
  const p=page([element,{...element,currentSrc:"b"}]);
  assert.equal(p.messages.at(-1).media.title,"");
});
