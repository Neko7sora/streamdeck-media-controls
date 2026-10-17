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

test('auto selection stays on the same playing session across alternating updates and OS current changes',()=>{
 let a={source:'windows',session_id:'a',title:'A',playback_state:'playing',timeline:{updated_at:10}};
 let b={...a,session_id:'b',title:'B',timeline:{updated_at:20}};
 let selected=model.chooseCurrent({current:a,sessions:[a,b]},[]);
 for(let tick=0;tick<8;tick++) {
  a={...a,title:`A ${tick}`,timeline:{updated_at:100+tick*2}};
  b={...b,timeline:{updated_at:101+tick*2}};
  selected=model.chooseCurrent({current:tick%2?null:b,sessions:[b,a]},[],'auto',selected.session_id);
  assert.equal(selected.session_id,'a');
  assert.equal(selected.title,`A ${tick}`,'retained selection must use the latest snapshot');
 }
 const paused={...a,playback_state:'paused'};
 assert.equal(model.chooseCurrent({current:paused,sessions:[paused,b]},[],'auto','a').session_id,'b');
 assert.equal(model.chooseCurrent({current:b,sessions:[b]},[],'auto','a').session_id,'b');
 assert.equal(model.chooseCurrent({current:null,sessions:[]},[],'auto','a'),null);
});

test('auto selection retains paused targets and switches to playing media without timestamp churn',()=>{
 const a={source:'chrome',session_id:'a',title:'A',playback_state:'paused',observed_at:10};
 const b={...a,session_id:'b',title:'B',observed_at:20};
 const snapshot={current:null,sessions:[]};
 assert.equal(model.chooseCurrent(snapshot,[a,b],'auto','a'),a);
 assert.equal(model.chooseCurrent(snapshot,[a,{...b,playback_state:'playing'}],'auto','a').session_id,'b');
 assert.equal(model.chooseCurrent(snapshot,[{...a,playback_state:'playing'},b],'b','a'),b,'explicit selection overrides auto');
 assert.equal(model.chooseCurrent(snapshot,[b],'a','b'),null,'missing explicit target never falls back');
 const win={source:'windows',session_id:'w',title:'Windows',playback_state:'playing'};
 assert.equal(model.chooseCurrent({current:win,sessions:[win]},[{...a,playback_state:'playing'}],'auto','a').session_id,'a');
 const paused={...win,playback_state:'paused'};
 assert.equal(model.chooseCurrent({current:paused,sessions:[paused]},[{...a,playback_state:'playing'}]).session_id,'a');
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

test('icons follow the selected app and only uniquely matching Chrome media supplies a favicon',()=>{
 const win={source:'windows',session_id:'w',app_id:'chrome.exe',title:'Song',artist:'Artist',app_icon_data_url:'app'};
 const chrome={source:'chrome',session_id:'c',title:'Song',artist:'Artist',favicon_data_url:'site'};
 const snapshot={current:win,sessions:[win]};
 const merged=model.chooseCurrent(snapshot,[chrome]);
 assert.equal(merged.app_icon_data_url,'app');assert.equal(merged.favicon_data_url,'site');
 const selected=model.chooseCurrent(snapshot,[chrome],'c');
 assert.equal(selected.app_icon_data_url,'app');assert.equal(selected.source,'chrome');assert.equal(selected.session_id,'c');
 assert.equal(model.chooseCurrent(snapshot,[chrome,{...chrome,session_id:'other'}]).favicon_data_url,undefined);
 assert.equal(model.chooseCurrent({...snapshot,current:{...win,app_id:'Spotify'}},[chrome]).favicon_data_url,undefined);
 assert.equal(model.chooseCurrent(snapshot,[{...chrome,title:'Different'}]).favicon_data_url,undefined);
});
test('never merges into non-Chrome media player',()=>{
 const windows={source:'windows',app_id:'Spotify',title:'Song'};
 const chrome={source:'chrome',title:'Song',album:'From browser'};
 assert.equal(model.mergedCurrent(windows,chrome),windows);
});

test('artistless TVer videos receive only icons through a unique top-level page title match',()=>{
 const win={source:'windows',session_id:'w',app_id:'Chrome',title:'Episode | TVer',artist:'',album:'',app_icon_data_url:'app',artwork_data_url:'windows-art',timeline:{position_sec:10}};
 const chrome={source:'chrome',session_id:'c',frame_id:0,title:null,page_title:win.title,page_url:'https://tver.jp/episodes/example',browser_media:{element_type:'video'},favicon_data_url:'site',artwork_data_url:'chrome-art',timeline:{position_sec:20}};
 const snapshot={current:win,sessions:[win]};
 for(const selected of ['auto','w']) {
  const actual=model.chooseCurrent(snapshot,[chrome],selected);
  assert.equal(actual.favicon_data_url,'site');
  for(const key of ['title','artist','album','artwork_data_url','timeline','session_id']) assert.equal(actual[key],win[key],key);
  for(const key of ['page_url','tab_id','frame_id','document_id','browser_media']) assert.equal(actual[key],undefined,key);
  assert.equal(actual.field_sources.favicon_data_url,'chrome');
 }
 assert.equal(model.sameTrack(win,chrome),false);
 assert.equal(model.chooseCurrent(snapshot,[chrome],'c').app_icon_data_url,'app');
 assert.equal(model.chooseCurrent(snapshot,[{...chrome,title:win.title}]).favicon_data_url,'site');
});

test('icon-only matching rejects ambiguous, conflicting and unrelated video sessions',()=>{
 const win={source:'windows',session_id:'w',app_id:'Chrome',title:'Episode | TVer'};
 const chrome={source:'chrome',session_id:'c',frame_id:0,title:null,page_title:win.title,browser_media:{element_type:'video'},favicon_data_url:'site'};
 const snapshot={current:win,sessions:[win]};
 for(const change of [{frame_id:1},{page_title:'Another episode'},{title:'Different track'},{browser_media:undefined},{artist:'Artist'},{album:'Album'}]) {
  assert.equal(model.chooseCurrent(snapshot,[{...chrome,...change}]),win,JSON.stringify(change));
 }
 assert.equal(model.chooseCurrent(snapshot,[chrome,{...chrome,session_id:'c2'}]),win);
 assert.equal(model.chooseCurrent({...snapshot,sessions:[win,{...win,session_id:'w2'}]},[chrome]),win);
 assert.equal(model.chooseCurrent(snapshot,[chrome,{...chrome,session_id:'c2'}],'c').app_icon_data_url,undefined);
 for(const change of [{app_id:'Spotify'},{artist:'Artist'},{album:'Album'}]) {
  const other={...win,...change};
  assert.equal(model.chooseCurrent({current:other,sessions:[other]},[chrome]),other);
 }
});
test('image validation only permits bounded safe formats',()=>{
 assert.equal(model.safeImage('data:image/png;base64,AAAA'),'data:image/png;base64,AAAA');
 assert.equal(model.safeImage('data:image/svg+xml;base64,AAAA'),undefined);
 assert.equal(model.safeImage('https://example.org/image.png'),undefined);
 assert.equal(model.safeImage('data:image/png;base64,AAAA?'),undefined);
});

test('live Windows position uses provider time and rate, never the poll time',()=>{
 const media={source:'windows',title:'Track',playback_state:'playing',playback_rate:2,observed_at:12000,
  timeline:{updated_at:10000,start_sec:60,position_sec:70,end_sec:120}};
 assert.deepEqual(model.progress(media,13000),{position:16,duration:60,percent:16/60*100});
 assert.equal(model.playbackPosition({...media,observed_at:14000},14000),78);
 assert.equal(model.playbackPosition({...media,browser_media:{ready_state:2,seeking:true}},14000),78);
 assert.equal(media.timeline.position_sec,70);
 assert.equal(model.playbackPosition({...media,playback_state:'paused'},14000),70);
 assert.equal(model.playbackPosition({...media,playback_state:'stopped'},14000),70);
 assert.equal(model.playbackPosition({...media,timeline:{...media.timeline,updated_at:null}},14000),70);
});

test('position handles unknown values, future clocks, bounds and reverse playback',()=>{
 const media={source:'windows',title:'Track',playback_state:'playing',timeline:{updated_at:10000,position_sec:5,end_sec:10}};
 assert.equal(model.playbackPosition(media,9000),5);
 assert.equal(model.playbackPosition(media,30000),10);
 assert.equal(model.playbackPosition({...media,playback_rate:-2},14000),0);
 assert.equal(model.playbackPosition({...media,playback_rate:0},14000),5);
 assert.equal(model.playbackPosition({...media,timeline:{...media.timeline,position_sec:null}},14000),null);
 assert.equal(model.progress({...media,timeline:{position_sec:5}},14000).duration,null);
});

test('Chrome position projects sample time and stops during buffering, seeking or end',()=>{
 const media={source:'chrome',title:'Track',playback_state:'playing',observed_at:13000,
  timeline:{updated_at:10000,position_sec:5,end_sec:100},browser_media:{ready_state:4}};
 assert.equal(model.playbackPosition(media,14000),9);
 for(const state of [{ready_state:2},{seeking:true},{ended:true}]) {
  assert.equal(model.playbackPosition({...media,browser_media:state},14000),5);
 }
});
