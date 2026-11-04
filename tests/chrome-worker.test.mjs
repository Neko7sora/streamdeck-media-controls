import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from './load.mjs';
import {worker} from './worker-harness.mjs';
import {rasterWorkerHooks} from './raster-worker-harness.mjs';
import sharp from 'sharp';
const {ChromeWire}=await load('chrome-wire');
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
const flush=()=>new Promise(setImmediate);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const updates=w=>w.requests.filter(x=>!x.url.endsWith('/result')).map(x=>JSON.parse(x.options.body));
const mediaUpdates=w=>updates(w).filter(body=>body.media!==null);

const coverPixels=Buffer.alloc(320*180*3);
for(let y=0;y<180;y++) for(let x=0;x<320;x++) {
  const offset=(y*320+x)*3,block=x>20&&x<100&&y>30&&y<90;
  coverPixels[offset]=block?180:40+Math.floor(x/2);
  coverPixels[offset+1]=block?40:50+y;
  coverPixels[offset+2]=block?20:160;
}
const cover=await sharp(coverPixels,{raw:{width:320,height:180,channels:3}}).png().toBuffer();
const thumbnail=await sharp(cover).resize(160,90).jpeg({quality:80}).toBuffer();
const avifThumbnail=await sharp(cover).resize(336,188,{fit:'fill'}).avif({quality:60}).toBuffer();
const dataUrl=(data,mime='image/png')=>`data:${mime};base64,${data.toString('base64')}`;

for(const protocol2 of [false,true]) {
 test(`Media Session displays before a slow OGP response in protocol ${protocol2?2:1}`,async()=>{
  const pending=deferred(),received=[],wire=new ChromeWire(),hooks=rasterWorkerHooks();
  const w=worker(true,async url=>{
    if(url.endsWith('/ogp.png')) {await pending.promise;return new Response(cover,{headers:{'content-type':'image/png'}});}
    return url.endsWith('/media.jpg')?new Response(thumbnail,{headers:{'content-type':'image/jpeg'}}):new Response(null,{status:404});
  },{...hooks,protocol2,async bridgeResponse(_url,body){
    if(body.media) received.push(protocol2?wire.decode(body).media:body.media);
    return {json:async()=>({ok:true,commands:[]})};
  }});
  await flush();
  w.send({title:'Track',artwork_candidates:[{src:'https://cdn.test/media.jpg'},{src:'https://cdn.test/ogp.png',source:'opengraph'}]});
  try {
    for(let i=0;i<100&&!received.at(-1)?.artwork_data_url;i++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(received.at(-1)?.artwork_data_url===dataUrl(thumbnail,'image/jpeg'),'baseline is visible before OGP completes');
  } finally {pending.resolve();}
  for(let i=0;i<100&&w.busy();i++) await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(received.at(-1)?.artwork_data_url===dataUrl(cover),'matching higher-resolution OGP replaces the baseline');
  hooks.assertClosed();
 });
}

for(const protocol2 of [false,true]) {
 test(`AVIF from a .jpg URL reaches pHash comparison and higher-resolution OGP in protocol ${protocol2?2:1}`,async()=>{
  const pending=deferred(),received=[],wire=new ChromeWire(),hooks=rasterWorkerHooks();
  const large=await sharp(cover).resize(1280,720).jpeg().toBuffer();
  const w=worker(true,async url=>{
    if(url.endsWith('/ogp.jpg')) {await pending.promise;return new Response(large,{headers:{'content-type':'image/jpeg'}});}
    return url.endsWith('/hqdefault.jpg')?new Response(avifThumbnail,{headers:{'content-type':'image/avif'}}):new Response(null,{status:404});
  },{...hooks,protocol2,async bridgeResponse(_url,body){
    if(body.media) received.push(protocol2?wire.decode(body).media:body.media);
    return {json:async()=>({ok:true,commands:[]})};
  }});
  w.send({title:'YouTube fixture',artwork_candidates:[
    {src:'https://cdn.test/hqdefault.jpg',sizes:'320x180',type:'image/jpeg'},
    {src:'https://cdn.test/ogp.jpg',sizes:'1280x720',source:'opengraph'}
  ]});
  try {
    for(let i=0;i<100&&!received.at(-1)?.artwork_data_url;i++) await new Promise(resolve=>setTimeout(resolve,10));
    const baseline=received.at(-1)?.artwork_data_url;
    assert.match(baseline,/^data:image\/webp;base64,/,'AVIF is normalized for the existing wire');
    const metadata=await sharp(Buffer.from(baseline.split(',')[1],'base64')).metadata();
    assert.equal(metadata.width,336);assert.equal(metadata.height,188);
  } finally {pending.resolve();}
  for(let i=0;i<100&&w.busy();i++) await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(w.busy(),0);
  assert.equal(received.at(-1).artwork_data_url,dataUrl(large,'image/jpeg'));
  hooks.assertClosed();
 });
}

test('AVIF OGP and standalone artwork are normalized, bounded, and decode failures retain a usable image',async()=>{
 const avifCover=await sharp(cover).avif({quality:60}).toBuffer();
 const largeAvif=await sharp(cover).resize(1280,720).avif({quality:60}).toBuffer();
 for(const scenario of ['upgrade','standalone','large-standalone','broken','oversized-output','oversized-decode']) {
  const hooks=rasterWorkerHooks();
  if(scenario==='oversized-output') hooks.OffscreenCanvas=class {
    constructor(width,height) {this.width=width;this.height=height;}
    getContext(){return {drawImage(){}};}
    async convertToBlob(){return new Blob([new Uint8Array(350001)],{type:'image/webp'});}
  };
  if(scenario==='oversized-decode') hooks.createImageBitmap=async()=>({width:16385,height:1,close(){}});
  const wire=new ChromeWire(),received=[];
  const w=worker(true,url=>url.endsWith('/media.jpg')||url.endsWith('/ogp.avif')
    ?new Response(url.endsWith('/media.jpg')?thumbnail:scenario==='broken'?Buffer.from('invalid AVIF'):scenario==='large-standalone'?largeAvif:avifCover,
      {headers:{'content-type':url.endsWith('/media.jpg')?'image/jpeg':'image/avif'}})
    :new Response(null,{status:404}),{...hooks,protocol2:true,async bridgeResponse(_url,body){
      if(body.media) received.push(wire.decode(body).media);
      return {json:async()=>({ok:true,commands:[]})};
    }});
  w.send({title:scenario,artwork_candidates:[
    ...(scenario.endsWith('standalone')||scenario.startsWith('oversized')?[]:[{src:'https://cdn.test/media.jpg'}]),
    {src:'https://cdn.test/ogp.avif',source:'opengraph',type:'image/avif'}
  ]});
  for(let i=0;i<100&&(!received.length||w.busy());i++) await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(w.busy(),0,scenario);
  const data=received.at(-1).artwork_data_url;
  if(scenario==='broken') assert.equal(data,dataUrl(thumbnail,'image/jpeg'));
  else if(scenario.startsWith('oversized')) assert.equal(data??undefined,undefined,scenario);
  else {
    assert.match(data,/^data:image\/webp;base64,/,scenario);
    const bytes=Buffer.from(data.split(',')[1],'base64'),metadata=await sharp(bytes).metadata();
    assert.ok(bytes.length<=350000);
    assert.equal(metadata.width,scenario==='large-standalone'?1024:320);
    assert.equal(metadata.height,scenario==='large-standalone'?576:180);
  }
  hooks.assertClosed();
 }
});

for(const protocol2 of [false,true]) {
 test(`OGP replaces Media Session only for matching content at higher decoded resolution in protocol ${protocol2?2:1}`,async()=>{
  const variations=[
    ['same image, higher resolution',cover,true],
    ['same image after strong JPEG compression',await sharp(cover).jpeg({quality:25}).toBuffer(),true],
    ['same image with a modest brightness change',await sharp(cover).linear(1,16).png().toBuffer(),true],
    ['same image after slight blur',await sharp(cover).blur(1).png().toBuffer(),true],
    ['same composition with different colors',await sharp(cover).tint('#ef2211').png().toBuffer(),false],
    ['different composition with the same colors',await sharp(cover).flop().png().toBuffer(),false],
    ['cropped composition at the same aspect ratio',await sharp(cover).extract({left:80,top:45,width:160,height:90}).resize(320,180).png().toBuffer(),false],
    ['different image with the same title',await sharp({create:{width:320,height:180,channels:3,background:'#246688'}}).png().toBuffer(),false],
    ['same resolution',await sharp(cover).resize(160,90).png().toBuffer(),false],
    ['lower resolution despite a larger declared size',await sharp(cover).resize(80,45).png().toBuffer(),false],
    ['different aspect ratio',await sharp(cover).resize(320,320,{fit:'fill'}).png().toBuffer(),false],
    ['wider but shorter',await sharp(cover).resize(320,60,{fit:'fill'}).png().toBuffer(),false],
    ['malformed OGP image',Buffer.from('not an image'),false]
  ];
  for(const [name,ogp,upgrade] of variations) {
    const hooks=rasterWorkerHooks(),received=[],wire=new ChromeWire();
    const w=worker(true,url=>url.endsWith('/media.jpg')||url.endsWith('/ogp.png')
      ?new Response(url.endsWith('/media.jpg')?thumbnail:ogp,{headers:{'content-type':url.endsWith('.jpg')?'image/jpeg':'image/png'}})
      :new Response(null,{status:404}),{...hooks,protocol2,async bridgeResponse(_url,body){
        if(body.media) received.push(protocol2?wire.decode(body).media:body.media);
        return {json:async()=>({ok:true,commands:[]})};
      }});
    await flush();
    w.send({title:'Same title',artwork_candidates:[
      {src:'https://cdn.test/ogp.png',sizes:'4096x4096',source:'opengraph'},
      {src:'https://cdn.test/media.jpg',sizes:'1x1'}
    ]});
    // Wait for the image queue to drain rather than depending on decode speed.
    for(let i=0;i<100&&(!received.length||w.busy());i++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(w.busy(),0,name);
    assert.ok(received.at(-1).artwork_data_url===(upgrade?dataUrl(ogp):dataUrl(thumbnail,'image/jpeg')),name);
    assert.deepEqual(w.images.filter(image=>image.url.startsWith('https://cdn.test/')).map(image=>image.url),
      ['https://cdn.test/media.jpg','https://cdn.test/ogp.png'],name);
    hooks.assertClosed();
  }
 });
}

test('flat pHash collisions and transparency changes cannot promote different OGP artwork',async()=>{
 const solid=async(width,height,color)=>sharp({create:{width,height,channels:4,background:color}}).png().toBuffer();
 const baseline=await solid(160,90,'#246688');
 for(const [name,ogp,upgrade] of [
   ['identical flat image',await solid(320,180,'#246688'),true],
   ['different flat color',await solid(320,180,'#347698'),false],
   ['different opacity',await solid(320,180,{r:36,g:102,b:136,alpha:0.5}),false]
 ]) {
  const hooks=rasterWorkerHooks();
  const w=worker(true,url=>url.endsWith('/media.png')||url.endsWith('/ogp.png')
    ?new Response(url.endsWith('/media.png')?baseline:ogp,{headers:{'content-type':'image/png'}})
    :new Response(null,{status:404}),hooks);
  w.send({title:'Flat',artwork_candidates:[{src:'https://cdn.test/media.png'},{src:'https://cdn.test/ogp.png',source:'opengraph'}]});
  for(let i=0;i<100&&(!w.requests.length||w.busy());i++) await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(w.busy(),0,name);
  assert.equal(mediaUpdates(w).at(-1).media.artwork_data_url,dataUrl(upgrade?ogp:baseline),name);
  hooks.assertClosed();
 }
});

test('unavailable comparison keeps Media Session and never promotes an unverified OGP image',async()=>{
 for(const failure of ['baseline-download','baseline-decode','pixel-read','oversized','missing-canvas']) {
  const hooks=rasterWorkerHooks();
  if(failure==='pixel-read') hooks.OffscreenCanvas=class {getContext(){return {drawImage(){},getImageData(){throw Error('Canvas unavailable');}};}};
  if(failure==='missing-canvas') hooks.OffscreenCanvas=class {getContext(){return null;}};
  if(failure==='oversized') hooks.createImageBitmap=async()=>({width:16384,height:16384,close(){}});
  const media=failure==='baseline-decode'?Buffer.from('invalid'):thumbnail;
  const w=worker(true,url=>url.endsWith('/ogp.png')
    ?new Response(cover,{headers:{'content-type':'image/png'}})
    :url.endsWith('/media.jpg')&&failure!=='baseline-download'
      ?new Response(media,{headers:{'content-type':'image/jpeg'}}):new Response(null,{status:404}),hooks);
  w.send({title:'Track',artwork_candidates:[{src:'https://cdn.test/media.jpg'},{src:'https://cdn.test/ogp.png',source:'opengraph'}]});
  for(let i=0;i<100&&(!w.requests.length||w.busy());i++) await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(w.busy(),0,failure);
  assert.equal(mediaUpdates(w).at(-1).media.artwork_data_url,failure==='baseline-download'?undefined:dataUrl(media,'image/jpeg'),failure);
  assert.equal(w.images.some(image=>image.url.endsWith('/ogp.png')),false,failure);
  hooks.assertClosed();
 }
});

test('OGP remains a fallback when Media Session publishes no artwork',async()=>{
 const w=worker(true,url=>url.endsWith('/ogp.png')?new Response(cover,{headers:{'content-type':'image/png'}}):new Response(null,{status:404}));
 w.send({title:'Track',artwork_candidates:[{src:'https://cdn.test/ogp.png',source:'opengraph'}]});await settle();
 assert.equal(mediaUpdates(w).at(-1).media.artwork_data_url,dataUrl(cover));
});

test('OGP must improve on the largest published Media Session image',async()=>{
 const large=await sharp(cover).resize(1920,1080).jpeg().toBuffer();
 const ogp=await sharp(cover).resize(1600,900).png().toBuffer(),hooks=rasterWorkerHooks();
 const w=worker(true,url=>url.endsWith('/large.jpg')||url.endsWith('/ogp.png')
   ?new Response(url.endsWith('/large.jpg')?large:ogp,{headers:{'content-type':url.endsWith('.jpg')?'image/jpeg':'image/png'}})
   :new Response(null,{status:404}),hooks);
 w.send({title:'Track',artwork_candidates:[
   {src:'https://cdn.test/medium.jpg',sizes:'1280x720'},
   {src:'https://cdn.test/large.jpg',sizes:'1920x1080'},
   {src:'https://cdn.test/ogp.png',sizes:'1600x900',source:'opengraph'}
 ]});
 for(let i=0;i<100&&(!w.requests.length||w.busy());i++) await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(w.busy(),0);
 assert.ok(mediaUpdates(w).at(-1).media.artwork_data_url===dataUrl(large,'image/jpeg'));
 assert.deepEqual(w.images.filter(image=>image.url.startsWith('https://cdn.test/')).map(image=>image.url),
   ['https://cdn.test/large.jpg','https://cdn.test/ogp.png']);
 hooks.assertClosed();
});

test('OGP keeps all three Media Session fallback attempts and cannot displace an identical URL',async()=>{
 const hooks=rasterWorkerHooks();
 const w=worker(true,url=>url.endsWith('/working.jpg')||url.endsWith('/ogp.png')
   ?new Response(url.endsWith('/working.jpg')?thumbnail:cover,{headers:{'content-type':url.endsWith('.jpg')?'image/jpeg':'image/png'}})
   :new Response(null,{status:404}),hooks);
 w.send({title:'Track',artwork_candidates:[
   {src:'https://cdn.test/broken-1.jpg'},{src:'https://cdn.test/broken-2.jpg'},
   {src:'https://cdn.test/working.jpg'},{src:'https://cdn.test/ogp.png',source:'opengraph'}
 ]});
 for(let i=0;i<100&&(!w.requests.length||w.busy());i++) await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(w.busy(),0);
 assert.ok(mediaUpdates(w).at(-1).media.artwork_data_url===dataUrl(cover));
 assert.deepEqual(w.images.filter(image=>image.url.startsWith('https://cdn.test/')).map(image=>image.url),
   ['https://cdn.test/broken-1.jpg','https://cdn.test/broken-2.jpg','https://cdn.test/working.jpg','https://cdn.test/ogp.png']);
 hooks.assertClosed();
 const same=worker(true,url=>url.endsWith('/working.jpg')
   ?new Response(thumbnail,{headers:{'content-type':'image/jpeg'}}):new Response(null,{status:404}));
 same.send({title:'Track',artwork_candidates:[
   {src:'https://cdn.test/working.jpg',source:'opengraph',sizes:'4096x4096'},
   {src:'https://cdn.test/working.jpg',sizes:'160x90'}
 ]});await settle();
 assert.ok(mediaUpdates(same).at(-1).media.artwork_data_url===dataUrl(thumbnail,'image/jpeg'));
 assert.equal(same.images.filter(image=>image.url.endsWith('/working.jpg')).length,1);
});

test('a late OGP comparison cannot replace artwork after a track change',async()=>{
 const pending=deferred(),hooks=rasterWorkerHooks();
 const w=worker(true,async url=>{
   if(url.endsWith('/ogp.png')) {await pending.promise;return new Response(cover,{headers:{'content-type':'image/png'}});}
   return url.endsWith('.jpg')?new Response(thumbnail,{headers:{'content-type':'image/jpeg'}}):new Response(null,{status:404});
 },hooks);
 w.send({title:'Old',artwork_candidates:[{src:'https://cdn.test/old.jpg'},{src:'https://cdn.test/ogp.png',source:'opengraph'}]});
 for(let i=0;i<100&&!w.images.some(image=>image.url.endsWith('/ogp.png'));i++) await new Promise(resolve=>setTimeout(resolve,10));
 assert.ok(w.images.some(image=>image.url.endsWith('/ogp.png')));
 w.send({title:'New',artwork_candidates:[{src:'https://cdn.test/new.jpg'}]});await settle();
 pending.resolve();await settle();
 assert.equal(mediaUpdates(w).at(-1).media.title,'New');
 assert.ok(mediaUpdates(w).at(-1).media.artwork_data_url===dataUrl(thumbnail,'image/jpeg'));
 hooks.assertClosed();
});

for(const protocol2 of [false,true]) {
  test(`closing a tab immediately removes its completed frames in protocol ${protocol2?2:1}`,async()=>{
    const wire=new ChromeWire(),sessions=new Map();
    const w=worker(true,undefined,{protocol2,async bridgeResponse(_url,body){
      if(body.id) return {json:async()=>({ok:true})};
      const key=`${body.tab_id}:${body.frame_id}`,media=body.protocol===2?wire.decode(body).media:body.media;
      if(media===null) sessions.delete(key);else sessions.set(key,media);
      return {json:async()=>({ok:true,commands:[]})};
    }});
    await flush();
    w.send({title:'First'},0);w.send({title:'Child frame'},1);w.send({title:'Other tab'},0,5);await settle();
    assert.equal(sessions.size,3);
    const previous=updates(w);
    w.remove(4);await settle();
    assert.deepEqual([...sessions.keys()],['5:0']);
    const cleared=updates(w).filter(body=>body.media===null);
    assert.equal(cleared.length,2);
    for(const clear of cleared) {
      assert.equal(clear.tab_id,4);
      assert.equal(clear.document_id,`doc-${clear.frame_id}`);
      assert.ok(clear.sequence>Math.max(...previous.map(body=>body.sequence)));
    }
  });

  test(`late metadata cannot restore a closed tab in protocol ${protocol2?2:1}`,async t=>{
    const gate=deferred(),received=new Map(),latest=new Map();let commandCount=0;
    t.after(()=>gate.resolve());
    const w=worker(true,undefined,{protocol2,async bridgeResponse(_url,body){
      if(body.id) return {json:async()=>({ok:true})};
      if(body.media!==null) await gate.promise;
      const key=`${body.tab_id}:${body.frame_id}`;
      if(body.sequence>=(latest.get(key)??-1)) {
        latest.set(key,body.sequence);
        if(body.media===null) received.delete(key);else received.set(key,body.media);
      }
      return {json:async()=>({ok:true,commands:body.media===null?[]:[{id:`late-${++commandCount}`,command:'play-pause'}]})};
    }});
    await flush();w.send({title:'Closing track'});await flush();
    assert.equal(mediaUpdates(w).length,1);
    w.send({title:'Queued track'});w.remove(4);await settle();
    assert.equal(updates(w).filter(body=>body.media===null).length,1);
    gate.resolve();await settle();
    assert.equal(received.size,0);
    assert.equal(mediaUpdates(w).length,1);
    assert.equal(w.commands.length,0);
  });
}

test('a closed-tab notification cannot cross an interrupted opt-in generation',async()=>{
  const w=worker(true,undefined,{protocol2:true});await flush();
  w.send({title:'Track'});await settle();
  w.remove(4);w.changeSettings({enabled:false});w.changeSettings({enabled:true});await settle();
  assert.equal(updates(w).filter(body=>body.media===null).length,0);
});

test('closing many frames uses one removal request at a time and skips unpublished frames',async t=>{
  const gate=deferred();let blocked=false;
  t.after(()=>gate.resolve());
  const w=worker(true,undefined,{protocol2:true,async bridgeResponse(_url,body){
    if(body.media===null&&!blocked) {blocked=true;await gate.promise;}
    return {json:async()=>({ok:true,commands:[]})};
  }});
  await flush();
  for(let frame=0;frame<12;frame++) w.send({title:`Track ${frame}`},frame);
  await settle();w.remove(4);await flush();
  assert.equal(updates(w).filter(body=>body.media===null).length,1);
  gate.resolve();await settle();
  assert.equal(updates(w).filter(body=>body.media===null).length,12);
  const disabled=worker(false);disabled.send({title:'Never published'});disabled.remove(4);await flush();
  assert.equal(updates(disabled).length,0);
});
test('connection badges probe without media, recover from failures, and stop probing when disabled',async()=>{
  let ui,fail=false;
  const w=worker(true,undefined,{inspect(value){ui=value;},async statusResponse(){if(fail) throw Error('offline');return {json:async()=>({ok:true})};}});
  await flush();
  assert.equal(ui.badges.at(-1),'ON');assert.equal(w.requests.length,0);assert.equal(w.images.length,0);
  assert.deepEqual(JSON.parse(ui.probes[0].options.body),{client_id:w.settings.bridgeClientId});
  fail=true;ui.pulse();await flush();assert.equal(ui.badges.at(-1),'!');
  fail=false;assert.equal((await ui.status()).state,'connected');assert.equal(ui.badges.at(-1),'ON');
  w.changeSettings({enabled:false});await flush();
  const count=ui.probes.length;ui.pulse();await flush();
  assert.equal(ui.probes.length,count);assert.equal(ui.badges.at(-1),'OFF');
  w.disconnect();assert.equal(ui.badges.at(-1),'OFF');
  w.changeSettings({enabled:true});await flush();assert.equal(ui.badges.at(-1),'ON');
});

test('an old successful probe cannot mark a disabled opt-in session connected',async()=>{
  const gate=deferred();let ui;
  const w=worker(true,undefined,{inspect(value){ui=value;},async statusResponse(){await gate.promise;return {json:async()=>({ok:true})};}});
  await flush();w.changeSettings({enabled:false});gate.resolve();await flush();
  assert.equal(ui.badges.at(-1),'OFF');assert.equal((await ui.status()).state,'disabled');
  const count=ui.probes.length;
  assert.equal(ui.message({type:'BRIDGE_STATUS'},{id:'extension-id',tab:{id:1}},()=>assert.fail('Content scripts cannot probe')),undefined);
  await flush();assert.equal(ui.probes.length,count);
});

test('both tab and popup options can read status while content scripts and other extensions cannot',async()=>{
  let ui;worker(true,undefined,{inspect(value){ui=value;}});await flush();
  for(const tab of [undefined,{id:42}]) {
    const reply=await new Promise(resolve=>{
      const keepAlive=ui.message({type:'BRIDGE_STATUS'},{id:'extension-id',url:'chrome-extension://extension-id/options.html?view=settings#connection',tab},resolve);
      assert.equal(keepAlive,true,'a trusted options tab must receive a response');
    });
    assert.equal(reply.state,'connected');
  }
  const before=ui.probes.length;
  for(const sender of [
    {id:'extension-id',url:'https://site.test/options.html',tab:{id:1}},
    {id:'extension-id',url:'https://site.test/',tab:undefined},
    {id:'other-extension',url:'chrome-extension://extension-id/options.html'},
    {id:'extension-id',url:'chrome-extension://other-extension/options.html'},
    {id:'extension-id',url:'chrome-extension://extension-id/options.html/forged'},
    {id:'extension-id'}
  ]) assert.equal(ui.message({type:'BRIDGE_STATUS'},sender,()=>assert.fail('untrusted sender')),undefined);
  await flush();assert.equal(ui.probes.length,before);
});
test("MV3 worker uses trusted storage, routes per document, and resumes from stored opt-in after restart",async()=>{
  for(let i=0;i<2;i++){
    const w=worker();w.send({title:"Track",artwork_candidates:[null,{src:1}]},2);await settle();
    assert.equal(w.access(),"TRUSTED_CONTEXTS");assert.equal(w.requests.length,2);
    const body=JSON.parse(w.requests[0].options.body);assert.equal(body.frame_id,2);assert.equal(body.document_id,"doc-2");assert.equal(body.media.page_url,"https://site.test/frame-2");
    assert.equal(w.commands[0].options.documentId,"doc-2");assert.equal(JSON.stringify(w.commands).includes("a".repeat(64)),false);
  }
});
test("disabled extension sends neither metadata nor artwork requests",async()=>{
  const w=worker(false);w.send({title:"Track",artwork_candidates:[{src:"https://cdn.test/a.png"}],favicon_candidates:[{src:"https://cdn.test/favicon.ico"}]});await settle();assert.equal(w.requests.length,0);assert.equal(w.images.length,0);
});

test('empty observations clear media without exposing browsing details in either protocol',async()=>{
  for(const protocol2 of [false,true]) {
    const wire=new ChromeWire(),decoded=[];
    const w=worker(true,undefined,{protocol2,async bridgeResponse(url,body){
      if(!url.endsWith('/result')) decoded.push(protocol2?wire.decode(body).media:body.media);
      return {json:async()=>({ok:true,commands:[]})};
    }});
    await flush();
    w.send({title:'Track',artist:'Artist'});await settle();
    assert.equal(decoded.at(-1).page_title,'Tab');
    const previousImages=w.images.length;
    w.send({title:'',page_url:'https://private.test/',page_title:'Private',extra:'Private',artwork_candidates:[{src:'https://cdn.test/private.png'}]});await settle();
    const cleared=decoded.at(-1);
    assert.equal(cleared.title,'');
    assert.equal(cleared.page_url,'');assert.equal(cleared.page_title,'');
    assert.ok(cleared.artist==null);assert.ok(cleared.extra==null);
    assert.ok(cleared.artwork_data_url==null);
    assert.equal(JSON.stringify(cleared).includes('private'),false);
    assert.equal(w.images.length,previousImages);
  }
});

test('settings changes discard commands returned to an earlier opt-in session',async()=>{
 for(const change of ['disable','disable-enable']) {
  const gate=deferred();
  const w=worker(true,undefined,{async bridgeResponse(url,body){
   if(url.endsWith('/result')) return {ok:true,json:async()=>({})};
   await gate.promise;
   return {ok:true,json:async()=>({commands:[{id:'old',title:'Track',command:'play-pause',tab_id:body.tab_id,frame_id:body.frame_id,document_id:body.document_id}]})};
  }});
  w.send({title:'Track'});await flush();assert.equal(w.requests.length,1);
  if(change.startsWith('token')) {w.changeSettings({token:'b'.repeat(64)});if(change==='token-restore') w.changeSettings({token:'a'.repeat(64)});}
  else {w.changeSettings({enabled:false});if(change==='disable-enable') w.changeSettings({enabled:true});}
  gate.resolve();await flush();
  assert.equal(w.commands.length,0,change);
  assert.equal(w.requests.length,1,change);
  if(change==='disable') w.changeSettings({enabled:true});
  w.send({title:'Track'});await flush();
  assert.equal(w.commands.length,1,`${change}: fresh samples resume`);
 }
});

test('disabling while one command runs prevents dispatch of later commands',async()=>{
 const gate=deferred();
 const w=worker(true,undefined,{
  async bridgeResponse(url){return {ok:true,json:async()=>({commands:url.endsWith('/result')?[]:[{id:'first',title:'Track',command:'play-pause'},{id:'second',title:'Track',command:'stop'}]})};},
  async sendMessage(){await gate.promise;return {ok:true};}
 });
 w.send({title:'Track'});await flush();assert.equal(w.commands.length,1);
 w.changeSettings({enabled:false});gate.resolve();await flush();
 assert.equal(w.commands.length,1);
});

test('worker normalizes ICO favicons, caches them separately, and ignores forged image fields',async()=>{
 const w=worker(true,()=>new Response(new Uint8Array([0,0,1,0]),{headers:{'content-type':'image/x-icon'}}));
 const media={title:'Track',favicon_candidates:[{src:'https://cdn.test/site.ico',sizes:'32x32'}],favicon_data_url:'forged',app_icon_data_url:'forged'};
 w.send(media);await settle();w.send(media);await settle();
 const payload=updates(w).at(-1).media;
 assert.match(payload.favicon_data_url,/^data:image\/png;base64,/);assert.equal(payload.app_icon_data_url,null);
 assert.equal(payload.artwork_data_url,undefined);assert.equal(w.images.length,1);
 assert.equal(w.images[0].options.credentials,'omit');assert.equal(w.images[0].options.redirect,'error');
 w.send({...media,title:'Next track'});await settle();assert.equal(w.images.length,1);
});

test('unsafe favicon URLs are skipped and the sender origin supplies favicon.ico',async()=>{
 const w=worker();w.send({title:'Track',favicon_candidates:[{src:'https://127.0.0.1/a.ico'},{src:'file:///secret.ico'}]});await settle();
 assert.deepEqual(w.images.map(x=>x.url),['https://site.test/favicon.ico']);
 assert.equal(JSON.parse(w.requests[0].options.body).media.favicon_data_url,undefined);
});

test('unsafe URLs and unsupported declared formats do not displace usable artwork',async()=>{
 const w=worker(true,url=>url==='https://cdn.test/album.png'
  ?new Response(new Uint8Array([137,80,78,71]),{headers:{'content-type':'image/png'}})
  :{ok:false,headers:new Headers()});
 const media={title:'Track',artwork_candidates:[
  {src:'https://127.0.0.1/private.png',sizes:'2048x2048'},
  {src:'https://cdn.test/album.svg',sizes:'1024x1024',type:'image/svg+xml'},
  {src:'https://user:secret@cdn.test/private.png',sizes:'512x512'},
  {src:'https://cdn.test/album.png',sizes:'128x128',type:'image/png'}
 ]};w.send(media);await settle();w.send(media);await settle();
 assert.deepEqual(w.images.map(x=>x.url),['https://cdn.test/album.png','https://site.test/favicon.ico']);
 assert.match(updates(w).at(-1).media.artwork_data_url,/^data:image\/png;base64,/);
});

test('rejected image downloads stop before trying the next candidate',async()=>{
 for(const protocol2 of [false,true]) for(const failure of ['http','mime','size','read']) {
  let rejectedSignal,abortedBeforeFallback;
  const w=worker(true,(url,options)=>{
   if(url==='https://cdn.test/rejected.png') {
    rejectedSignal=options.signal;
    return {ok:failure!=='http',headers:new Headers({
     'content-type':failure==='mime'?'text/html':'image/png',
     'content-length':failure==='size'?'350001':'1'
    }),body:{getReader(){return {async read(){throw Error('Connection interrupted');}};}}};
   }
   if(url==='https://cdn.test/fallback.png') {
    abortedBeforeFallback=rejectedSignal.aborted;
    return new Response(new Uint8Array([1]),{headers:{'content-type':'image/png'}});
   }
   return {ok:false,headers:new Headers()};
  },{protocol2});
  await flush();
  const media={title:'Track',artwork_candidates:[{src:'https://cdn.test/rejected.png'},{src:'https://cdn.test/fallback.png'}]};
  w.send(media);await settle();w.send(media);await settle();
  assert.equal(abortedBeforeFallback,true,`${protocol2}/${failure}: rejected response must release its network request`);
  if(protocol2) assert.ok(updates(w).some(update=>Object.values(update.images??{}).includes('data:image/png;base64,AQ==')));
  else assert.equal(updates(w).at(-1).media.artwork_data_url,'data:image/png;base64,AQ==');
 }
});

test('a full set of broken page icons still tries the conventional favicon within three requests',async()=>{
 const w=worker(true,url=>url==='https://site.test/favicon.ico'
  ?new Response(new Uint8Array([0,0,1,0]),{headers:{'content-type':'image/x-icon'}})
  :{ok:false,headers:new Headers()});
 const media={title:'Track',favicon_candidates:Array.from({length:16},(_,index)=>({src:`https://cdn.test/icon-${index}.png`,sizes:`${1024-index}x${1024-index}`}))};
 w.send(media);await settle();w.send(media);await settle();
 assert.deepEqual(w.images.map(x=>x.url),['https://cdn.test/icon-0.png','https://cdn.test/icon-1.png','https://site.test/favicon.ico']);
 assert.match(updates(w).at(-1).media.favicon_data_url,/^data:image\/png;base64,/);
});

test('duplicate image URLs consume only one candidate and one request',async()=>{
 const w=worker(true,url=>url==='https://cdn.test/working.png'
  ?new Response(new Uint8Array([0,0,1,0]),{headers:{'content-type':'image/png'}})
  :{ok:false,headers:new Headers()});
 const media={title:'Track',favicon_candidates:[
  ...Array.from({length:3},()=>({src:'https://cdn.test/broken.png',sizes:'512x512'})),
  {src:'https://cdn.test/working.png',sizes:'32x32'}
 ]};w.send(media);await settle();w.send(media);await settle();
 assert.deepEqual(w.images.map(x=>x.url),['https://cdn.test/broken.png','https://cdn.test/working.png']);
 assert.match(updates(w).at(-1).media.favicon_data_url,/^data:image\/png;base64,/);
});

test('pending artwork and favicon loads do not delay fresh metadata or commands',async()=>{
 const image=deferred();
 const w=worker(true,async()=>{await image.promise;return new Response(new Uint8Array([137,80,78,71]),{headers:{'content-type':'image/png'}});});
 const media={title:'Track',artwork_candidates:[{src:'https://cdn.test/album.png'}],favicon_candidates:[{src:'https://cdn.test/icon.png'}],timeline:{position_sec:10}};
 w.send(media);await flush();
 assert.equal(updates(w).length,1);assert.equal(w.commands.length,1);assert.equal(w.images.length,2);
 w.send({...media,timeline:{position_sec:20}});await flush();
 assert.equal(updates(w).at(-1).media.timeline.position_sec,20);assert.equal(w.commands.length,2);
 assert.equal(w.images.length,2,'in-flight image requests are shared across page samples');
 assert.equal(updates(w).at(-1).media.artwork_data_url,undefined);
 image.resolve();await flush();
 const completed=updates(w).at(-1).media;
 assert.equal(completed.timeline.position_sec,20,'image completion uses the latest sample');
 assert.match(completed.artwork_data_url,/^data:image\/png;base64,/);
 assert.match(completed.favicon_data_url,/^data:image\/png;base64,/);
 w.send({...media,timeline:{position_sec:30}});await flush();
 const loaded=updates(w).at(-1).media;
 assert.equal(loaded.timeline.position_sec,30);
 assert.match(loaded.artwork_data_url,/^data:image\/png;base64,/);
 assert.match(loaded.favicon_data_url,/^data:image\/png;base64,/);
 w.send({...media,timeline:{position_sec:40}});await flush();
 assert.equal(updates(w).at(-1).media.artwork_data_url,loaded.artwork_data_url);
 assert.equal(updates(w).at(-1).media.favicon_data_url,loaded.favicon_data_url);
 assert.equal(w.images.length,2,'cached images remain visible without repeated downloads');
});

for(const protocol2 of [false,true]) {
 test(`artwork completion displays during playback without a pause or page sample in protocol ${protocol2?2:1}`,async()=>{
  const image=deferred(),wire=new ChromeWire(),received=[];
  const w=worker(true,url=>url.includes('/cover.png')?image.promise:Promise.resolve(new Response(null,{status:404})),{
   protocol2,async bridgeResponse(url,body){
    if(!url.endsWith('/result')) received.push(protocol2?wire.decode(body).media:body.media);
    return {json:async()=>({ok:true,commands:[]})};
   }
  });
  await flush();
  w.send({title:'YouTube video',playback_state:'playing',artwork_candidates:[{src:'https://cdn.test/cover.png'}],timeline:{position_sec:10,updated_at:10000}});
  await flush();assert.equal(received.at(-1).artwork_loading,true);
  // No pause, timeupdate, heartbeat or new page sample follows this download.
  image.resolve(new Response(new Uint8Array([1]),{headers:{'content-type':'image/png'}}));await settle();
  const latest=received.at(-1);
  assert.equal(latest.artwork_data_url,'data:image/png;base64,AQ==');
  assert.equal(latest.artwork_loading,false);
  assert.equal(latest.playback_state,'playing');
  assert.deepEqual(latest.timeline,{position_sec:10,updated_at:10000},'original timestamp prevents rewinding playback');
 });

 test(`late artwork does not revive an expired page sample in protocol ${protocol2?2:1}`,async()=>{
  let now=10000;const image=deferred();
  const w=worker(true,url=>url.includes('/cover.png')?image.promise:Promise.resolve(new Response(null,{status:404})),{protocol2,now:()=>now});
  await flush();w.send({title:'Old video',artwork_candidates:[{src:'https://cdn.test/cover.png'}]});await flush();
  const before=updates(w).length;now+=15000;
  image.resolve(new Response(new Uint8Array([1]),{headers:{'content-type':'image/png'}}));await settle();
  assert.equal(updates(w).length,before);
 });

 test(`image completion cannot replay an old track over a processing navigation in protocol ${protocol2?2:1}`,async()=>{
  const image=deferred(),settings=deferred(),wire=new ChromeWire(),received=[];let blockRead=false;
  const w=worker(true,url=>url.endsWith('/old.png')?image.promise:Promise.resolve(new Response(new Uint8Array([2]),{headers:{'content-type':'image/png'}})),{
   protocol2,readSettings(){if(blockRead) {blockRead=false;return settings.promise;}},
   async bridgeResponse(url,body){
    if(!url.endsWith('/result')) received.push({document:body.document_id,media:protocol2?wire.decode(body).media:body.media});
    return {json:async()=>({ok:true,commands:[]})};
   }
  });
  await flush();w.send({title:'Old',artwork_candidates:[{src:'https://cdn.test/old.png'}]},0,4,'old-document');await settle();
  blockRead=true;
  w.send({title:'New',artwork_candidates:[{src:'https://cdn.test/new.png'}]},0,4,'new-document');await flush();
  image.resolve(new Response(new Uint8Array([1]),{headers:{'content-type':'image/png'}}));await flush();
  const before=received.length;
  settings.resolve();await settle();
  assert.ok(received.length>before);
  assert.ok(received.slice(before).every(update=>update.document==='new-document'&&update.media.title==='New'));
  assert.equal(received.at(-1).media.artwork_data_url,'data:image/png;base64,Ag==');
 });
}

test('artwork tries the smallest image sufficient for an Edge cover before oversized originals',async()=>{
 const w=worker(true,url=>url.endsWith('/768.png')
  ?new Response(new Uint8Array([1]),{headers:{'content-type':'image/png'}})
  :new Response(null,{status:404}),{protocol2:true});
 await flush();
 w.send({title:'Video',artwork_candidates:[1024,512,192,768,2048].map(size=>({src:`https://cdn.test/${size}.png`,sizes:`${size}x${size}`}))});await settle();
 assert.deepEqual(w.images.filter(x=>x.url.startsWith('https://cdn.test/')).map(x=>x.url),['https://cdn.test/768.png']);
});

test('artwork uses the largest available thumbnail when all images are smaller than Edge covers',async()=>{
 const w=worker(true,()=>new Response(new Uint8Array([1]),{headers:{'content-type':'image/png'}}));
 w.send({title:'Video',artwork_candidates:[192,512,384].map(size=>({src:`https://cdn.test/${size}.png`,sizes:`${size}x${size}`}))});await settle();
 assert.equal(w.images[0].url,'https://cdn.test/512.png');
});

test('artwork retains smaller and unspecified candidates when no sufficient thumbnail exists',async()=>{
 const w=worker(true,url=>url.endsWith('/unspecified.png')
  ?new Response(new Uint8Array([1]),{headers:{'content-type':'image/png'}})
  :new Response(null,{status:404}),{protocol2:true});
 await flush();
 w.send({title:'Video',artwork_candidates:[{src:'https://cdn.test/64.png',sizes:'64x64'},{src:'https://cdn.test/unspecified.png'},{src:'https://cdn.test/128.png',sizes:'128x128'}]});await settle();
 assert.deepEqual(w.images.filter(x=>x.url.startsWith('https://cdn.test/')).map(x=>x.url),['https://cdn.test/128.png','https://cdn.test/64.png','https://cdn.test/unspecified.png']);
});

test('old document image completion cannot replace the new track artwork',async()=>{
 const oldImage=deferred();
 const w=worker(true,async url=>{
  if(url==='https://cdn.test/old.png') await oldImage.promise;
  return new Response(new Uint8Array([url==='https://cdn.test/old.png'?1:2]),{headers:{'content-type':'image/png'}});
 });
 w.send({title:'Old',artwork_candidates:[{src:'https://cdn.test/old.png'}]},0,4,'old-document');await flush();
 const fresh={title:'New',artwork_candidates:[{src:'https://cdn.test/new.png'}]};
 w.send(fresh,0,4,'new-document');await flush();
 assert.equal(w.images.find(x=>x.url.endsWith('/old.png')).options.signal.aborted,true);
 oldImage.resolve();await flush();
 w.send(fresh,0,4,'new-document');await flush();
 const latest=updates(w).at(-1);
 assert.equal(latest.document_id,'new-document');assert.equal(latest.media.title,'New');
 assert.equal(latest.media.artwork_data_url,'data:image/png;base64,Ag==');
 assert.equal(w.images.filter(x=>x.url.endsWith('/new.png')).length,1);
});

test('matching cached artwork stays visible during refresh and temporary failures',async()=>{
 let now=10000,mode='initial';const image=deferred();
 const w=worker(true,async url=>{
  if(url!=='https://cdn.test/album.png') return {ok:false,headers:new Headers()};
  if(mode==='refresh') {await image.promise;return {ok:false,headers:new Headers()};}
  return new Response(new Uint8Array([mode==='initial'?1:2]),{headers:{'content-type':'image/png'}});
 },{now:()=>now});
 const media={title:'Track',artwork_candidates:[{src:'https://cdn.test/album.png'}]};
 w.send(media);await flush();w.send(media);await flush();
 assert.equal(updates(w).at(-1).media.artwork_data_url,'data:image/png;base64,AQ==');
 now+=300001;mode='refresh';w.send(media);await flush();
 assert.equal(updates(w).at(-1).media.artwork_data_url,'data:image/png;base64,AQ==');
 w.send(media);await flush();assert.equal(w.images.filter(x=>x.url.endsWith('/album.png')).length,2);
 image.resolve();await flush();w.send(media);await flush();
 assert.equal(updates(w).at(-1).media.artwork_data_url,'data:image/png;base64,AQ==');
 now+=5001;mode='recovered';w.send(media);await flush();w.send(media);await flush();
 assert.equal(updates(w).at(-1).media.artwork_data_url,'data:image/png;base64,Ag==');
 assert.equal(w.images.filter(x=>x.url.endsWith('/album.png')).length,3);
});

test('disabling discards in-flight images even if they finish after re-enabling',async()=>{
 const image=deferred(),freshImage=deferred();let requests=0;
 const w=worker(true,async()=>{const fresh=++requests>2;await (fresh?freshImage:image).promise;return new Response(new Uint8Array([fresh?2:1]),{headers:{'content-type':'image/png'}});});
 const media={title:'Track',artwork_candidates:[{src:'https://cdn.test/album.png'}]};
 w.send(media);await flush();assert.equal(w.images.length,2);
 w.changeSettings({enabled:false});
 assert.ok(w.images.every(request=>request.options.signal.aborted));
 w.changeSettings({enabled:true});image.resolve();await flush();
 assert.equal(updates(w).length,1);
 w.send(media);await flush();
 assert.equal(updates(w).at(-1).media.artwork_data_url,undefined,'previous opt-in images are not revived');
 assert.equal(w.images.length,4,'a fresh opt-in reloads images');
 freshImage.resolve();await flush();
 assert.equal(updates(w).at(-1).media.artwork_data_url,'data:image/png;base64,Ag==');
});

test('slow images stay bounded while all frames continue metadata and command polling',async()=>{
 const image=deferred();
 const w=worker(true,()=>image.promise);
 for(let frame=0;frame<12;frame++) w.send({title:'Track',artwork_candidates:[{src:`https://cdn.test/${frame}.png`}]},frame);
 await flush();
 assert.equal(updates(w).length,12);assert.equal(w.commands.length,12);
 assert.equal(w.images.length,8,'image concurrency is bounded separately from metadata');
 w.remove(4);image.resolve({ok:false,headers:new Headers()});await flush();
 assert.equal(w.images.length,8,'closed tabs discard queued images');
});

test('queued ninth frame drains after a slot opens without another update',async()=>{
 const gate=deferred();
 const w=worker(true,undefined,{async bridgeResponse(){await gate.promise;return {ok:true,json:async()=>({commands:[]})};}});
 for(let frame=0;frame<9;frame++) w.send({title:`Track ${frame}`},frame);
 await flush();assert.equal(w.requests.length,8);
 gate.resolve();await flush();
 assert.equal(w.requests.length,9);
 assert.equal(JSON.parse(w.requests.at(-1).options.body).frame_id,8);
});

test('completed frames release their slots before the frame limit is reached',async()=>{
 const w=worker(true,undefined,{bridgeResponse:async()=>({ok:true,json:async()=>({commands:[]})})});
 for(let frame=0;frame<300;frame++) {w.send({title:`Track ${frame}`},frame);await flush();}
 assert.equal(w.requests.length,300);
 assert.equal(JSON.parse(w.requests.at(-1).options.body).frame_id,299);
});

test('closed tabs cancel queued and coalesced samples and skip returned commands',async()=>{
 const gate=deferred();
 const w=worker(true,undefined,{async bridgeResponse(_url,body){await gate.promise;return {ok:true,json:async()=>({commands:[{id:'closed',title:'Track',command:'play-pause',tab_id:body.tab_id,frame_id:body.frame_id}]})};}});
 for(let frame=0;frame<9;frame++) w.send({title:'Track'},frame);
 await flush();assert.equal(w.requests.length,8);
 w.send({title:'Later sample'},0);
 w.remove(4);
 gate.resolve();await flush();
 assert.equal(mediaUpdates(w).length,8);
 assert.equal(updates(w).filter(body=>body.media===null).length,8);
 assert.equal(w.commands.length,0);
 w.send({title:'Other tab'},0,5);await flush();
 assert.equal(mediaUpdates(w).length,9);
 assert.equal(mediaUpdates(w).at(-1).tab_id,5);
});

test('closing a tab aborts image loads and prevents queued fallback requests',async()=>{
 const image=deferred();
 const w=worker(true,()=>image.promise);
 w.send({title:'Track',artwork_candidates:[{src:'https://cdn.test/art.png'},{src:'https://cdn.test/fallback.png'}]});
 await flush();assert.equal(w.images.length,2);assert.equal(updates(w).length,1);
 w.remove(4);
 assert.ok(w.images.every(image=>image.options.signal.aborted));
 image.resolve({ok:false,headers:new Headers()});await flush();
 assert.equal(w.images.length,2);
 assert.equal(mediaUpdates(w).length,1);
 assert.equal(updates(w).filter(body=>body.media===null).length,1);
});

test('busy frames coalesce samples and yield to an already queued frame',async()=>{
 const gates=Array.from({length:9},deferred),order=[];
 const w=worker(true,undefined,{async bridgeResponse(_url,body){order.push({frame:body.frame_id,title:body.media.title});if(body.media.title==='First') await gates[body.frame_id].promise;return {ok:true,json:async()=>({commands:[]})};}});
 for(let frame=0;frame<9;frame++) w.send({title:'First'},frame);
 await flush();
 w.send({title:'Superseded'},0);w.send({title:'Latest'},0);
 gates[0].resolve();await flush();
 assert.equal(order.length,9);
 assert.deepEqual(order.at(-1),{frame:8,title:'First'});
 for(const gate of gates) gate.resolve();await flush();
 assert.equal(order.length,10);
 assert.deepEqual(order.slice(8),[{frame:8,title:'First'},{frame:0,title:'Latest'}]);
});

test('native host disconnect rejects pending work and reconnects on the next update',async()=>{
 const gate=deferred();let first=true;
 const w=worker(true,undefined,{async bridgeResponse(){if(first){first=false;await gate.promise;}return {json:async()=>({commands:[]})};}});
 w.send({title:'Track'});await flush();assert.equal(w.connections(),1);
 w.disconnect();await flush();w.send({title:'Track'});await flush();assert.equal(w.connections(),2);
 gate.resolve();await flush();assert.equal(w.commands.length,0);
});

test('v2 transfers image content once, coalesces URL downloads, and delivers commands while metadata is blocked',async()=>{
  const wire=new ChromeWire(),received=[],gate=deferred();let block=false,ui;
  const w=worker(true,async url=>new Response(new Uint8Array([1]),{headers:{'content-type':'image/png'}}),{
    protocol2:true,inspect(value){ui=value;},async bridgeResponse(url,body){
      if(url.endsWith('/result')) return {json:async()=>({ok:true})};
      if(block) await gate.promise;
      const result=wire.decode(body);if(result.media) received.push(result.media);
      return {json:async()=>({ok:!result.resync&&!result.missing,...(result.resync?{resync:true,epoch:'epoch-1'}:{}),...(result.missing?{missing:result.missing}:{}),commands:[]})};
    }
  });
  await flush();
  const media={title:'Track',artist:'Artist',artwork_candidates:[{src:'https://cdn.test/shared.png'}],timeline:{position_sec:10,updated_at:10000}};
  w.send(media);await settle();w.send(media,1);await settle();
  assert.equal(w.images.filter(x=>x.url.endsWith('/shared.png')).length,1,'same URL is shared across frames');
  const transfers=updates(w).flatMap(body=>Object.values(body.images??{}));
  assert.equal(transfers.filter(x=>x==='data:image/png;base64,AQ==').length,1,'content-identical images cross Native Messaging/HTTP once');
  assert.equal(received.at(-1).artwork_data_url,'data:image/png;base64,AQ==');
  const before=updates(w).length;w.send(media,1);await settle();assert.equal(updates(w).length,before,'unchanged state is not resent');
  block=true;w.send({...media,title:'Next'},1);await flush();
  const started=performance.now();ui.event({event:'command',command:{id:'pushed',tab_id:4,frame_id:1,document_id:'doc-1',title:'Next',target_id:'media-1',command:'seek',position:20}});
  await flush();assert.equal(w.commands.at(-1).message.command.id,'pushed');assert.ok(performance.now()-started<250,'command bypasses pending metadata');
  gate.resolve();await settle();
});

test('v2 restores full state and image references after plugin restart and lost receiver caches',async()=>{
  let ui,epoch='epoch-1';const wire=new ChromeWire(),decoded=[];
  const w=worker(true,async()=>new Response(new Uint8Array([2]),{headers:{'content-type':'image/png'}}),{protocol2:true,inspect(value){ui=value;},async bridgeResponse(url,body){
    if(url.endsWith('/result')) return {json:async()=>({ok:true})};
    const result=wire.decode(body);if(result.media) decoded.push(result.media);
    return {json:async()=>({ok:!result.resync&&!result.missing,epoch,...(result.resync?{resync:true}:{}),...(result.missing?{missing:result.missing}:{}),commands:[]})};
  }});
  await flush();const media={title:'Track',artwork_candidates:[{src:'https://cdn.test/a.png'}]};w.send(media);await settle();
  wire.clear();epoch='epoch-2';ui.event({event:'disconnected'});ui.event({event:'ready',epoch});await settle();
  assert.equal(decoded.at(-1).title,'Track');assert.equal(decoded.at(-1).artwork_data_url,'data:image/png;base64,Ag==');
  wire.clear();w.send({...media,title:'Changed'});await settle();
  assert.equal(decoded.at(-1).title,'Changed');assert.equal(decoded.at(-1).artwork_data_url,'data:image/png;base64,Ag==');
  const probes=ui.probes.length;ui.event({event:'heartbeat'});ui.pulse();await flush();assert.equal(ui.probes.length,probes,'stream traffic replaces status probes');
  w.changeSettings({enabled:false});ui.event({event:'command',command:{id:'disabled',tab_id:4,frame_id:0,document_id:'doc-0'}});await flush();assert.equal(w.commands.length,0);
});

test('v2 empty pages never download images, and simultaneous frames share a single content transfer',async()=>{
  const w=worker(true,async()=>new Response(new Uint8Array([1]),{headers:{'content-type':'image/png'}}),{protocol2:true});await flush();
  w.send({title:''});await settle();assert.equal(w.images.length,0);
  const media={title:'Track',artwork_candidates:[{src:'https://cdn.test/shared.png'}]};
  w.send(media,0);w.send(media,1);await settle();await settle();
  const data=updates(w).flatMap(body=>Object.values(body.images??{}));
  assert.equal(data.filter(x=>x==='data:image/png;base64,AQ==').length,1);
});

test('pushed commands remain serial per document and an interrupted opt-in cannot run queued commands',async()=>{
  let ui;const gate=deferred();
  const w=worker(true,undefined,{protocol2:true,inspect(value){ui=value;},async sendMessage(){await gate.promise;return {ok:true};}});await flush();
  const command=id=>({event:'command',command:{id,tab_id:4,frame_id:0,document_id:'doc',command:'play-pause',target_id:'media-1'}});
  ui.event(command('first'));ui.event(command('queued'));await flush();assert.equal(w.commands.length,1);
  w.changeSettings({enabled:false});w.changeSettings({enabled:true});gate.resolve();await flush();assert.equal(w.commands.length,1);
});

test('polling fallback and later pushed commands preserve order behind an in-flight pushed command',async()=>{
  let ui;const gate=deferred();
  const command=id=>({id,tab_id:4,frame_id:0,document_id:'doc-0',title:'Track',target_id:'media-1',command:'play-pause'});
  const w=worker(true,undefined,{
    protocol2:true,inspect(value){ui=value;},
    async sendMessage(_tab,{command:c}){if(c.id==='first') await gate.promise;return {ok:true};},
    async bridgeResponse(url){return {json:async()=>({ok:true,commands:url.endsWith('/result')?[]:[command('second'),command('third')]})};}
  });await flush();
  ui.event({event:'command',command:command('first')});await flush();
  ui.event({event:'disconnected'});w.send({title:'Track'});await flush();
  ui.event({event:'command',command:command('fourth')});await flush();
  assert.deepEqual(w.commands.map(x=>x.message.command.id),['first'],'fallback must wait for the already running command');
  gate.resolve();await flush();
  assert.deepEqual(w.commands.map(x=>x.message.command.id),['first','second','third','fourth'],'an entire polling batch precedes later pushes');
  assert.deepEqual(w.requests.filter(x=>x.url.endsWith('/result')).map(x=>JSON.parse(x.options.body).id),['first','second','third','fourth']);
});

test('a pushed command waits for an in-flight polling command in the same document',async()=>{
  let ui;const gate=deferred();
  const command=id=>({id,tab_id:4,frame_id:0,document_id:'doc-0',title:'Track',target_id:'media-1',command:'play-pause'});
  const w=worker(true,undefined,{
    protocol2:true,inspect(value){ui=value;},
    async sendMessage(_tab,{command:c}){if(c.id==='polled') await gate.promise;return {ok:true};},
    async bridgeResponse(url){return {json:async()=>({ok:true,commands:url.endsWith('/result')?[]:[command('polled')]})};}
  });await flush();
  w.send({title:'Track'});await flush();
  ui.event({event:'command',command:command('pushed')});await flush();
  assert.deepEqual(w.commands.map(x=>x.message.command.id),['polled']);
  gate.resolve();await flush();
  assert.deepEqual(w.commands.map(x=>x.message.command.id),['polled','pushed']);
});

test('queued polling fallback is discarded when its tab closes or its opt-in generation changes',async()=>{
  for(const change of ['close','disable-enable']) {
    let ui;const gate=deferred();
    const command=id=>({id,tab_id:4,frame_id:0,document_id:'doc-0',title:'Track',target_id:'media-1',command:'play-pause'});
    const w=worker(true,undefined,{
      protocol2:true,inspect(value){ui=value;},
      async sendMessage(_tab,{command:c}){if(c.id==='first') await gate.promise;return {ok:true};},
      async bridgeResponse(url){return {json:async()=>({ok:true,commands:url.endsWith('/result')?[]:[command('queued')]})};}
    });await flush();
    ui.event({event:'command',command:command('first')});await flush();
    w.send({title:'Track'});await flush();
    assert.deepEqual(w.commands.map(x=>x.message.command.id),['first']);
    if(change==='close') w.remove(4);
    else {w.changeSettings({enabled:false});w.changeSettings({enabled:true});}
    gate.resolve();await flush();
    assert.deepEqual(w.commands.map(x=>x.message.command.id),['first'],change);
  }
});

test('new plugin with an old installed host falls back to full updates without advertising slow polling',async()=>{
  let ui;const w=worker(true,undefined,{protocol2:true,failStream:true,inspect(value){ui=value;}});await flush();
  let capability;ui.message({type:'MEDIA_UPDATE',media:{title:'Track'}},{tab:{id:4,title:'Tab'},frameId:0,documentId:'doc',url:'https://site.test/'},value=>{capability=value;});
  await flush();assert.equal(capability.protocol,1);assert.equal(updates(w).at(-1).protocol,undefined);
});

test('idle stream challenges require Chrome acknowledgement and cannot override disabled sending',async()=>{
  let now=10000,ui;const w=worker(true,undefined,{protocol2:true,now:()=>now,inspect(value){ui=value;}});await flush();
  const initial=ui.probes.length;ui.event({event:'heartbeat'});await flush();assert.equal(ui.probes.length,initial);
  now+=6000;ui.event({event:'heartbeat'});await flush();assert.equal(ui.probes.length,initial+1);
  ui.event({event:'heartbeat'});await flush();assert.equal(ui.probes.length,initial+1);
  w.changeSettings({enabled:false});await flush();ui.event({event:'disconnected'});assert.equal(ui.badges.at(-1),'OFF');
});

test('track changes revalidate mutable artwork URLs while content identity still deduplicates transfers',async()=>{
  let value=1;const wire=new ChromeWire(),received=[];
  const w=worker(true,async()=>new Response(new Uint8Array([value]),{headers:{'content-type':'image/png'}}),{protocol2:true,async bridgeResponse(url,body){
    if(url.endsWith('/result')) return {json:async()=>({ok:true})};
    const decoded=wire.decode(body);if(decoded.media) received.push(decoded.media);return {json:async()=>({ok:true,commands:[]})};
  }});await flush();
  const media={title:'First',artwork_candidates:[{src:'https://cdn.test/current.png'}]};
  w.send(media);await settle();assert.equal(received.at(-1).artwork_data_url,'data:image/png;base64,AQ==');
  value=2;w.send({...media,title:'Second'});await settle();assert.equal(received.at(-1).artwork_data_url,'data:image/png;base64,Ag==');
  w.send({...media,title:'Third'});await settle();
  const transferred=updates(w).flatMap(body=>Object.values(body.images??{}));
  assert.equal(transferred.filter(data=>data==='data:image/png;base64,Ag==').length,1,'new track with unchanged bytes does not retransmit image content');
});

test('popup subscription authenticates the extension page and pushes state changes',async()=>{
  let ui;const w=worker(true,undefined,{protocol2:true,inspect(value){ui=value;}});await flush();
  const replies=[];let incoming,closed=false;
  const port={name:'bridge-status',sender:{id:'extension-id',url:'chrome-extension://extension-id/options.html'},onMessage:{addListener(fn){incoming=fn;}},onDisconnect:{addListener(){}},postMessage(value){replies.push(value);},disconnect(){closed=true;}};
  ui.connect(port);assert.equal(replies.at(-1).state,'connected');
  w.changeSettings({enabled:false});await flush();assert.equal(replies.at(-1).state,'disabled');
  incoming({type:'status'});assert.equal(replies.at(-1).state,'disabled');assert.equal(closed,false);
  ui.connect({...port,sender:{id:'extension-id',url:'https://site.test/'}});assert.equal(closed,true);
});

test('profile identity is shared across concurrent requests and survives worker and host restarts',async()=>{
  const w=worker();w.send({title:'Track'},0);w.send({title:'Other track'},1);await flush();
  const id=w.settings.bridgeClientId;
  assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.equal(w.storageWrites.length,1,'concurrent first requests persist only one profile identity');
  assert.ok(w.nativeMessages.length>=3);
  assert.ok(w.nativeMessages.every(message=>message.body.client_id===id));
  w.disconnect();w.send({title:'After host restart'});await flush();
  assert.equal(w.connections(),2);
  assert.equal(w.nativeMessages.at(-1).body.client_id,id);
  const restarted=worker(true,undefined,{settings:w.settings});await flush();
  assert.equal(restarted.storageWrites.length,0);
  assert.equal(restarted.nativeMessages[0].body.client_id,id);
  const other=worker();await flush();
  assert.notEqual(other.settings.bridgeClientId,id,'another profile has a distinct namespace');
});

test('disabled sending creates no identity and a failed identity save retries without sending',async()=>{
  const disabled=worker(false);await flush();
  assert.equal(disabled.storageWrites.length,0);assert.equal(disabled.connections(),0);
  disabled.changeSettings({enabled:true});await flush();
  assert.equal(disabled.storageWrites.length,1);assert.equal(disabled.connections(),1);
  let ui,attempts=0;
  const w=worker(true,undefined,{inspect(value){ui=value;},async saveSettings(){if(++attempts===1) throw Error('Storage temporarily unavailable');}});
  await flush();
  assert.equal(ui.badges.at(-1),'!');assert.equal(w.connections(),0);
  assert.equal(w.settings.bridgeClientId,undefined);assert.equal(w.nativeMessages.length,0);
  ui.pulse();await flush();
  assert.equal(attempts,2);assert.equal(ui.badges.at(-1),'ON');
  assert.equal(w.nativeMessages[0].body.client_id,w.settings.bridgeClientId);
  const invalid=worker(true,undefined,{settings:{enabled:true,bridgeClientId:'invalid'}});await flush();
  assert.equal(invalid.storageWrites.length,1);assert.notEqual(invalid.settings.bridgeClientId,'invalid');
});

test('disabling during identity initialization prevents the waiting request from sending',async()=>{
  const gate=deferred();
  const w=worker(true,undefined,{saveSettings:()=>gate.promise});
  await flush();assert.equal(w.storageWrites.length,1);
  w.changeSettings({enabled:false});gate.resolve();await flush();
  assert.equal(w.nativeMessages.length,0);assert.equal(w.connections(),0);
  w.changeSettings({enabled:true});await flush();
  assert.equal(w.connections(),1);assert.equal(w.storageWrites.length,1);
});

test('commands for a different profile cannot control an identically numbered tab',async()=>{
  let ui;const w=worker(true,undefined,{protocol2:true,inspect(value){ui=value;}});await flush();
  const command=(id,client_id)=>({event:'command',command:{id,client_id,tab_id:4,frame_id:0,document_id:'doc',command:'play-pause',target_id:'media-1'}});
  ui.event(command('other-profile','ffffffff-ffff-ffff-ffff-ffffffffffff'));
  ui.event(command('own-profile',w.settings.bridgeClientId));
  ui.event(command('old-server',undefined));
  await flush();
  assert.deepEqual(w.commands.map(value=>value.message.command.id),['own-profile','old-server']);
  const results=w.nativeMessages.filter(message=>message.path==='/result');
  assert.deepEqual(results.map(message=>message.body.id),['own-profile','old-server']);
  assert.ok(results.every(message=>message.body.client_id===w.settings.bridgeClientId));
});

test('artwork loading clears after a failed download without a new page sample',async()=>{
 const pending=deferred();
 const w=worker(true,url=>url.includes('cover')?pending.promise:Promise.resolve(new Response(null,{status:404})),{protocol2:true});
 await flush();
 w.send({title:'Track',artwork_candidates:[{src:'https://cdn.test/cover.png'}]});await settle();
 assert.equal(updates(w).at(-1).media.artwork_loading,true);
 pending.resolve(new Response(null,{status:404}));await settle();
 assert.equal(updates(w).at(-1).media.artwork_loading,false);
 w.send({title:'No cover',artwork_loading:true});await settle();
 assert.notEqual(updates(w).at(-1).media.artwork_loading,true);
});
