import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {load} from "./load.mjs";
import {worker} from './worker-harness.mjs';
import sharp from 'sharp';
import {rasterWorkerHooks} from './raster-worker-harness.mjs';
const {playbackPosition}=await load("media-model");
const source=readFileSync(new URL("../chrome-extension/page-main.js",import.meta.url),"utf8");
function page(players=[],icons=[],modern=true,options={}) {
  const messages=[],events=new Map(),session={metadata:null,playbackState:"none",setPositionState(){}};
  const address=new URL(options.url??'https://example.test');
  const window={origin:address.origin,postMessage(v,targetOrigin){assert.equal(targetOrigin,this.origin);messages.push(v);},addEventListener(name,fn){events.set(name,fn);}};
  let tick,now=10000;
  const context={window,navigator:{mediaSession:session},document:{title:"Private page title",baseURI:options.baseURI??address.href,
    head:{querySelectorAll(selector){
      assert.equal(selector,'meta[property^="og:"]');
      return (options.og??[]).map(([property,content])=>({getAttribute:name=>({property,content})[name]}));
    }},querySelectorAll(selector){
    if(selector==='audio,video') return players;
    const relations=Array.from(selector.matchAll(/\[rel(~?)="([^"]+)"\]/g));
    return icons.filter(icon=>relations.some(([,token,rel])=>token?(icon.rel??'icon').split(/\s+/).includes(rel):(icon.rel??'icon')===rel));
  },addEventListener(){}},location:address,setInterval(fn){tick=fn;},Date:{now:()=>now},Number,Array,URL};
  vm.runInNewContext(source,context);
  if(modern) events.get('message')({source:window,origin:address.origin,data:{kind:'__streamdeck_media_metadata_v1___transport',protocol:2}});
  return {session,messages,events,window,address,tick:()=>tick(),advance:ms=>{now+=ms;}};
}
function player(src='https://media.test/private-a?token=secret') {
  return {currentSrc:src,tagName:'AUDIO',readyState:4,paused:false,ended:false,seeking:false,
    currentTime:10,duration:100,playbackRate:1,seekable:{length:1,start:()=>0,end:()=>100},
    pause(){this.paused=true;},async play(){this.paused=false;}};
}
async function command(p,media,operation='play-pause',extra={}) {
  await p.events.get('message')({source:p.window,origin:'https://example.test',data:{kind:'__streamdeck_media_metadata_v1___command',
    command:{id:'command',title:media.title,target_id:media.browser_media?.target_id,command:operation,...extra}}});
  return p.messages.at(-1).ok;
}
test("empty pages do not invent track titles; setPositionState reset clears stale position",()=>{
  const p=page();assert.equal(p.messages.at(-1).media.title,"");
  p.session.metadata={title:"Track",artist:"Artist",artwork:[]};
  p.session.setPositionState({position:45,duration:100});
  p.tick();assert.equal(p.messages.at(-1).media.timeline.position_sec,45);
  p.events.get("message")({source:p.window,origin:"https://example.test",data:{kind:"__streamdeck_media_metadata_v1___command",command:{id:"1",title:"Track",command:"play-pause"}}});
  assert.equal(p.messages.at(-1).ok,false);
  p.session.setPositionState();
  p.tick();assert.equal(p.messages.at(-1).media.timeline.position_sec,undefined);
  p.session.setPositionState({position:70,duration:100});
  p.session.metadata={title:"New track",artist:"Artist",artwork:[]};
  p.tick();assert.equal(p.messages.at(-1).media.timeline.position_sec,undefined);
});
test("ambiguous media elements do not enable arbitrary controls",()=>{
  const element={currentSrc:"a",readyState:4,paused:false,ended:false};
  const p=page([element,{...element,currentSrc:"b"}]);
  assert.equal(p.messages.at(-1).media.title,"");
});

test('observed Media Session position advances at its rate and holds across pause/resume',()=>{
 const p=page();p.session.metadata={title:'Track',artwork:[]};p.session.playbackState='playing';
 p.session.setPositionState({position:10,duration:100,playbackRate:2});
 p.advance(2000);p.tick();assert.equal(playbackPosition({...p.messages.at(-1).media,source:'chrome'},12000),14);
 assert.equal(p.messages.at(-1).media.timeline.updated_at,10000,'normal playback uses local interpolation');
 p.session.playbackState='paused';p.tick();
 p.advance(5000);p.tick();assert.equal(p.messages.at(-1).media.timeline.position_sec,14);
 p.session.playbackState='playing';p.tick();
 p.advance(1000);p.tick();assert.equal(playbackPosition({...p.messages.at(-1).media,source:'chrome'},18000),16);
 p.session.setPositionState({duration:100});
 assert.equal(p.messages.at(-1).media.timeline.position_sec,0);
 assert.equal(p.messages.at(-1).media.playback_rate,1);
 p.session.setPositionState({});p.tick();assert.equal(p.messages.at(-1).media.timeline.position_sec,undefined);
});

test('HTML media position, duration, timestamp and seek range are sampled together',()=>{
 const ranges={length:1,start:()=>5,end:()=>90};
 const player={currentSrc:'a',tagName:'VIDEO',readyState:4,paused:false,ended:false,seeking:false,
  currentTime:15,duration:100,playbackRate:1.5,seekable:ranges,buffered:ranges};
 const p=page([player]);
 assert.equal(p.messages.at(-1).media.timeline.position_sec,15);
 assert.equal(p.messages.at(-1).media.timeline.end_sec,100);
 assert.equal(p.messages.at(-1).media.timeline.min_seek_sec,5);
 assert.equal(p.messages.at(-1).media.timeline.max_seek_sec,90);
 p.advance(1000);player.currentTime=16.5;p.tick();
 assert.equal(playbackPosition({...p.messages.at(-1).media,source:'chrome'},11000),16.5);
 assert.equal(p.messages.at(-1).media.timeline.updated_at,10000);
 player.currentTime=40;p.tick();assert.equal(p.messages.at(-1).media.timeline.position_sec,40,'a position discontinuity resynchronizes immediately');
});

test('page favicons follow link changes without replacing media artwork',()=>{
 const icons=[{href:'https://example.test/icon.ico',sizes:{value:'32x32'},type:'image/x-icon'}];
 const p=page([],icons);p.session.metadata={title:'Track',artwork:[{src:'https://example.test/album.png'}]};
 p.tick();assert.equal(p.messages.at(-1).media.favicon_candidates[0].src,icons[0].href);
 assert.equal(p.messages.at(-1).media.artwork_candidates[0].src,'https://example.test/album.png');
 icons[0].href='https://example.test/changed.png';p.tick();
 assert.equal(p.messages.at(-1).media.favicon_candidates[0].src,icons[0].href);
});

function openGraphFixture(url='https://example.test/watch?v=current',tagName='VIDEO') {
 const element={...player(),tagName:'VIDEO'};
 element.tagName=tagName;
 const og=[['og:title','Current video'],['og:url',url],
  ['og:image','https://cdn.test/original.jpg'],['og:image:width','1280'],['og:image:height','720'],['og:image:type','image/jpeg']];
 const players=[element],options={url,og},p=page(players,[],true,options);
 p.session.metadata={title:'Current video',artwork:[{src:'https://cdn.test/thumbnail.jpg',sizes:'320x180',type:'image/jpeg'}]};
 p.tick();
 return {p,element,players,og,options};
}

test('Open Graph supplies artwork across sites and audio/video without site-specific APIs',()=>{
 for(const url of ['https://example.test/watch?v=current','https://www.youtube.com/watch?v=abcdefghijk']) for(const tagName of ['AUDIO','VIDEO']) {
  const {p}=openGraphFixture(url,tagName),media=p.messages.at(-1).media;
  assert.equal(media.artwork_candidates[0].src,p.session.metadata.artwork[0].src);
  assert.deepEqual({...media.artwork_candidates[1]},{src:'https://cdn.test/original.jpg',sizes:'1280x720',type:'image/jpeg',source:'opengraph'});
  assert.equal(media.title,'Current video');
  assert.equal(media.artist,'','artwork enrichment must not invent metadata');
 }
});

test('canonical OGP URLs permit extra playback parameters but reject different video identities',()=>{
 const canonical='https://www.youtube.com/watch?v=abcdefghijk';
 for(const suffix of ['&t=90s','&list=playlist&index=2','&feature=shared']) {
  const {p,og}=openGraphFixture(canonical+suffix);og[1][1]=canonical;p.tick();
  assert.equal(p.messages.at(-1).media.artwork_candidates.length,2,suffix);
 }
 for(const url of ['https://www.youtube.com/watch?v=other123456&t=90s',canonical+'&v=other123456',
  'https://other.test/watch?v=abcdefghijk','https://www.youtube.com/playlist?v=abcdefghijk']) {
  const {p,og}=openGraphFixture(url);og[1][1]=canonical;p.tick();
  assert.equal(p.messages.at(-1).media.artwork_candidates.length,1,url);
 }
});

test('Open Graph rejects stale SPA URLs, mismatched or missing titles and ambiguous players',()=>{
 for(const mismatch of ['url','title','missing-url','missing-title','missing-media-title','no-player','ambiguous']) {
  const {p,og,players}=openGraphFixture();
  if(mismatch==='url') p.address.search='?v=next';
  if(mismatch==='title') og[0][1]='Previous video';
  if(mismatch==='missing-url') og.splice(1,1);
  if(mismatch==='missing-title') og.shift();
  if(mismatch==='missing-media-title') p.session.metadata.title='';
  if(mismatch==='no-player') players.length=0;
  if(mismatch==='ambiguous') players.push(player('other'));
  p.tick();
  const candidates=p.messages.at(-1).media.artwork_candidates;
  assert.equal(candidates.length,1,mismatch);
  assert.equal(candidates[0].src,p.session.metadata.artwork[0].src,mismatch);
 }
});

test('Open Graph groups structured image properties and resolves relative and secure URLs',()=>{
 const {p,og}=openGraphFixture();
 og.splice(2,Infinity,
  ['og:image:width','999'], // Orphan structured properties are ignored.
  ['og:image','http://cdn.test/insecure.jpg'],['og:image:secure_url','https://cdn.test/secure.jpg'],
  ['og:image:width','800'],['og:image:height','600'],['og:image:type','image/png'],
  ['og:image:url','/relative.jpg'],
  ['og:image','/last.jpg'],['og:image:width','400'],['og:image:height','300'],
  ['og:video','https://cdn.test/video.mp4'],['og:image:width','100']);
 p.tick();
 assert.deepEqual(Array.from(p.messages.at(-1).media.artwork_candidates,a=>({...a})),[
  {...p.session.metadata.artwork[0]},
  {src:'https://cdn.test/secure.jpg',sizes:'800x600',type:'image/png',source:'opengraph'},
  {src:'https://example.test/relative.jpg',sizes:'',type:'',source:'opengraph'},
  {src:'https://example.test/last.jpg',sizes:'400x300',type:'',source:'opengraph'}
 ]);
 p.address.hash='#chapter';p.tick();
 assert.equal(p.messages.at(-1).media.artwork_candidates.length,4,'fragments do not change page identity');
});

test('Open Graph ignores invalid image URLs and bounds dimensions, strings and candidates',()=>{
 const {p,og}=openGraphFixture();
 for(const src of ['', 'https://[', 'http://cdn.test/plain.jpg', 'javascript:alert(1)', 'data:image/png;base64,AA==',
  'https://user:password@cdn.test/private.jpg','https://cdn.test/'+ 'x'.repeat(2048)]) {
  og.splice(2,Infinity,['og:image',src]);p.tick();
  assert.equal(p.messages.at(-1).media.artwork_candidates.length,1,src);
 }
 for(const dimension of ['0','-1','16385','1.5','1e3','Infinity','100junk']) {
  og.splice(2,Infinity,['og:image','/valid.jpg'],['og:image:width',dimension],['og:image:height','720']);p.tick();
  assert.equal(p.messages.at(-1).media.artwork_candidates[1].sizes,'',dimension);
 }
 og.splice(2,Infinity,['og:image','/valid.jpg'],['og:image:secure_url','https://['],['og:image:type','x'.repeat(100)]);p.tick();
 assert.equal(p.messages.at(-1).media.artwork_candidates[1].src,'https://example.test/valid.jpg');
 assert.equal(p.messages.at(-1).media.artwork_candidates[1].type.length,50);
 og.splice(2,Infinity,...Array.from({length:30},(_,i)=>['og:image',`/cover-${i}.jpg`]));p.tick();
 const candidates=p.messages.at(-1).media.artwork_candidates;
 assert.equal(candidates.length,16);
 assert.equal(candidates[0].src,p.session.metadata.artwork[0].src,'Media Session retains its slot at the candidate limit');
 assert.equal(candidates.at(-1).src,'https://example.test/cover-14.jpg');
 og.splice(2,Infinity,...Array.from({length:126},()=>['og:description','unused']),['og:image','/beyond-limit.jpg']);p.tick();
 assert.equal(p.messages.at(-1).media.artwork_candidates.length,1,'only the first 128 OGP tags are inspected');
});

test('Open Graph missing or malformed metadata leaves Media Session artwork available',()=>{
 for(const url of [undefined,'','https://[','https://other.test/watch?v=current','/watch?v=previous','x'.repeat(2049)]) {
  const {p,og}=openGraphFixture();og[1][1]=url;p.tick();
  assert.equal(p.messages.at(-1).media.artwork_candidates.length,1);
 }
 const {p,og}=openGraphFixture();og.length=0;p.tick();
 assert.equal(p.messages.at(-1).media.artwork_candidates[0].src,p.session.metadata.artwork[0].src);
 const idle=page([],[],true,{og:[['og:title','Unrelated page'],['og:url','https://example.test'],['og:image','/cover.jpg']]});
 assert.deepEqual({...idle.messages.at(-1).media},{title:''},'OGP does not create a media session');
});

test('Open Graph original artwork reaches the shared bridge without being reduced to the Media Session thumbnail',async()=>{
 const {p}=openGraphFixture();
 const original=await sharp({create:{width:1280,height:720,channels:3,background:'#226688'}}).jpeg().toBuffer();
 const thumbnail=await sharp(original).resize(320,180).jpeg().toBuffer();
 const hooks=rasterWorkerHooks();
 const w=worker(true,url=>url==='https://cdn.test/original.jpg'||url==='https://cdn.test/thumbnail.jpg'
  ?new Response(url.endsWith('/original.jpg')?original:thumbnail,{headers:{'content-type':'image/jpeg'}}):new Response(null,{status:404}),hooks);
 w.send(p.messages.at(-1).media);
 await new Promise(resolve=>setTimeout(resolve,50));
 const delivered=w.requests.map(request=>JSON.parse(request.options.body)).map(body=>body.media).filter(media=>media?.artwork_data_url).at(-1);
 assert.ok(delivered,'completed artwork is published without another page event');
 const image=await sharp(Buffer.from(delivered.artwork_data_url.split(',')[1],'base64')).metadata();
 assert.deepEqual([image.width,image.height],[1280,720]);
 assert.deepEqual(w.images.filter(image=>image.url.startsWith('https://cdn.test/')).map(image=>image.url),
  ['https://cdn.test/thumbnail.jpg','https://cdn.test/original.jpg']);
 hooks.assertClosed();
});

test('TVer style precomposed touch icons are collected for videos without Media Session metadata',()=>{
 const icons=[{rel:'apple-touch-icon-precomposed',href:'https://tver.jp/apple-touch-icon-precomposed.png'},
  {rel:'icon',href:'https://tver.jp/favicon.ico'},
  {rel:'manifest',href:'https://tver.jp/manifest.webmanifest'}];
 const player={currentSrc:'video',tagName:'VIDEO',readyState:4,paused:false,ended:false,currentTime:1,duration:10,seekable:{length:0}};
 const p=page([player],icons),media=p.messages.at(-1).media;
 assert.equal(media.title,'');
 assert.deepEqual(Array.from(media.favicon_candidates,a=>a.src),icons.slice(0,2).map(a=>a.href));
 assert.equal(media.artwork_candidates.length,0);
});

test('media target IDs stay stable across timeline and playback changes without exposing source URLs',async()=>{
 const element=player(),p=page([element]);
 const first=p.messages.at(-1).media,id=first.browser_media.target_id;
 assert.match(id,/^[A-Za-z0-9_-]{1,100}$/);
 assert.equal(JSON.stringify(first).includes(element.currentSrc),false);
 p.advance(1000);element.currentTime=11;element.playbackRate=1.5;element.duration=120;p.tick();
 assert.equal(p.messages.at(-1).media.browser_media.target_id,id);
 assert.equal(await command(p,first),true);assert.equal(element.paused,true);
 assert.equal(p.messages.at(-2).media.browser_media.target_id,id);
 assert.equal(await command(p,first),true);assert.equal(element.paused,false);
 assert.equal(await command(p,first,'seek',{position:40}),true);assert.equal(element.currentTime,40);
 assert.equal(await command(p,first,'stop'),true);assert.equal(element.paused,true);assert.equal(element.currentTime,0);
 assert.equal(p.messages.at(-2).media.browser_media.target_id,id);
});

test('queued commands cannot operate a different track with the same title',async()=>{
 for(const field of ['title','artist','album']) {
  const element=player(),p=page([element]);
  p.session.metadata={title:'Same title',artist:'Artist A',album:'Album A',artwork:[]};p.tick();
  const previous=p.messages.at(-1).media;
  p.session.metadata={...p.session.metadata,[field]:'Changed'};
  assert.equal(await command(p,previous),false,field);
  assert.equal(element.paused,false,`${field}: stale command must not pause the new track`);
  p.tick();const fresh=p.messages.at(-1).media;
  assert.notEqual(fresh.browser_media.target_id,previous.browser_media.target_id,field);
  assert.equal(await command(p,fresh),true,`${field}: fresh commands remain available`);
 }
});

test('same-title and untitled source replacements invalidate queued commands',async()=>{
 for(const titled of [false,true]) for(const replace of ['source','element','stream']) {
  const players=[player()],p=page(players);
  if(titled) p.session.metadata={title:'Same title',artist:'Artist',artwork:[]};
  p.tick();const previous=p.messages.at(-1).media;
  if(replace==='source') players[0].currentSrc='https://media.test/private-b?token=secret';
  else if(replace==='element') players[0]=player();
  else players[0].srcObject={};
  assert.equal(await command(p,previous),false,`${titled}/${replace}`);
  assert.equal(players[0].paused,false);
  p.tick();const fresh=p.messages.at(-1).media;
  assert.notEqual(fresh.browser_media.target_id,previous.browser_media.target_id);
  assert.equal(await command(p,fresh),true);
 }
});

test('ambiguous selection expires an old media target and commands without target IDs are rejected',async()=>{
 const element=player(),players=[element],p=page(players),previous=p.messages.at(-1).media;
 assert.equal(await command(p,previous,'play-pause',{target_id:undefined}),false);
 assert.equal(element.paused,false);
 players.push(player('other'));p.tick();
 assert.equal(await command(p,previous),false);
 players.pop();p.tick();
 const fresh=p.messages.at(-1).media;
 assert.notEqual(fresh.browser_media.target_id,previous.browser_media.target_id);
 assert.equal(await command(p,previous),false);
 assert.equal(await command(p,fresh),true);
});

test('idle pages send no recurring traffic; normal playback resynchronizes every five seconds',()=>{
 const idle=page(),element=player(),playing=page([element]);
 for(let second=1;second<=60;second++) {
   idle.advance(1000);idle.tick();playing.advance(1000);element.currentTime=10+second;playing.tick();
 }
 assert.equal(idle.messages.length,1);
 assert.equal(playing.messages.length,13);
 element.paused=true;playing.tick();assert.equal(playing.messages.at(-1).media.playback_state,'paused');
 element.currentTime=5;playing.tick();assert.equal(playing.messages.at(-1).media.timeline.position_sec,5);
});

test('older transport retains one-second command polling while modern transport is negotiated',()=>{
 const element=player(),p=page([element],[],false);
 for(let second=1;second<=5;second++) {p.advance(1000);element.currentTime=10+second;p.tick();}
 assert.equal(p.messages.length,6);
});
