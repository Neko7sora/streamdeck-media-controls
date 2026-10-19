import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {randomUUID} from "node:crypto";

const source=readFileSync(new URL("../dev.local.media-controls.sdPlugin/ui/settings.js",import.meta.url),"utf8");
function inspector(settings={},{connect=true}={}) {
  const selects=new Set(["media","audio","dial-mode","seek-step"]);
  const elements=new Map();
  for(const id of ["media","audio","global","details","dial-mode","seek-step","dial-settings","seek-settings","status","register-chrome","chrome-registration-status","chrome-connection","chrome-connection-title","chrome-connection-detail"]) {
    let value="";
    const element={dataset:{},children:[],listeners:{},checked:false,hidden:false,textContent:"",disabled:id==="register-chrome",
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
  const timers=new Map();let timerId=0;
  let socket,poll,now=1000;
  class WebSocket {
    static OPEN=1;
    readyState=0;
    constructor(){socket=this;}
    send(message){messages.push(JSON.parse(message));}
  }
  const window={};
  vm.runInNewContext(source,{window,WebSocket,JSON,Date:{now:()=>now},crypto:{randomUUID},setInterval(fn){poll=fn;},setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);},document:{
    getElementById:id=>elements.get(id),createElement:()=>({})
  }});
  window.connectElgatoStreamDeckSocket(1234,"context","registerPropertyInspector","{}",JSON.stringify({
    action:"dev.local.media-controls.now-playing-dial",payload:{settings}
  }));
  const open=()=>{socket.readyState=1;socket.onopen();};
  if(connect) open();
  return {elements,messages,open,poll:()=>{poll();return messages.at(-1).payload;},
    advance(ms){now+=ms;poll();},
    click:id=>elements.get(id).listeners.click(),
    timeout(){for(const [id,fn] of timers){timers.delete(id);fn();}},
    close(){socket.readyState=3;socket.onclose();},
    receive:(event,payload)=>socket.onmessage({data:JSON.stringify({event,payload})}),
    change(id,value){const element=elements.get(id);if(id==="global") element.checked=value;else element.value=value;element.listeners.change();}};
}

test("settings are editable only while connected so unsaved changes are never shown as applied",()=>{
  const pi=inspector({globalKeys:true},{connect:false});
  const assertDisabled=disabled=>{
    for(const id of ["media","audio","global","dial-mode","seek-step"]) assert.equal(pi.elements.get(id).disabled,disabled,id);
  };
  assertDisabled(true);
  pi.change("global",false);
  assert.equal(pi.elements.get("global").checked,true);
  assert.equal(pi.messages.length,0);
  pi.open();
  assertDisabled(false);
  pi.change("global",false);
  assert.deepEqual(pi.messages.at(-1).payload,{globalKeys:false});
  pi.close();
  assertDisabled(true);
  const count=pi.messages.length;
  pi.change("global",true);
  assert.equal(pi.elements.get("global").checked,false);
  assert.equal(pi.messages.length,count);
  assert.match(pi.elements.get("status").textContent,/接続が切れました/);
});

test('Chrome connection is independent of registration and distinguishes idle, receiving and disconnected',()=>{
  const pi=inspector();
  const receive=chromeConnection=>pi.receive('sendToPropertyInspector',{chromeConnection});
  receive({state:'disconnected',sessions:0});
  assert.match(pi.elements.get('chrome-connection-title').textContent,/未接続/);
  pi.click('register-chrome');const request=pi.messages.at(-1).payload;
  pi.receive('sendToPropertyInspector',{response:'chromeHostRegistration',requestId:request.requestId,status:'registered',message:'登録しました。'});
  assert.match(pi.elements.get('chrome-connection-title').textContent,/未接続/);
  receive({state:'connected',sessions:0});
  assert.equal(pi.elements.get('chrome-connection').dataset.state,'connected');
  assert.match(pi.elements.get('chrome-connection-detail').textContent,/連携は正常/);
  receive({state:'connected',sessions:2});
  assert.match(pi.elements.get('chrome-connection-detail').textContent,/2 セッション/);
  pi.close();
  assert.equal(pi.elements.get('chrome-connection').dataset.state,'unavailable');
});

test('a silent plugin clears a connected indicator even when the inspector socket stays open',()=>{
  const pi=inspector();
  pi.receive('sendToPropertyInspector',{chromeConnection:{state:'connected',sessions:1}});
  pi.advance(6001);
  assert.equal(pi.elements.get('chrome-connection').dataset.state,'unavailable');
  pi.receive('sendToPropertyInspector',{chromeConnection:{state:'connected',sessions:0}});
  assert.equal(pi.elements.get('chrome-connection').dataset.state,'connected');
  const silent=inspector();silent.advance(6001);
  assert.equal(silent.elements.get('chrome-connection').dataset.state,'unavailable');
});

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

test("Chrome registration runs on click, blocks duplicate clicks, and keeps selected sessions intact",()=>{
  const pi=inspector({mediaTarget:"A",audioTarget:"app"});
  pi.receive("sendToPropertyInspector",{sessions:[{id:"A",label:"Track A",details:"Track details"}],audio:[{id:"app",label:"Player"}]});
  pi.poll();assert.ok(pi.messages.every(message=>message.payload?.request!=="registerChromeHost"));
  pi.click("register-chrome");
  const request=pi.messages.at(-1).payload;
  assert.equal(request.request,"registerChromeHost");assert.equal(pi.elements.get("register-chrome").disabled,true);
  const count=pi.messages.length;pi.click("register-chrome");assert.equal(pi.messages.length,count);
  pi.receive("sendToPropertyInspector",{response:"chromeHostRegistration",requestId:request.requestId,status:"not-found",message:"拡張機能が見つかりません。"});
  assert.equal(pi.elements.get("register-chrome").disabled,false);
  assert.match(pi.elements.get("chrome-registration-status").textContent,/見つかりません/);
  assert.equal(pi.elements.get("details").textContent,"Track details");
  assert.equal(pi.elements.get("media").value,"A");assert.equal(pi.elements.get("audio").value,"app");
  pi.poll();assert.equal(pi.messages.at(-1).payload.request,"options","regular options refresh must not register a host");
  pi.click("register-chrome");const next=pi.messages.at(-1).payload;
  assert.notEqual(next.requestId,request.requestId);
  pi.receive("sendToPropertyInspector",{response:"chromeHostRegistration",requestId:request.requestId,message:"Old reply"});
  assert.equal(pi.elements.get("register-chrome").disabled,true,"stale replies cannot finish a newer attempt");
  pi.receive("sendToPropertyInspector",{response:"chromeHostRegistration",requestId:next.requestId,status:"registered",message:"登録しました。"});
  assert.equal(pi.elements.get("chrome-registration-status").textContent,"登録しました。");
  assert.equal(pi.elements.get("register-chrome").disabled,false);
});

test("registration timeout and disconnect report a result without retrying",()=>{
  const pi=inspector();pi.click("register-chrome");
  const count=pi.messages.length;pi.timeout();assert.equal(pi.messages.length,count);
  assert.equal(pi.elements.get("register-chrome").disabled,false);
  assert.match(pi.elements.get("chrome-registration-status").textContent,/応答/);
  pi.click("register-chrome");pi.close();
  assert.equal(pi.elements.get("register-chrome").disabled,true);
  assert.match(pi.elements.get("chrome-registration-status").textContent,/開き直して/);
  const closedCount=pi.messages.length;pi.click("register-chrome");pi.timeout();assert.equal(pi.messages.length,closedCount);
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
