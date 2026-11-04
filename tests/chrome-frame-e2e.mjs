import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {chromium} from 'playwright';

// A disposable browser with routed fixtures; no real sites or native hosts.
const profile=await mkdtemp(join(tmpdir(),'media-bridge-frames-'));
let context;
try {
  const extension=resolve('chrome-extension');
  context=await chromium.launchPersistentContext(profile,{
    channel:'chromium',headless:true,
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]
  });
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  await worker.evaluate(()=>{
    chrome.runtime.connectNative=()=>{throw new Error('E2E: native host unavailable');};
  });
  const comparisons=await worker.evaluate(async()=>{
    async function sample(width,height,color,pattern=false,mirror=false,type='image/png') {
      const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');
      if(mirror) {ctx.translate(width,0);ctx.scale(-1,1);}
      ctx.fillStyle=color;ctx.fillRect(0,0,width,height);
      if(pattern) {
        ctx.fillStyle='#cc3311';ctx.fillRect(width*0.1,height*0.2,width*0.25,height*0.3);
        ctx.fillStyle='#228822';ctx.fillRect(width*0.6,height*0.1,width*0.2,height*0.7);
      }
      return artworkSample(await canvas.convertToBlob({type,quality:0.5}));
    }
    const media=await sample(160,90,'#246688'),pattern=await sample(160,90,'#246688',true);
    return {
      matchingLarger:artworkUpgrade(media,await sample(320,180,'#246688')),
      differentLarger:artworkUpgrade(media,await sample(320,180,'#bb4422')),
      matchingEqual:artworkUpgrade(media,await sample(160,90,'#246688')),
      matchingSmaller:artworkUpgrade(media,await sample(80,45,'#246688')),
      matchingPattern:artworkUpgrade(pattern,await sample(320,180,'#246688',true)),
      matchingCompressed:artworkUpgrade(pattern,await sample(320,180,'#246688',true,false,'image/jpeg')),
      mirroredPattern:artworkUpgrade(pattern,await sample(320,180,'#246688',true,true))
    };
  });
  assert.deepEqual(comparisons,{matchingLarger:true,differentLarger:false,matchingEqual:false,matchingSmaller:false,
    matchingPattern:true,matchingCompressed:true,mirroredPattern:false});
  await context.route('https://media.test/**',route=>route.fulfill({
    contentType:'text/html',body:`<!doctype html><head><title>Frame fixture</title>
      <meta property="og:title" content="Fixture track">
      <meta property="og:url" content="${route.request().url()}">
      <meta property="og:image" content="/cover.jpg">
      <meta property="og:image:width" content="1280">
      <meta property="og:image:height" content="720">
      </head><body><video src="data:video/mp4;base64,"></video>
      <script>
        window.bridgeMessages=[];window.bridgeTransports=[];
        window.addEventListener('message',event=>{
          if(event.source===window&&event.data?.kind==='__streamdeck_media_metadata_v1__')
            bridgeMessages.push({origin:event.origin,media:event.data.media});
          if(event.source===window&&event.data?.kind==='__streamdeck_media_metadata_v1___transport')
            bridgeTransports.push(event.origin);
        });
        navigator.mediaSession.metadata=new MediaMetadata({title:'Fixture track'});
        document.dispatchEvent(new Event('play'));
      </script>
      ${new URL(route.request().url()).pathname==='/'?`
        <iframe src="/regular"></iframe>
        <iframe sandbox="allow-scripts" src="/sandbox"></iframe>`:''}`
  }));
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
  await page.goto('https://media.test/');
  for(const path of ['/','/regular','/sandbox']) {
    const frame=page.frames().find(frame=>frame.url()===`https://media.test${path}`);
    assert.ok(frame,`${path}: fixture loaded`);
    if(path==='/sandbox') {
      assert.deepEqual(await frame.evaluate(()=>({
        origin:window.origin,urlOrigin:location.origin,
        wrapped:Object.hasOwn(navigator.mediaSession,'setPositionState'),
        messages:bridgeMessages.length,transports:bridgeTransports.length
      })),{origin:'null',urlOrigin:'https://media.test',wrapped:false,messages:0,transports:0});
    } else {
      await frame.waitForFunction(()=>bridgeMessages.some(message=>message.media.title==='Fixture track'));
      await frame.waitForFunction(()=>bridgeTransports.length>0);
      assert.equal(await frame.evaluate(()=>Object.hasOwn(navigator.mediaSession,'setPositionState')),true);
      assert.equal(await frame.evaluate(()=>bridgeMessages.every(message=>message.origin===location.origin)),true);
      assert.equal(await frame.evaluate(()=>bridgeTransports.every(origin=>origin===location.origin)),true);
      const artwork=await frame.evaluate(()=>bridgeMessages.at(-1).media.artwork_candidates);
      assert.deepEqual(artwork,[{src:'https://media.test/cover.jpg',sizes:'1280x720',type:'',source:'opengraph'}]);
      await frame.evaluate(()=>{
        history.replaceState(null,'',location.pathname+'?track=next');
        document.dispatchEvent(new Event('play'));
      });
      await frame.waitForFunction(()=>bridgeMessages.at(-1).media.artwork_candidates.length===0);
      await frame.evaluate(()=>{
        document.querySelector('meta[property="og:url"]').content=location.href;
        document.querySelector('meta[property="og:image"]').content='/next-cover.jpg';
        document.dispatchEvent(new Event('play'));
      });
      await frame.waitForFunction(()=>bridgeMessages.at(-1).media.artwork_candidates[0]?.src==='https://media.test/next-cover.jpg');
    }
  }
  // Cover the old one-second timer as well as the initial send.
  await page.waitForTimeout(1200);
  assert.deepEqual(errors,[],'no postMessage origin mismatch or other script errors');
  console.log('Frame origins and OGP: regular page/iframe metadata and SPA artwork updates work; opaque HTTPS sandbox stays untouched without console errors.');
} finally {
  await context?.close();
  assert.equal(dirname(profile),resolve(tmpdir()));
  assert.ok(basename(profile).startsWith('media-bridge-frames-'));
  await rm(profile,{recursive:true,force:true});
}
