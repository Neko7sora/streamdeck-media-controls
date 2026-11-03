import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {load} from './load.mjs';
import {tls} from './tls-fixture.mjs';
import {icueBackend} from './icue-backend.mjs';
import {buildIcueHtml} from '../scripts/icue-widget-html.mjs';
const {startIcueServer} = await load('icue-server');
const token = 'd'.repeat(64), fixture = icueBackend();
fixture.windows.artwork_data_url = 'data:image/png;base64,' + (await readFile(new URL('../icue-widget/resources/icon.png',import.meta.url))).toString('base64');
fixture.backend.native = async command => {
  fixture.calls.push(command);
  if (command.command === 'volume') fixture.backend.audio(command.target).volume = command.value;
  if (command.command === 'mute') fixture.backend.audio(command.target).muted = !fixture.backend.audio(command.target).muted;
  if (command.command === 'play-pause') fixture.windows.playback_state = fixture.windows.playback_state === 'playing' ? 'paused' : 'playing';
  if (command.command === 'seek') {fixture.windows.timeline.position_sec = command.position; fixture.windows.timeline.updated_at = Date.now();}
  fixture.emit();
};
const server = startIcueServer(fixture.backend, {token,tls,port:0});
await once(server,'listening');
const testEndpoint = `https://127.0.0.1:${server.address().port}`;
const isolateBridge = context => context.route('https://127.0.0.1:39762/**',route=>
  route.continue({url:route.request().url().replace('https://127.0.0.1:39762',testEndpoint)}));
const browser = await chromium.launch({headless:true});
const output = new URL('.generated/',import.meta.url); await mkdir(output,{recursive:true});
const entry = new URL('../icue-widget/index.html',import.meta.url).href;
try {
  // Public test-only TLS identity. Production never disables TLS verification.
  const context = await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:840,height:344}});
  await isolateBridge(context);
  const errors = [], requests = [];
  context.on('page',page => page.on('pageerror',error => errors.push(error.message)));
  context.on('request',request => {if (/^https?:/.test(request.url())) requests.push(request.url());});
  await context.addInitScript(({token}) => {window.useBridge = true; window.bridgeToken = token; window.uniqueId = 'bridge-test'; window.iCUE = {isPreview:false};}, {token});
  const page = await context.newPage(); await page.goto(entry);
  await page.waitForFunction(() => document.getElementById('songName').textContent === 'Track A');
  const selectors = ['#songName','#artist','#album','#statusText','#bridgePanel','#mediaTarget','#audioTarget','#seekRange','#volumeRange',
    '#muteButton','#rewindButton','#stopButton','#forwardButton','#playPauseButton','#previousButton','#nextButton','#bridgeNotice'];
  const interactive = selectors.filter(s => /Target|Range|Button/.test(s));
  const sizes = [[840,344],[696,416],[840,696],[696,840],[1688,696],[696,1688],[2536,696],[696,2536]];
  async function geometry() {
    return page.locator(selectors.join(',')).evaluateAll(nodes => nodes.map(node => {
      const b = node.getBoundingClientRect(), style = getComputedStyle(node);
      return {id:'#'+node.id,x:b.x,y:b.y,w:b.width,h:b.height,font:parseFloat(style.fontSize)};
    }));
  }
  for (const [width,height] of sizes) {
    await page.setViewportSize({width,height});
    const device = await geometry();
    for (const box of device) {
      assert.ok(box.x >= -.5 && box.y >= -.5 && box.x+box.w <= width+.5 && box.y+box.h <= height+.5,
        `${width}x${height} clipped ${JSON.stringify(box)}`);
      if (interactive.includes(box.id)) assert.ok(box.w >= 47.5 && box.h >= 47.5,`${width}x${height}: touch target ${JSON.stringify(box)}`);
    }
    if ((width===840 && height===344) || (width===696 && height===840)) await page.screenshot({path:fileURLToPath(new URL(`icue-bridge-${width}x${height}.png`,output))});
    for (const scale of [.5,.25]) {
      await page.evaluate(() => {window.iCUE.isPreview = true; window.icueEvents.onDataUpdated();});
      await page.setViewportSize({width:width*scale,height:height*scale});
      const preview = await geometry();
      for (let i=0;i<device.length;i++) for (const key of ['x','y','w','h','font']) {
        assert.ok(Math.abs(preview[i][key]/scale-device[i][key]) < 1.5,`${width}x${height} preview ${device[i].id} ${key}: ${preview[i][key]/scale} vs ${device[i][key]}`);
      }
    }
    await page.evaluate(() => {window.iCUE.isPreview = false; window.icueEvents.onDataUpdated();});
    console.log(`OK extended iCUE controls, touch targets and preview scaling: ${width}x${height}`);
  }
  await page.setViewportSize({width:840,height:344});
  await page.locator('#playPauseButton').focus(); await page.keyboard.press('Space');
  await page.waitForFunction(() => document.getElementById('statusText').textContent === '一時停止');
  assert.notEqual(await page.locator('#playPauseButton').evaluate(node => getComputedStyle(node).outlineStyle),'none');
  await page.locator('#seekRange').focus();
  const seekResponse = page.waitForResponse(response => response.url().endsWith('/command'));
  await page.keyboard.press('ArrowRight'); assert.equal((await seekResponse).status(),200);
  assert.ok(fixture.calls.some(call => call.command === 'seek'));
  await page.locator('#audioTarget').selectOption(fixture.audio.id);
  await page.waitForFunction(() => document.getElementById('volumeRange').value === '25');
  // Live snapshots preserve the drag preview, including the accessible value.
  await page.locator('#volumeRange').dispatchEvent('pointerdown');
  await page.locator('#volumeRange').evaluate(node => {node.value='73';node.dispatchEvent(new Event('input'));});
  fixture.audio.volume = .31; fixture.emit();
  await page.waitForFunction(() => document.getElementById('volumeRange').value === '73' && document.getElementById('volumeText').textContent === '73%');
  // Wait for an observable change from this snapshot, not merely the local input event.
  fixture.audio.muted = true; fixture.emit();
  await page.waitForFunction(() => document.getElementById('muteButton').getAttribute('aria-pressed') === 'true');
  assert.equal(await page.locator('#volumeText').textContent(), '73%');
  assert.equal(await page.locator('#volumeRange').getAttribute('aria-valuetext'), '73%');
  await page.locator('#volumeRange').dispatchEvent('pointercancel');
  assert.equal(await page.locator('#volumeText').textContent(), '31%');
  fixture.audio.muted = false; fixture.emit();
  await page.waitForFunction(() => document.getElementById('muteButton').getAttribute('aria-pressed') === 'false');
  await page.locator('#volumeRange').focus();
  const volumeResponse = page.waitForResponse(response => response.url().endsWith('/command'));
  await page.keyboard.press('End'); assert.equal((await volumeResponse).status(),200);
  await page.waitForFunction(() => document.getElementById('volumeText').textContent === '100%');
  assert.ok(fixture.calls.some(call => call.command === 'volume' && call.target === fixture.audio.id && call.value === 1));
  await page.locator('#muteButton').click(); await page.waitForFunction(() => document.getElementById('muteButton').getAttribute('aria-pressed') === 'true');
  await page.locator('#mediaTarget').selectOption(fixture.chrome.session_id);
  await page.waitForFunction(() => document.getElementById('songName').textContent === 'Browser Track');
  assert.equal(await page.locator('#nextButton').isDisabled(),true);
  await page.locator('#rewindButton').click();
  await page.waitForTimeout(100);
  assert.ok(fixture.calls.some(call => call.source === 'chrome' && call.command === 'seek' && call.position === 10));
  // A track changes after a gesture begins. The receipt must keep the old target and be rejected.
  await page.locator('#seekRange').dispatchEvent('pointerdown');
  fixture.chrome.title = 'Replacement';
  const before = fixture.calls.length;
  await page.locator('#seekRange').evaluate(node => {node.value='25';node.dispatchEvent(new Event('input'));node.dispatchEvent(new Event('change'));});
  await page.waitForFunction(() => document.getElementById('bridgeNotice').textContent.includes('操作できませんでした'));
  assert.equal(fixture.calls.length,before);
  fixture.emit();
  await page.waitForFunction(() => document.getElementById('songName').textContent === 'Replacement');
  // Disconnect immediately disables both transport and extended controls, then recovers.
  server.closeAllConnections();
  await page.waitForFunction(() => document.getElementById('playPauseButton').disabled && document.getElementById('seekRange').disabled);
  await page.waitForFunction(() => document.getElementById('songName').textContent === 'Replacement');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.waitForTimeout(100); assert.equal(fixture.listeners.size,0);
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await page.waitForFunction(() => !document.getElementById('seekRange').disabled);
  // Incorrect/revoked credentials are recoverable and never fall back to iCUE's active player.
  await page.evaluate(() => {window.bridgeToken='e'.repeat(64);window.icueEvents.onDataUpdated();});
  await page.waitForFunction(() => document.getElementById('statusText').textContent.includes('トークンを確認'));
  assert.equal(await page.locator('#songName').textContent(), '接続トークンを確認してください');
  assert.equal(await page.locator('#volumeRange').getAttribute('aria-valuetext'), '音量不明');
  assert.equal(await page.locator('#seekRange').getAttribute('aria-valuetext'), '再生位置不明');
  assert.equal(await page.locator('#playPauseButton').isDisabled(),true);
  await page.evaluate(({token}) => {window.bridgeToken=token;window.icueEvents.onDataUpdated();},{token});
  await page.waitForFunction(() => !document.getElementById('playPauseButton').disabled);
  const selected = fixture.chrome.session_id;
  fixture.chrome.session_id = 'removed'; fixture.emit();
  await page.waitForFunction(() => document.getElementById('songName').textContent === '再生中の曲はありません');
  assert.equal(await page.locator('#mediaTarget').inputValue(),selected);
  assert.equal(await page.locator('#playPauseButton').isDisabled(),true);
  fixture.chrome.session_id = selected; fixture.emit();
  await page.waitForFunction(() => !document.getElementById('playPauseButton').disabled);
  const timeline = fixture.chrome.timeline;
  fixture.chrome.timeline = null; fixture.audio.volume = null; fixture.audio.muted = null; fixture.emit();
  await page.waitForFunction(() => document.getElementById('positionText').textContent === '--:-- / --:--');
  assert.equal(await page.locator('#seekRange').isDisabled(),true);
  assert.equal(await page.locator('#volumeRange').isDisabled(),true);
  assert.equal(await page.locator('#muteButton').isDisabled(),true);
  fixture.chrome.timeline = timeline;
  fixture.chrome.title = '<img src=https://example.com>長い曲名'.repeat(20); fixture.emit();
  await page.waitForFunction(() => document.getElementById('songName').dataset.overflow === 'true');
  assert.equal(await page.locator('#songName img').count(),0);
  assert.notEqual(await page.locator('#songTitleText').evaluate(node => getComputedStyle(node).animationName),'none');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('#songTitleText').evaluate(node => getComputedStyle(node).animationName),'none');
  assert.ok(!(await page.evaluate(() => localStorage.getItem('edge-media-deck:bridge-test:targets'))).includes(token));
  const restored = await context.newPage(); await restored.goto(entry);
  await restored.waitForFunction(({selected}) => document.getElementById('mediaTarget').value === selected,{selected});
  await restored.close();
  assert.deepEqual(errors,[]);
  assert.ok(requests.every(url => url.startsWith('https://127.0.0.1:39762/')));
  assert.ok(requests.every(url => !url.includes(token)));
  console.log('OK bridge keyboard, player/audio selection, absolute volume, mute, Chrome seeking, stale gesture rejection, disconnect/resume and token recovery');
  await context.close();
  // iCUE's body scripts can receive properties as function locals, not window globals.
  // Exercise the packaged scripts in that scope rather than mocking window.bridgeToken.
  const scopedContext = await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:840,height:344}});
  await isolateBridge(scopedContext);
  const scopedErrors = [];
  const scoped = await scopedContext.newPage();
  scoped.on('pageerror',error=>scopedErrors.push(error.message));
  const html = (await buildIcueHtml(fileURLToPath(new URL('../icue-widget/',import.meta.url))))
    .replace('<link rel="stylesheet" href="styles/style.css" />',`<link rel="stylesheet" href="${new URL('../icue-widget/styles/style.css',import.meta.url).href}" />`)
    .replace(/<script>\n([\s\S]*?)\n  <\/script>/g,(_,code)=>`<script>
      (function(bridgeToken,useBridge,icueEvents,pluginMediadataproviderEvents){
        ${code}
        window.hostEvents=icueEvents;window.hostMediaEvents=pluginMediadataproviderEvents;
      })(${JSON.stringify(token)},true,{},{});
    </script>`);
  const hostEntry = new URL('.generated/icue-host-scope.html',import.meta.url);
  await writeFile(hostEntry,html);
  await scoped.goto(hostEntry.href);
  await scoped.waitForFunction(()=>!document.getElementById('playPauseButton').disabled);
  assert.equal(await scoped.evaluate(()=>typeof window.bridgeToken),'undefined');
  assert.equal(await scoped.evaluate(()=>window.hostEvents===window.icueEvents),true);
  assert.equal(await scoped.evaluate(()=>window.hostMediaEvents===window.pluginMediadataproviderEvents),true);
  assert.equal(await scoped.locator('#songName').textContent(),fixture.windows.title);
  assert.deepEqual(scopedErrors,[]);
  await scopedContext.close();
  console.log('OK packaged iCUE scripts read host-local credentials and register host-local event handlers');
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
