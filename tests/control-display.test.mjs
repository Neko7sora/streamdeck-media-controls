import {test} from "node:test";
import assert from "node:assert/strict";
import {load} from "./load.mjs";

const {mediaTargetName,audioTargetName}=await load("control-display");

test("target names identify browser sites, Windows apps and the whole PC",()=>{
  assert.equal(mediaTargetName({source:"chrome",page_url:"https://www.youtube.com/watch?v=1"}),"youtube.com · Chrome");
  assert.equal(mediaTargetName({source:"chrome",page_url:"broken"}),"Chrome");
  assert.equal(mediaTargetName({source:"windows",app_id:"C:\\Apps\\Spotify.exe"}),"Spotify");
  assert.equal(mediaTargetName({source:"windows",app_id:"SpotifyAB.SpotifyMusic_hash!App"}),"SpotifyAB.SpotifyMusic");
  assert.equal(mediaTargetName({source:"windows",app_id:"chrome.exe",page_url:"https://tver.jp/episodes/1"}),"tver.jp · chrome");
  assert.equal(mediaTargetName(null),"対象なし");
  assert.equal(audioTargetName({name:"Speakers"}),"PC全体");
  assert.equal(audioTargetName({name:"Spotify"},"app"),"Spotify");
  assert.equal(audioTargetName(null,"missing"),"対象なし");
});
