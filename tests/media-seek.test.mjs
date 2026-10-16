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
