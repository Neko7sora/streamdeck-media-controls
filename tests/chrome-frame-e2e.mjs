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
  await context.route('https://media.test/**',route=>route.fulfill({
    contentType:'text/html',body:`<!doctype html><title>Frame fixture</title>
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
    }
  }
  // Cover the old one-second timer as well as the initial send.
  await page.waitForTimeout(1200);
  assert.deepEqual(errors,[],'no postMessage origin mismatch or other script errors');
  console.log('Frame origins: regular page/iframe metadata works; opaque HTTPS sandbox stays untouched without console errors.');
} finally {
  await context?.close();
  assert.equal(dirname(profile),resolve(tmpdir()));
  assert.ok(basename(profile).startsWith('media-bridge-frames-'));
  await rm(profile,{recursive:true,force:true});
}
