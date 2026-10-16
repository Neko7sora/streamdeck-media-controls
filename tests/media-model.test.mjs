import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const ts=require('typescript');
const source = readFileSync(new URL('../src/media-model.ts',import.meta.url),'utf8');
const js = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const model=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('auto selects Windows sessions when the OS has no current session',()=>{
 const old={source:'windows',session_id:'old',title:'Old',playback_state:'paused',timeline:{updated_at:10},observed_at:999};
 const recent={...old,session_id:'recent',title:'Recent',timeline:{updated_at:20},observed_at:1};
 const snapshot={current:null,sessions:[old,recent]};
 assert.equal(model.chooseCurrent(snapshot,[]),recent);
 const playing={...old,playback_state:'playing'};
 assert.equal(model.chooseCurrent({...snapshot,sessions:[playing,recent]},[]),playing);
 assert.equal(model.chooseCurrent({...snapshot,current:old},[]),old);
 assert.equal(model.chooseCurrent(snapshot,[],'removed'),null);
 assert.equal(model.chooseCurrent(snapshot,[],'old'),old);
 assert.equal(model.chooseCurrent({current:null,sessions:[]},[]),null);
});

test('fallback Windows selection retains Chrome metadata enrichment',()=>{
 const win={source:'windows',session_id:'w',app_id:'Chrome',title:'Song',artist:'Artist',playback_state:'playing'};
 const chrome={source:'chrome',session_id:'c',title:'Song',artist:'Artist',album:'Album'};
 const selected=model.chooseCurrent({current:null,sessions:[win]},[chrome]);
 assert.equal(selected.session_id,'w');
 assert.equal(selected.album,'Album');
});

test('matches exact music with normalized names',()=>{
 assert.equal(model.sameTrack({source:'windows',title:' Song ',artist:'Artist'},{source:'chrome',title:'song',artist:'artist'}),true);
 assert.equal(model.sameTrack({source:'windows',title:'Song A'},{source:'chrome',title:'Song B'}),false);
});
test('does not mix different Windows and Chrome tracks',()=>{
 const windows={source:'windows',app_id:'Chrome',title:'Song A',artist:'Someone',artwork_data_url:'windows'};
 const chrome={source:'chrome',title:'Song B',artwork_data_url:'chrome'};
 assert.equal(model.mergedCurrent(windows,chrome),windows);
});
test('Chrome metadata enriches same playing Chrome track only',()=>{
 const windows={source:'windows',app_id:'chrome.exe',title:'Song',artist:'Artist',artwork_data_url:'old'};
 const chrome={source:'chrome',title:'song',artist:'Artist',album:'Album',artwork_data_url:'new'};
 const actual=model.mergedCurrent(windows,chrome);
 assert.equal(actual.album,'Album');
 assert.equal(actual.artwork_data_url,'new');
 assert.equal(actual.source,'windows');
});
test('never merges into non-Chrome media player',()=>{
 const windows={source:'windows',app_id:'Spotify',title:'Song'};
 const chrome={source:'chrome',title:'Song',album:'From browser'};
 assert.equal(model.mergedCurrent(windows,chrome),windows);
});
test('image validation only permits bounded safe formats',()=>{
 assert.equal(model.safeImage('data:image/png;base64,AAAA'),'data:image/png;base64,AAAA');
 assert.equal(model.safeImage('data:image/svg+xml;base64,AAAA'),undefined);
 assert.equal(model.safeImage('https://example.org/image.png'),undefined);
 assert.equal(model.safeImage('data:image/png;base64,AAAA?'),undefined);
});
