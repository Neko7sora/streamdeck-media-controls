import {test} from "node:test";
import assert from "node:assert/strict";
import {load} from "./load.mjs";
const state=await load("media-state"), model=await load("media-model"), validation=await load("media-validation");
test("frame isolation, out-of-order rejection, explicit clear and expiry",()=>{
  assert.equal(state.ingestChrome(1,0,{title:"Music",artist:"A",playback_state:"playing"},20),true);
  state.ingestChrome(1,1,{title:""},21);
  assert.equal(state.currentMedia().title,"Music");
  state.ingestChrome(1,0,{title:"Old"},19);
  assert.equal(state.currentMedia().title,"Music");
  assert.equal(state.availableSessions().length,1);
  state.ingestChrome(1,2,{title:"Other",playback_state:"paused"},30);
  assert.equal(state.currentMedia("chrome:1:2").title,"Other");
  assert.equal(state.currentMedia("chrome:99:0"),null);
  state.ingestChrome(1,0,null,31);
  assert.equal(state.currentMedia().title,"Other");
  state.chromeSessions(Date.now()+state.CHROME_TTL+1);
  assert.equal(state.currentMedia(),null);
  state.ingestChrome(2,0,{title:"Before navigation"},40,"doc1");
  state.ingestChrome(2,0,{title:"After navigation"},41,"doc2");
  assert.equal(state.currentMedia("chrome:2:0:doc1"),null);
  assert.equal(state.currentMedia("chrome:2:0:doc2").title,"After navigation");
  state.chromeSessions(Date.now()+state.CHROME_TTL+1);
});
test("matching is conservative when artist missing, albums differ or tabs ambiguous",()=>{
  const w={source:"windows",app_id:"chrome.exe",title:"Song",artist:"Artist",session_id:"w"};
  const c={source:"chrome",title:"Song",artist:"Artist",session_id:"c",album:"Album"};
  assert.equal(model.sameTrack(w,{...c,artist:""}),false);
  assert.equal(model.sameTrack({...w,album:"Another"},c),false);
  assert.equal(model.chooseCurrent({current:w,sessions:[w]},[c,{...c,session_id:"c2"}]),w);
  assert.equal(model.chooseCurrent({current:w,sessions:[w]},[c]).album,"Album");
  assert.equal(model.chooseCurrent({current:w,sessions:[w]},[c],"disconnected"),null);
});
test("timeline distinguishes unavailable from zero and uses start offsets",()=>{
  assert.deepEqual(model.progress(null),{position:null,duration:null,percent:null});
  assert.deepEqual(model.progress({timeline:{start_sec:60,position_sec:90,end_sec:120}}),{position:30,duration:60,percent:50});
  assert.equal(model.progress({timeline:{position_sec:0,end_sec:0}}).percent,null);
});
test("untrusted media fields are individually sanitized",()=>{
  assert.equal(validation.validateMedia([],"chrome"),null);
  const m=validation.validateMedia({title:"a".repeat(1000),timeline:{position_sec:Infinity,end_sec:"5"},controls:{toggle:true,seek:"true"},browser_media:{volume:100,muted:"false",seekable_ranges:[[0,2],[2,1],[0,Infinity]]},artwork_candidates:[{src:"https://example.com",sizes:{bad:true}}]},"chrome");
  assert.equal(m.title.length,500);assert.equal(m.timeline.position_sec,null);assert.equal(m.timeline.end_sec,null);
  assert.deepEqual(m.controls,{toggle:true});assert.equal(m.browser_media.volume,undefined);assert.equal(m.browser_media.muted,undefined);
  assert.deepEqual(m.browser_media.seekable_ranges,[[0,2]]);assert.equal(m.artwork_candidates[0].sizes,"");
  assert.throws(()=>validation.validateSnapshot({sessions:"wrong"}));
  assert.throws(()=>validation.validateSnapshot({current:null,sessions:Array(129).fill({})}));
});
