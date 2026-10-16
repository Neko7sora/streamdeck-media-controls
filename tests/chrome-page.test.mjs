import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync(new URL("../chrome-extension/page-main.js",import.meta.url),"utf8");
function page(players=[]) {
  const messages=[],events=new Map(),session={metadata:null,playbackState:"none",setPositionState(){}};
  const window={postMessage(v){messages.push(v);},addEventListener(name,fn){events.set(name,fn);}};
  let tick,now=10000;
  const context={window,navigator:{mediaSession:session},document:{title:"Private page title",querySelectorAll(){return players;},addEventListener(){}},location:{origin:"https://example.test"},setInterval(fn){tick=fn;},Date:{now:()=>now},Number,Array};
  vm.runInNewContext(source,context);
  return {session,messages,events,window,tick:()=>tick(),advance:ms=>{now+=ms;}};
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

test('observed Media Session position advances at its rate and holds across pause/resume',()=>{
 const p=page();p.session.metadata={title:'Track',artwork:[]};p.session.playbackState='playing';
 p.session.setPositionState({position:10,duration:100,playbackRate:2});
 p.advance(2000);p.tick();assert.equal(p.messages.at(-1).media.timeline.position_sec,14);
 assert.equal(p.messages.at(-1).media.timeline.updated_at,12000);
 p.session.playbackState='paused';p.tick();
 p.advance(5000);p.tick();assert.equal(p.messages.at(-1).media.timeline.position_sec,14);
 p.session.playbackState='playing';p.tick();
 p.advance(1000);p.tick();assert.equal(p.messages.at(-1).media.timeline.position_sec,16);
 p.session.setPositionState({duration:100});
 assert.equal(p.messages.at(-1).media.timeline.position_sec,0);
 assert.equal(p.messages.at(-1).media.playback_rate,1);
 p.session.setPositionState({});p.tick();assert.equal(p.messages.at(-1).media.timeline.position_sec,undefined);
});

test('HTML media position, duration, timestamp and seek range are sampled together',()=>{
 const ranges={length:1,start:()=>5,end:()=>90};
 const player={currentSrc:'a',tagName:'VIDEO',readyState:4,paused:false,ended:false,seeking:false,
  currentTime:15,duration:100,playbackRate:1.5,seekable:ranges,buffered:ranges};
 const p=page([player]);
 assert.equal(p.messages.at(-1).media.timeline.position_sec,15);
 assert.equal(p.messages.at(-1).media.timeline.end_sec,100);
 assert.equal(p.messages.at(-1).media.timeline.min_seek_sec,5);
 assert.equal(p.messages.at(-1).media.timeline.max_seek_sec,90);
 p.advance(1000);player.currentTime=16.5;p.tick();
 assert.equal(p.messages.at(-1).media.timeline.position_sec,16.5);
 assert.equal(p.messages.at(-1).media.timeline.updated_at,11000);
});
