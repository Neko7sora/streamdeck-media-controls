import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspector,displayFields} from './settings-harness.mjs';
test("settings are editable only while connected so unsaved changes are never shown as applied",()=>{
  const pi=inspector({globalKeys:true},{connect:false});
  const assertDisabled=disabled=>{
    for(const id of ["media","audio","global","dial-mode","seek-step","scroll-text",...Object.keys(displayFields)]) assert.equal(pi.elements.get(id).disabled,disabled,id);
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

test('scrolling defaults on for every action and saved toggles survive stale replies and reconnects',()=>{
  for(const action of ['now-playing','now-playing-dial','play-pause','previous','next','stop','mute','volume-up','volume-down','volume-dial']) {
    const options={action:`dev.local.media-controls.${action}`},saved={mediaTarget:'A',showTitle:false,extra:'preserved'};
    const pi=inspector(saved,options),initial=pi.messages.at(-1).payload;
    assert.equal(pi.elements.get('scroll-text').checked,true);
    assert.equal(pi.elements.get('scroll-help').hidden,false);
    pi.change('scroll-text',false);
    const expected={...saved,scrollText:false};
    assert.deepEqual(pi.messages.at(-1).payload,expected);
    pi.receive('sendToPropertyInspector',{settingsRevision:initial.settingsRevision,settings:saved});
    assert.equal(pi.elements.get('scroll-text').checked,false);
    const reopened=inspector(expected,options);
    assert.equal(reopened.elements.get('scroll-text').checked,false);
    reopened.change('scroll-text',true);
    assert.deepEqual(reopened.messages.at(-1).payload,{...expected,scrollText:true});
    pi.close();const count=pi.messages.length;
    pi.change('scroll-text',true);
    assert.equal(pi.elements.get('scroll-text').checked,false);
    assert.equal(pi.messages.length,count);
    pi.receive('didReceiveSettings',{settings:{...expected,scrollText:true}});
    assert.equal(pi.elements.get('scroll-text').checked,true);
  }
});

test('display settings default to visible and show only items supported by each action',()=>{
  for(const action of ["now-playing","now-playing-dial","play-pause","previous","next","stop","mute","volume-up","volume-down","volume-dial"]) {
    const pi=inspector({},{action:`dev.local.media-controls.${action}`});
    const nowPlaying=action.startsWith('now-playing'),volume=['mute','volume-up','volume-down','volume-dial'].includes(action),volumeDial=action==='volume-dial';
    assert.equal(pi.elements.get("display-settings").hidden,false);
    assert.equal(pi.elements.get("dial-display-settings").hidden,action!=='now-playing-dial');
    for(const [id,visible] of [
      ['control-icon-setting',!nowPlaying&&!volumeDial],['scope-setting',volumeDial],['target-setting',!nowPlaying],
      ['title-setting',nowPlaying||!volume],['artist-setting',nowPlaying],['artwork-setting',nowPlaying],
      ['app-icon-setting',nowPlaying||!volume],['volume-setting',volume],['status-setting',nowPlaying||volume],['volume-bar-setting',volumeDial]
    ]) assert.equal(pi.elements.get(id).hidden,!visible,`${action}: ${id}`);
    for(const id of Object.keys(displayFields)) assert.equal(pi.elements.get(id).checked,true);
  }
});

test('control display toggles save per action, survive stale replies and restore after reconnect',()=>{
  for(const action of ['play-pause','previous','next','stop','mute','volume-up','volume-down','volume-dial']) {
    const saved={mediaTarget:'A',audioTarget:'app',extra:'preserved'};
    const pi=inspector(saved,{action:`dev.local.media-controls.${action}`});
    const request=pi.messages.at(-1).payload;
    const expected={...saved};
    for(const [id,key] of Object.entries(displayFields)) {
      pi.change(id,false);expected[key]=false;
      assert.deepEqual(pi.messages.at(-1).payload,expected);
    }
    pi.receive('sendToPropertyInspector',{settingsRevision:request.settingsRevision,settings:saved});
    const reopened=inspector(expected,{action:`dev.local.media-controls.${action}`});
    for(const id of Object.keys(displayFields)) {
      assert.equal(pi.elements.get(id).checked,false);
      assert.equal(reopened.elements.get(id).checked,false);
    }
    pi.change('global',true);
    assert.equal(pi.elements.get('display-settings').hidden,false);
    if(action==='play-pause') {
      assert.equal(pi.elements.get('app-icon-setting').hidden,true);
      assert.equal(pi.elements.get('title-label').textContent,'操作対象の説明');
    }
  }
});

test('target controls match the operation and global mode without discarding saved targets',()=>{
  for(const name of ['play-pause','previous','next','stop','mute','volume-up','volume-down','volume-dial']) {
    const isVolume=['mute','volume-up','volume-down','volume-dial'].includes(name);
    const pi=inspector({mediaTarget:'A',audioTarget:'app'},{action:`dev.local.media-controls.${name}`});
    assert.equal(pi.elements.get('media-settings').hidden,isVolume,name);
    assert.equal(pi.elements.get('audio-settings').hidden,!isVolume,name);
    assert.equal(pi.elements.get('now-playing-help').hidden,true);
    pi.change('global',true);
    assert.equal(pi.elements.get('media-settings').hidden,true);
    assert.equal(pi.elements.get('audio-settings').hidden,true);
    assert.match(pi.elements.get('target-note').textContent,isVolume?/PC全体/:/Windows/);
    pi.change('global',false);
    assert.equal(pi.elements.get('media').value,'A');
    assert.equal(pi.elements.get('audio').value,'app');
  }
});

test('display toggles persist independently, survive stale options, and restore saved values on reconnect',()=>{
  const saved={mediaTarget:"A",audioTarget:"app",showArtist:false,showProgress:false,extra:"preserved"};
  const pi=inspector(saved);
  assert.equal(pi.elements.get("show-artist").checked,false);
  assert.equal(pi.elements.get("progress-display-note").hidden,false);
  const initial=pi.messages.at(-1).payload;
  const expected={...saved};
  for(const [id,key] of Object.entries(displayFields)) {
    pi.change(id,false);expected[key]=false;
    assert.deepEqual(pi.messages.at(-1).payload,expected);
  }
  pi.receive("sendToPropertyInspector",{settingsRevision:initial.settingsRevision,settings:saved});
  for(const id of Object.keys(displayFields)) assert.equal(pi.elements.get(id).checked,false,id);
  pi.change("show-progress",true);expected.showProgress=true;
  assert.equal(pi.elements.get("progress-display-note").hidden,true);
  assert.deepEqual(pi.messages.at(-1).payload,expected);
  const reopened=inspector(expected);
  for(const [id,key] of Object.entries(displayFields)) assert.equal(reopened.elements.get(id).checked,expected[key]);
  pi.close();const count=pi.messages.length;
  pi.change("show-title",true);
  assert.equal(pi.elements.get("show-title").checked,false);
  assert.equal(pi.messages.length,count);
  pi.receive("didReceiveSettings",{settings:{...expected,showTitle:true}});
  assert.equal(pi.elements.get("show-title").checked,true);
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

test("custom seek steps show the actual saved value and preserve options during polling",()=>{
  for(const step of [12,1.5,59.75]) {
    const saved={seekStep:step,mediaTarget:"A"};
    const pi=inspector(saved);
    const select=pi.elements.get("seek-step");
    const options=[...select.children];
    assert.equal(select.value,String(step));
    assert.equal(select.children.find(option=>option.value===String(step)).textContent,`${step}秒`);
    assert.deepEqual(select.children.map(option=>Number(option.value)),[1,5,10,30,60,step].sort((a,b)=>a-b));
    pi.change("scroll-text",false);
    assert.deepEqual(pi.messages.at(-1).payload,{...saved,scrollText:false});
    for(let i=0;i<3;i++) {
      const request=pi.poll();
      pi.receive("sendToPropertyInspector",{settingsRevision:request.settingsRevision,settings:{...saved,scrollText:false}});
      assert.equal(select.value,String(step));
      select.children.forEach((option,index)=>assert.equal(option,options[index],"unchanged options must retain their DOM nodes"));
    }
    const reopened=inspector({...saved,scrollText:false});
    assert.equal(reopened.elements.get("seek-step").value,String(step));
  }
});

test("switching custom seek steps to a preset saves the new value and removes the custom option",()=>{
  const pi=inspector({seekStep:12,mediaTarget:"A"});
  const select=pi.elements.get("seek-step");
  pi.change("seek-step","10");
  assert.equal(select.value,"10");
  assert.deepEqual(pi.messages.at(-1).payload,{seekStep:10,mediaTarget:"A"});
  assert.deepEqual(select.children.map(option=>option.value),["1","5","10","30","60"]);
  pi.receive("didReceiveSettings",{settings:{seekStep:2.5,mediaTarget:"A"}});
  assert.equal(select.value,"2.5");
  assert.equal(select.children.find(option=>option.value==="2.5").textContent,"2.5秒");
  assert.equal(select.children.some(option=>option.value==="12"),false);
});

test("seek step bounds and invalid values match the plugin fallback",()=>{
  for(const step of [1,60]) {
    const select=inspector({seekStep:step}).elements.get("seek-step");
    assert.equal(select.value,String(step));
    assert.equal(select.children.length,5);
  }
  for(const step of [undefined,null,"12",0,0.5,-1,60.5,61,NaN,Infinity,-Infinity]) {
    const pi=inspector({seekStep:step});
    const select=pi.elements.get("seek-step");
    assert.equal(select.value,"5",String(step));
    assert.deepEqual(select.children.map(option=>option.value),["1","5","10","30","60"]);
    pi.change("seek-step","30");
    assert.deepEqual(pi.messages.at(-1).payload,{seekStep:30});
  }
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

test('push inspector preserves partial collections, sends only lightweight liveness probes, and detects silence',()=>{
 const pi=inspector({mediaTarget:'A'});
 pi.receive('sendToPropertyInspector',{protocol:2,sessions:[{id:'A',label:'Track',details:'Details'}],audio:[{id:'app',label:'Player'}],chromeConnection:{state:'connected',sessions:1}});
 const start=pi.messages.length;
 for(let i=0;i<3;i++) pi.advance(1000);
 assert.deepEqual(pi.messages.slice(start).map(m=>m.payload.request),['alive']);
 pi.receive('sendToPropertyInspector',{protocol:2,response:'alive',chromeConnection:{state:'connected',sessions:1}});
 assert.equal(pi.elements.get('details').textContent,'Details');
 assert.equal(pi.elements.get('audio').children.some(o=>o.value==='app'),true);
 pi.receive('sendToPropertyInspector',{protocol:2,response:'optionsChanged',audio:[]});
 assert.equal(pi.elements.get('details').textContent,'Details');
 pi.advance(6001);assert.equal(pi.elements.get('chrome-connection').dataset.state,'unavailable');
});
