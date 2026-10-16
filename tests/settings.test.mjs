import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source=readFileSync(new URL("../dev.local.media-controls.sdPlugin/ui/settings.js",import.meta.url),"utf8");
function inspector(settings={}) {
  const selects=new Set(["media","audio","dial-mode","seek-step"]);
  const elements=new Map();
  for(const id of ["media","audio","global","details","dial-mode","seek-step","dial-settings","seek-settings","status"]) {
    let value="";
    const element={children:[],listeners:{},checked:false,hidden:false,textContent:"",
      get value(){return value;},
      set value(next){value=selects.has(id)&&!this.children.some(option=>option.value===next)?"":next;},
      replaceChildren(){this.children=[];value="";},
      append(option){this.children.push(option);if(this.children.length===1) value=option.value;},
      addEventListener(event,fn){this.listeners[event]=fn;}
    };
    elements.set(id,element);
  }
  for(const [id,values] of [["dial-mode",["seek","volume"]],["seek-step",["1","5","10","30","60"]]]) {
    for(const value of values) elements.get(id).append({value});
  }
  const messages=[];
  let socket,poll;
  class WebSocket {
    static OPEN=1;
    readyState=1;
    constructor(){socket=this;}
    send(message){messages.push(JSON.parse(message));}
  }
  const window={};
  vm.runInNewContext(source,{window,WebSocket,JSON,setInterval(fn){poll=fn;},document:{
    getElementById:id=>elements.get(id),createElement:()=>({})
  }});
  window.connectElgatoStreamDeckSocket(1234,"context","registerPropertyInspector","{}",JSON.stringify({
    action:"dev.local.media-controls.now-playing-dial",payload:{settings}
  }));
  socket.onopen();
  return {elements,messages,poll:()=>{poll();return messages.at(-1).payload;},
    receive:(event,payload)=>socket.onmessage({data:JSON.stringify({event,payload})}),
    change(id,value){const element=elements.get(id);if(id==="global") element.checked=value;else element.value=value;element.listeners.change();}};
}

test("inspector loads saved targets immediately and edits only the changed setting",()=>{
  const saved={mediaTarget:"windows:missing",audioTarget:"audio:missing",globalKeys:true,dialMode:"volume",seekStep:12,extra:"preserved"};
  const pi=inspector(saved);
  assert.equal(pi.elements.get("media").value,saved.mediaTarget);
  assert.equal(pi.elements.get("audio").value,saved.audioTarget);
  assert.equal(pi.elements.get("global").checked,true);
  assert.equal(pi.elements.get("dial-mode").value,"volume");
  pi.change("global",false);
  assert.deepEqual(pi.messages.at(-1).payload,{...saved,globalKeys:false});
  pi.change("seek-step","10");
  assert.deepEqual(pi.messages.at(-1).payload,{...saved,globalKeys:false,seekStep:10});
});

test("settings updates retain newly selected or disconnected targets until options catch up",()=>{
  const pi=inspector();
  pi.receive("sendToPropertyInspector",{sessions:[{id:"A",label:"Track A"}],audio:[]});
  pi.receive("didReceiveSettings",{settings:{mediaTarget:"B",audioTarget:"app",dialMode:"seek",seekStep:5}});
  assert.equal(pi.elements.get("media").value,"B");
  assert.equal(pi.elements.get("audio").value,"app");
  assert.match(pi.elements.get("media").children.find(option=>option.value==="B").textContent,/切断済み/);
  pi.change("seek-step","30");
  assert.equal(pi.messages.at(-1).payload.mediaTarget,"B");
  assert.equal(pi.messages.at(-1).payload.audioTarget,"app");
  pi.receive("sendToPropertyInspector",{sessions:[{id:"B",label:"Track B",details:"Current media"}],audio:[{id:"app",label:"Player"}]});
  assert.equal(pi.elements.get("media").value,"B");
  assert.equal(pi.elements.get("media").children.find(option=>option.value==="B").textContent,"Track B");
  assert.equal(pi.elements.get("details").textContent,"Current media");
});

test("delayed options update lists without undoing a local setting change",()=>{
  const saved={mediaTarget:"A",audioTarget:"app",globalKeys:true,extra:"preserved"};
  const pi=inspector(saved);
  const initial=pi.messages.at(-1).payload;
  assert.deepEqual(initial,{request:"options",settingsRevision:0});
  pi.change("global",false);
  pi.receive("sendToPropertyInspector",{settingsRevision:initial.settingsRevision,settings:saved,
    sessions:[{id:"A",label:"Track A",details:"Fresh list"},{id:"B",label:"Track B"}],audio:[{id:"app",label:"Player"}]});
  assert.equal(pi.elements.get("global").checked,false);
  assert.equal(pi.elements.get("media").children.find(option=>option.value==="B").textContent,"Track B");
  assert.equal(pi.elements.get("details").textContent,"Fresh list");
  pi.change("seek-step","10");
  assert.deepEqual(pi.messages.at(-1).payload,{...saved,globalKeys:false,seekStep:10});
  assert.equal(pi.poll().settingsRevision,2);
});

test("current options reflect initial and plugin settings while old responses cannot undo received settings",()=>{
  const pi=inspector();
  const initial=pi.messages.at(-1).payload;
  pi.receive("sendToPropertyInspector",{settingsRevision:initial.settingsRevision,
    settings:{mediaTarget:"A",audioTarget:"app",extra:"initial"},sessions:[{id:"A",label:"Track A"}]});
  assert.equal(pi.elements.get("media").value,"A");
  const beforeUpdate=pi.poll();
  pi.receive("didReceiveSettings",{settings:{mediaTarget:"B",audioTarget:"app",extra:"new"}});
  pi.receive("sendToPropertyInspector",{settingsRevision:beforeUpdate.settingsRevision,
    settings:{mediaTarget:"A",extra:"stale"},sessions:[{id:"B",label:"Track B",details:"Updated options"}]});
  assert.equal(pi.elements.get("media").value,"B");
  assert.equal(pi.elements.get("details").textContent,"Updated options");
  const current=pi.poll();
  assert.ok(current.settingsRevision>beforeUpdate.settingsRevision);
  // A long press can update plugin settings without a preceding PI settings event.
  pi.receive("sendToPropertyInspector",{settingsRevision:current.settingsRevision,
    settings:{mediaTarget:"C",audioTarget:"app",extra:"long press"},sessions:[{id:"C",label:"Track C"}]});
  assert.equal(pi.elements.get("media").value,"C");
  pi.receive("sendToPropertyInspector",{settingsRevision:current.settingsRevision,
    settings:{mediaTarget:"B",extra:"earlier poll"},sessions:[{id:"C",label:"Track C"}]});
  assert.equal(pi.elements.get("media").value,"C","a second response from the older revision cannot undo the plugin update");
  pi.change("global",true);
  assert.deepEqual(pi.messages.at(-1).payload,{mediaTarget:"C",audioTarget:"app",extra:"long press",globalKeys:true});
});
