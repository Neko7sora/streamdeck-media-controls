import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {load} from './load.mjs';
const source=readFileSync(new URL('../native/macos/media.js',import.meta.url),'utf8');
function harness({running=true,denied=false,track='track-1',pid=42}={}) {
  const calls=[];
  const app={running:()=>running,playerState:()=>{if(denied) throw Error('Automation denied');return 'playing';},currentTrack:()=>({id:()=>track,name:()=>null,artist:()=>null,album:()=>null,duration:()=>120}),playerPosition:()=>10};
  for(const name of ['playpause','play','pause','stop','nextTrack','previousTrack']) app[name]=()=>calls.push(name);
  const system={getVolumeSettings:()=>({outputVolume:50,outputMuted:false}),setVolume:(_,...args)=>calls.push(args)};
  const Application=id=>app;Application.currentApplication=()=>system;
  const context=vm.createContext({Application,ObjC:{import(){}},$:{NSRunningApplication:{runningApplicationsWithBundleIdentifier:id=>({count:running&&id==='com.apple.Music'?1:0,objectAtIndex:()=>({processIdentifier:pid})})}}});
  vm.runInContext(source,context);
  return {calls,run:request=>context.run([JSON.stringify({expires_at:Date.now()+5000,...request})])};
}
test('macOS snapshots preserve unknown metadata and identify app process and track',async()=>{
  const h=harness(), snapshot=JSON.parse(h.run({command:'snapshot'}));
  assert.equal(snapshot.sessions.length,1);assert.equal(snapshot.current.title,null);
  assert.equal(snapshot.current.session_id,'macos:com.apple.Music:42:track-1');
  const {validateSnapshot}=await load('media/media-validation');
  assert.equal(validateSnapshot(snapshot,'macos').current.source,'macos');
});
test('macOS commands reject expired, changed-track and restarted-process targets',()=>{
  const h=harness();
  for(const session_id of ['macos:com.apple.Music:42:old','macos:com.apple.Music:99:track-1','windows:wrong']) assert.throws(()=>h.run({command:'next',session_id}));
  assert.throws(()=>h.run({command:'next',session_id:'macos:com.apple.Music:42:track-1',expires_at:0}));
  assert.deepEqual(h.calls,[]);
  h.run({command:'next',session_id:'macos:com.apple.Music:42:track-1'});assert.deepEqual(h.calls,['nextTrack']);
});
test('macOS does not launch closed apps or invent sessions on denied Automation',()=>{
  assert.equal(JSON.parse(harness({running:false}).run({command:'snapshot'})).sessions.length,0);
  const result=JSON.parse(harness({denied:true}).run({command:'snapshot'}));
  assert.equal(result.sessions.length,0);assert.match(result.errors[0],/Automation denied/);
});
test('macOS rejects per-app volume targets and out-of-range seeking',()=>{
  const h=harness();
  assert.throws(()=>h.run({command:'volume',target:'other',delta:0.02}));
  assert.throws(()=>h.run({command:'seek',session_id:'macos:com.apple.Music:42:track-1',position:121}));
  assert.deepEqual(h.calls,[]);
});
