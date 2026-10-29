import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from './load.mjs';
const {DialSeeking,seekPosition}=await load('media-seek');
const media={source:'windows',session_id:'A',title:'Track',playback_state:'paused',controls:{seek:true},
 timeline:{updated_at:10000,start_sec:10,position_sec:50,end_sec:110,min_seek_sec:10,max_seek_sec:110}};

test('rapid ticks accumulate and coalesce while one seek is pending',async()=>{
 const dial=new DialSeeking(),sent=[];
 let release;
 const send=async position=>{sent.push(position);if(sent.length===1) await new Promise(resolve=>{release=resolve;});};
 const first=dial.rotate('dial',media,5,send,10000);
 const second=dial.rotate('dial',media,15,send,10010);
 const third=dial.rotate('dial',media,-5,send,10020);
 assert.deepEqual(sent,[55]);
 release();await Promise.all([first,second,third]);
 assert.deepEqual(sent,[55,65]);
 // Repeated GSMTC polling is not a new position sample.
 await dial.rotate('dial',{...media,observed_at:10500},5,send,10500);
 assert.equal(sent.at(-1),70);
 // A true provider update replaces the cached target.
 await dial.rotate('dial',{...media,timeline:{...media.timeline,updated_at:11000,position_sec:80}},5,send,11000);
 assert.equal(sent.at(-1),85);
});

test('position samples observed while seeking do not discard later accumulated ticks',async()=>{
 const dial=new DialSeeking(),sent=[];let release;
 const send=async position=>{sent.push(position);if(sent.length===1) await new Promise(resolve=>{release=resolve;});};
 const first=dial.rotate('dial',media,5,send,10000);
 // The provider reports the first seek before the next queued seek finishes.
 const acknowledged={...media,timeline:{...media.timeline,updated_at:10001,position_sec:55}};
 const second=dial.rotate('dial',acknowledged,5,send,10001);
 release();await Promise.all([first,second]);
 await dial.rotate('dial',acknowledged,5,send,10002);
 assert.deepEqual(sent,[55,60,65],'an already-observed sample must not rewind the accumulated target');
 // An external position change after the queue drains still replaces the base.
 const moved={...media,timeline:{...media.timeline,updated_at:10003,position_sec:80}};
 await dial.rotate('dial',moved,5,send,10003);
 assert.equal(sent.at(-1),85);
});

test('seek bounds respect nonzero starts, browser gaps and unsupported sessions',()=>{
 assert.equal(seekPosition(media,-100),10);
 assert.equal(seekPosition(media,500),110);
 const browser={...media,source:'chrome',browser_media:{seekable_ranges:[[10,30],[60,110]]}};
 assert.equal(seekPosition(browser,40),30);
 assert.equal(seekPosition(browser,55),60);
 assert.throws(()=>seekPosition({...media,controls:{seek:false}},50),/unavailable/);
 assert.throws(()=>seekPosition({...media,timeline:{min_seek_sec:10,max_seek_sec:10}},50),/unavailable/);
 assert.throws(()=>seekPosition(media,NaN),/unavailable/);
});

test('small ticks accumulate across browser seek gaps without repeating the same command',async()=>{
 const dial=new DialSeeking(),sent=[],send=async p=>{sent.push(p);};
 const browser={...media,source:'chrome',timeline:{...media.timeline,position_sec:30},
  browser_media:{seekable_ranges:[[10,30],[60,110]]}};
 for(let tick=0;tick<4;tick++) await dial.rotate('dial',browser,5,send,10000+tick);
 assert.deepEqual(sent,[30,60]);
 for(let tick=0;tick<4;tick++) await dial.rotate('dial',browser,-5,send,10010+tick);
 assert.deepEqual(sent,[30,60,30]);
 // Overshooting the outer limits must not accumulate unreachable time.
 await dial.rotate('dial',browser,500,send,10020);
 await dial.rotate('dial',browser,-5,send,10021);
 assert.deepEqual(sent.slice(-2),[110,105]);
 await dial.rotate('dial',browser,-500,send,10022);
 await dial.rotate('dial',browser,5,send,10023);
 assert.deepEqual(sent.slice(-2),[10,15]);
});

test('paused browser heartbeats preserve gap accumulation until the position or ranges change',async()=>{
 const dial=new DialSeeking(),sent=[],send=async p=>{sent.push(p);};
 const browser={...media,source:'chrome',timeline:{...media.timeline,position_sec:30},
  browser_media:{seekable_ranges:[[10,30],[60,110]]}};
 for(let tick=0;tick<4;tick++) {
  const now=10000+tick*1000;
  await dial.rotate('dial',{...browser,timeline:{...browser.timeline,updated_at:now}},5,send,now);
 }
 assert.deepEqual(sent,[30,60]);
 const moved={...browser,timeline:{...browser.timeline,position_sec:80,updated_at:14000}};
 await dial.rotate('dial',moved,-5,send,14000);
 assert.equal(sent.at(-1),75);
 const newRanges={...moved,browser_media:{seekable_ranges:[[10,30],[80,110]]}};
 await dial.rotate('dial',newRanges,5,send,14001);
 assert.equal(sent.at(-1),85);
});

test('queued seeks use the latest browser ranges while a command is pending',async()=>{
 const dial=new DialSeeking(),sent=[];let release;
 const browser={...media,source:'chrome',timeline:{...media.timeline,position_sec:30},
  browser_media:{seekable_ranges:[[10,30],[60,110]]}};
 const send=async p=>{sent.push(p);if(sent.length===1) await new Promise(resolve=>{release=resolve;});};
 const first=dial.rotate('dial',browser,5,send,10000);
 const next={...browser,browser_media:{seekable_ranges:[[10,30],[80,110]]}};
 const second=dial.rotate('dial',next,30,send,10001);
 release();await Promise.all([first,second]);
 assert.deepEqual(sent,[30,80]);
});

test('failed operations, track changes, disappearance and stale targets reset the base',async()=>{
 const dial=new DialSeeking(),sent=[],send=async p=>{sent.push(p);};
 await assert.rejects(dial.rotate('dial',media,5,async()=>{throw Error('rejected');},10000),/rejected/);
 await dial.rotate('dial',media,5,send,10001);assert.equal(sent.at(-1),55);
 await dial.rotate('dial',{...media,title:'New track'},5,send,10002);assert.equal(sent.at(-1),55);
 dial.clear('dial');
 await dial.rotate('dial',media,-5,send,10003);assert.equal(sent.at(-1),45);
 await dial.rotate('dial',media,5,send,13000);assert.equal(sent.at(-1),55);
 await assert.rejects(dial.rotate('dial',{...media,timeline:{...media.timeline,position_sec:null}},5,send,13001),/position unavailable/);
 assert.equal(sent.length,4);
});

test('clearing an in-flight dial prevents queued seeks after disappearance',async()=>{
 const dial=new DialSeeking(),sent=[];let release;
 const first=dial.rotate('dial',media,5,async p=>{sent.push(p);await new Promise(resolve=>{release=resolve;});},10000);
 const second=dial.rotate('dial',media,5,async()=>assert.fail('overlapping command'),10001);
 dial.clear('dial');release();await Promise.all([first,second]);
 assert.deepEqual(sent,[55]);
});

test('track changes wait for the previous seek and discard its accumulated destination',async()=>{
 const dial=new DialSeeking(),sent=[];let release;
 const first=dial.rotate('dial',media,5,async p=>{sent.push(['old',p]);await new Promise(resolve=>{release=resolve;});},10000);
 const queued=dial.rotate('dial',media,10,async()=>assert.fail('old queued callback'),10001);
 const changed={...media,title:'New track',timeline:{...media.timeline,position_sec:20}};
 const next=dial.rotate('dial',changed,5,async p=>{sent.push(['new',p]);},10002);
 assert.deepEqual(sent,[['old',55]]);
 release();await Promise.all([first,queued,next]);
 assert.deepEqual(sent,[['old',55],['new',25]]);
});

test('same-metadata Chrome target changes reset accumulated seeks and replace waiting ticks',async()=>{
 const dial=new DialSeeking(),sent=[];let release;
 const old={...media,source:'chrome',browser_media:{target_id:'media-1'}};
 const send=async p=>{sent.push(p);};
 await dial.rotate('dial',old,5,send,10000);
 const changed={...old,browser_media:{target_id:'media-2'}};
 await dial.rotate('dial',changed,5,send,10001);
 assert.deepEqual(sent,[55,55],'a new media source starts at its own position');
 const first=dial.rotate('dial',changed,5,async p=>{sent.push(p);await new Promise(resolve=>{release=resolve;});},10002);
 const queued=dial.rotate('dial',changed,5,async()=>assert.fail('old queued callback'),10003);
 const replacement={...changed,browser_media:{target_id:'media-3'},timeline:{...media.timeline,position_sec:20}};
 const next=dial.rotate('dial',replacement,5,send,10004);
 release();await Promise.all([first,queued,next]);
 assert.deepEqual(sent,[55,55,60,25]);
});

test('clearing and reusing a dial waits for its in-flight command',async()=>{
 const dial=new DialSeeking(),sent=[];let release;
 const first=dial.rotate('dial',media,5,async p=>{sent.push(p);await new Promise(resolve=>{release=resolve;});},10000);
 const queued=dial.rotate('dial',media,5,async()=>assert.fail('old queued callback'),10001);
 dial.clear('dial');
 const next=dial.rotate('dial',media,15,async p=>{sent.push(p);},10002);
 assert.deepEqual(sent,[55]);
 release();await Promise.all([first,queued,next]);
 assert.deepEqual(sent,[55,65]);
});

test('an older failed seek cannot delete a replacement or reject its waiting ticks',async()=>{
 const dial=new DialSeeking(),sent=[];let reject;
 const first=dial.rotate('dial',media,5,async p=>{sent.push(['old',p]);await new Promise((_resolve,rejectSeek)=>{reject=rejectSeek;});},10000);
 const failed=assert.rejects(first,/old seek failed/);
 const changed={...media,title:'New track',timeline:{...media.timeline,position_sec:20}};
 const next=dial.rotate('dial',changed,5,async p=>{sent.push(['new',p]);},10001);
 const ticks=dial.rotate('dial',changed,5,async()=>assert.fail('overlapping replacement'),10002);
 assert.deepEqual(sent,[['old',55]]);
 reject(new Error('old seek failed'));await Promise.all([failed,next,ticks]);
 assert.deepEqual(sent,[['old',55],['new',30]]);
 await dial.rotate('dial',changed,5,async p=>{sent.push(['new',p]);},10003);
 assert.deepEqual(sent,[['old',55],['new',30],['new',35]]);
});

test('a replacement cleared while waiting never sends its queued seek',async()=>{
 const dial=new DialSeeking(),sent=[];let release;
 const first=dial.rotate('dial',media,5,async p=>{sent.push(p);await new Promise(resolve=>{release=resolve;});},10000);
 dial.clear('dial');
 const discarded=dial.rotate('dial',media,15,async()=>assert.fail('cleared replacement'),10001);
 dial.clear('dial');
 const latest=dial.rotate('dial',media,-5,async p=>{sent.push(p);},10002);
 release();await Promise.all([first,discarded,latest]);
 assert.deepEqual(sent,[55,45]);
});

test('touch seeks replace queued rotation and later ticks start at the tapped position',async()=>{
 const dial=new DialSeeking(),sent=[];let release;
 const send=async p=>{sent.push(p);if(sent.length===1) await new Promise(resolve=>{release=resolve;});};
 const first=dial.rotate('dial',media,5,send,10000);
 const queued=dial.rotate('dial',media,10,send,10001);
 const tap=dial.seekTo('dial',media,80,send,10002);
 const tick=dial.rotate('dial',media,-5,send,10003);
 assert.deepEqual(sent,[55]);
 release();await Promise.all([first,queued,tap,tick]);
 assert.deepEqual(sent,[55,75]);
 await dial.rotate('dial',media,5,send,10004);
 assert.deepEqual(sent,[55,75,80]);
});

test('rapid taps keep the latest position and remain ordered after a failed command',async()=>{
 const dial=new DialSeeking(),sent=[];let reject;
 const first=dial.seekTo('dial',media,20,async p=>{sent.push(p);await new Promise((_resolve,r)=>{reject=r;});},10000);
 const failed=assert.rejects(first,/failed/);
 const discarded=dial.seekTo('dial',media,40,async()=>assert.fail('outdated tap'),10001);
 const last=dial.seekTo('dial',media,90,async p=>{sent.push(p);},10002);
 assert.deepEqual(sent,[20]);
 reject(Error('failed'));await Promise.all([failed,discarded,last]);
 assert.deepEqual(sent,[20,90]);
});

test('touch seeks support unknown current position and browser gaps, and cancel on disappearance',async()=>{
 const dial=new DialSeeking(),sent=[];let release;
 const browser={...media,source:'chrome',timeline:{...media.timeline,position_sec:null},
  browser_media:{seekable_ranges:[[10,30],[60,110]]}};
 const first=dial.seekTo('dial',browser,50,async p=>{sent.push(p);await new Promise(resolve=>{release=resolve;});},10000);
 const next=dial.seekTo('dial',browser,100,async()=>assert.fail('hidden action'),10001);
 dial.clear('dial');release();await Promise.all([first,next]);
 assert.deepEqual(sent,[60]);
 await assert.rejects(dial.seekTo('dial',browser,NaN,async()=>assert.fail('invalid position')),/unavailable/);
 await assert.rejects(dial.seekTo('dial',{...media,controls:{seek:false}},50,async()=>assert.fail('unsupported seek')),/unavailable/);
});
