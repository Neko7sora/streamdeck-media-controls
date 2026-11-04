import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {load} from './load.mjs';
import {tls} from './tls-fixture.mjs';
import {icueBackend} from './icue-backend.mjs';
import {buildIcueHtml} from '../scripts/icue-widget-html.mjs';
import {checkDisplayPreferences} from './icue-display-checks.mjs';
const {startIcueServer} = await load('icue-server');
const token = 'd'.repeat(64), fixture = icueBackend();
// Original test artwork at device resolution, rather than an enlarged app icon.
fixture.windows.artwork_data_url = 'data:image/png;base64,' + (await sharp(Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#172b48"/><circle cx="730" cy="290" r="180" fill="#edbe76"/><path d="M0 750 330 290 1024 1024H0Z" fill="#66b9ae"/><path d="M0 1024 540 510 1024 820V1024Z" fill="#31597b"/></svg>'
)).png().toBuffer()).toString('base64');
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
  await page.waitForFunction(() => document.getElementById('albumArt').naturalWidth === 1024);
  if (process.argv.includes('--update-preview')) {
    // Render the actual UI with public fixture data; preserve its aspect ratio
    // inside the selector's documented 128 × 56 canvas.
    await sharp(await page.screenshot()).resize(128, 56, {fit:'contain', background:'#070b16'})
      .png().toFile(fileURLToPath(new URL('../icue-widget/resources/preview.png', import.meta.url)));
  }
  const selectors = ['#cover','#songName','#artist','#album','#statusText','#bridgePanel','#mediaTarget','#audioTarget','#seekRange','#volumeRange',
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
    const cover = device.find(box => box.id === '#cover');
    assert.ok(cover.w >= Math.min(width * .25, height * .54), `${width}x${height}: cover should use the available area`);
    if (width / height > 1.05) assert.ok(cover.w <= width * .3, `${width}x${height}: leave room for media controls`);
    assert.ok(Math.abs(cover.w-cover.h) < 1, `${width}x${height}: square cover`);
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
  const callsBeforeSettings = fixture.calls.length;
  fixture.master.muted = true; fixture.emit();
  await page.waitForFunction(() => document.getElementById('muteButton').textContent === 'ミュート解除');
  await checkDisplayPreferences(page, {bridge:true,sizes});
  assert.equal(fixture.calls.length, callsBeforeSettings, 'display preferences never issue media commands');
  fixture.master.muted = false; fixture.emit();
  await page.setViewportSize({width:840,height:344});
  assert.equal(await page.locator('#deck').evaluate(node => node.scrollHeight > node.clientHeight), false);
  assert.equal(await page.locator('.connection-badge[data-connected="true"]').count(), 2);
  await page.locator('#audioTarget').click();
  assert.equal(await page.locator('#audioTarget').evaluate(node => node.matches(':open')), true);
  await page.screenshot({path:fileURLToPath(new URL('icue-native-picker.png',output))});
  await page.keyboard.press('Escape');
  fixture.backend.chromeStatus = () => ({state:'disconnected'}); fixture.emit();
  await page.waitForFunction(() => document.querySelector('.connection-badge[data-connected="false"]')?.textContent === 'Chrome未接続（任意）');
  fixture.backend.chromeStatus = () => ({state:'connected'}); fixture.emit();
  await page.waitForFunction(() => document.querySelectorAll('.connection-badge[data-connected="true"]').length === 2);
  assert.ok(parseFloat(await page.locator('#volumeRange').evaluate(node => node.style.getPropertyValue('--range-progress'))) > 0);
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
  assert.equal(await page.locator('#volumeRange').evaluate(node => node.style.getPropertyValue('--range-progress')), '73%');
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
  assert.equal(await page.locator('#volumeRange').evaluate(node => node.style.getPropertyValue('--range-progress')), '100%');
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
  // iCUE injects the switch's true default: that local choice must override
  // Windows disabling animations, for both preview and device rendering.
  for (const preview of [true, false]) {
    await page.evaluate(preview => {window.iCUE.isPreview=preview; window.scrollTitle=true; window.icueEvents.onDataUpdated();}, preview);
    await page.waitForFunction(() => new DOMMatrix(getComputedStyle(document.getElementById('songTitleText')).transform).m41 < -3, null, {timeout:4000});
    await page.evaluate(() => {window.scrollTitle=false; window.icueEvents.onDataUpdated();});
    assert.equal(await page.locator('#songTitleText').evaluate(node => getComputedStyle(node).animationName),'none');
    assert.equal(await page.locator('#songName').evaluate(node => getComputedStyle(node).textOverflow),'ellipsis');
  }
  assert.ok(!(await page.evaluate(() => localStorage.getItem('edge-media-deck:bridge-test:targets'))).includes(token));
  const restored = await context.newPage(); await restored.goto(entry);
  await restored.waitForFunction(({selected}) => document.getElementById('mediaTarget').value === selected,{selected});
  await restored.close();
  // A regular browser keeps touch controls reachable when the window is smaller
  // than a device slot; iCUE's proportional preview is covered separately above.
  const compact = await context.newPage(); await compact.goto(entry);
  await compact.waitForFunction(() => !document.getElementById('mediaTarget').disabled);
  await compact.evaluate(() => {delete window.iCUE; window.icueEvents.onDataUpdated();});
  for (const [width,height] of [[540,360],[320,568],[320,180],[280,320]]) {
    await compact.setViewportSize({width,height});
    const layout = await compact.locator('#deck').evaluate(node => ({width:node.clientWidth, content:node.scrollWidth}));
    assert.ok(layout.content <= layout.width + 1, `${width}x${height}: no horizontal scrolling`);
    for (const selector of interactive) {
      const node = compact.locator(selector);
      await node.scrollIntoViewIfNeeded();
      const box = await node.boundingBox();
      assert.ok(box.x >= -.5 && box.y >= -.5 && box.x+box.width <= width+.5 && box.y+box.height <= height+.5,
        `${width}x${height}: unreachable ${selector} ${JSON.stringify(box)}`);
      assert.ok(box.width >= 47.5 && box.height >= 47.5, `${width}x${height}: touch target ${selector}`);
    }
  }
  await compact.setViewportSize({width:320,height:568});
  await compact.locator('#deck').evaluate(node => {node.scrollTop=0;});
  await compact.screenshot({path:fileURLToPath(new URL('icue-bridge-compact.png',output))});
  await compact.emulateMedia({forcedColors:'active'});
  assert.equal(await compact.locator('#mediaTarget').evaluate(node => getComputedStyle(node).appearance), 'auto');
  await compact.close();
  assert.deepEqual(errors,[]);
  assert.ok(requests.every(url => url.startsWith('https://127.0.0.1:39762/')));
  assert.ok(requests.every(url => !url.includes(token)));
  console.log('OK compact browser reflow, native range fill and text-labelled connection indicators');
  console.log('OK bridge keyboard, player/audio selection, absolute volume, mute, Chrome seeking, stale gesture rejection, disconnect/resume and token recovery');
  await context.close();
  // Exercise iCUE Chromium 130's fallback even on the newer CI browser.
  fixture.audio.volume = .25; fixture.audio.muted = false;
  const legacyContext = await browser.newContext({ignoreHTTPSErrors:true,hasTouch:true,viewport:{width:840,height:344}});
  await isolateBridge(legacyContext);
  await legacyContext.addInitScript(({token}) => {
    const supports = CSS.supports.bind(CSS);
    CSS.supports = (...args) => args[0] === 'appearance' && args[1] === 'base-select' ? false : supports(...args);
    window.useBridge = true; window.bridgeToken = token; window.uniqueId = 'picker-test'; window.iCUE = {isPreview:false};
  }, {token});
  const legacy = await legacyContext.newPage();
  const pickerErrors = []; legacy.on('pageerror', error => pickerErrors.push(error.message));
  await legacy.goto(entry);
  const audioPicker = legacy.locator('#audioTargetPicker'), audioOptions = legacy.locator('#audioTargetOptions');
  await legacy.waitForFunction(() => !document.getElementById('audioTargetPicker').disabled);
  for (const [width,height] of sizes) {
    await legacy.setViewportSize({width,height});
    for (const selector of interactive.map(selector => selector.endsWith('Target') ? `${selector}Picker` : selector)) {
      const box = await legacy.locator(selector).boundingBox();
      assert.ok(box.x >= -.5 && box.y >= -.5 && box.x+box.width <= width+.5 && box.y+box.height <= height+.5,
        `${width}x${height}: compatible picker layout ${selector}`);
      assert.ok(box.width >= 47.5 && box.height >= 47.5, `${width}x${height}: compatible touch target ${selector}`);
    }
  }
  await legacy.setViewportSize({width:840,height:344});
  await checkDisplayPreferences(legacy, {bridge:true,sizes});
  await legacy.setViewportSize({width:840,height:344});
  await legacy.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await audioPicker.getAttribute('aria-labelledby'), 'audioTargetLabel');
  await audioPicker.focus(); await legacy.keyboard.press('Enter');
  assert.equal(await audioPicker.getAttribute('aria-expanded'), 'true');
  await legacy.keyboard.press('End');
  assert.equal(await legacy.locator('#audioTargetOptions [data-active="true"]').textContent(), 'Player');
  await legacy.keyboard.press('Escape');
  assert.equal(await legacy.locator('#audioTarget').inputValue(), 'master');
  assert.equal(await audioPicker.getAttribute('aria-expanded'), 'false');
  await audioPicker.click();
  await legacy.evaluate(() => {window.showAudioTarget=false;window.icueEvents.onDataUpdated();});
  assert.equal(await audioOptions.isVisible(), false, 'hiding a selector also closes its top-layer popup');
  assert.equal(await audioPicker.isVisible(), false);
  await legacy.evaluate(() => {window.showAudioTarget=true;window.icueEvents.onDataUpdated();});
  await legacy.keyboard.press('Space'); await legacy.keyboard.press('p'); await legacy.keyboard.press('Enter');
  await legacy.waitForFunction(() => document.getElementById('audioTarget').value === 'audio:player' && !document.getElementById('audioTargetPicker').disabled);
  await audioPicker.tap();
  await legacy.screenshot({path:fileURLToPath(new URL('icue-compatible-picker.png',output))});
  const box = await audioOptions.boundingBox();
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 840 && box.y + box.height <= 344);
  await audioOptions.getByRole('option', {name:'マスター音量'}).tap();
  await legacy.waitForFunction(() => document.getElementById('audioTarget').value === 'master' && !document.getElementById('audioTargetPicker').disabled);
  await audioPicker.click(); await legacy.locator('#songName').click();
  assert.equal(await audioPicker.getAttribute('aria-expanded'), 'false');
  await audioPicker.click();
  fixture.audio.name = 'Renamed <player>'; fixture.emit();
  await legacy.waitForFunction(() => document.getElementById('audioTargetOptions').textContent.includes('Renamed <player>'));
  assert.equal(await audioPicker.getAttribute('aria-expanded'), 'false');
  assert.equal(await audioOptions.locator('player').count(), 0);
  await legacy.locator('#mediaTargetPicker').click();
  await legacy.locator('#mediaTargetOptions').getByRole('option', {name:'自動選択',exact:true}).click();
  await legacy.waitForFunction(() => !document.getElementById('mediaTargetPicker').disabled);
  // Reproduce a compact player menu with wrapped Japanese session names.
  const oldTitles = [fixture.windows.title, fixture.chrome.title];
  fixture.windows.title = fixture.chrome.title = '長い日本語の動画タイトル・プレーヤーの選択肢が折り返される場合の表示を確認します。'.repeat(2);
  fixture.emit();
  await legacy.waitForFunction(() => document.getElementById('mediaTargetOptions').textContent.includes('長い日本語の動画タイトル'));
  for (const [width,height] of sizes) {
    await legacy.setViewportSize({width,height});
    await legacy.evaluate(() => {window.titleSize=window.artistSize=window.albumSize=window.labelSize=100;window.icueEvents.onDataUpdated();});
    const normal = await legacy.locator('#mediaTargetPicker').evaluate(node => node.getBoundingClientRect().height);
    await legacy.evaluate(() => {window.titleSize=window.artistSize=window.albumSize=window.labelSize=75;window.icueEvents.onDataUpdated();});
    await legacy.locator('#mediaTargetPicker').click();
    const list = legacy.locator('#mediaTargetOptions');
    const compact = await list.getByRole('option', {name:'自動選択',exact:true}).boundingBox();
    assert.ok(compact.height >= 24 && compact.height < normal * .7, `${width}x${height}: compact menu row follows text size`);
    assert.equal(await list.getByRole('option').evaluateAll(nodes => nodes.every(node => {
      const range = document.createRange(); range.selectNodeContents(node);
      const text = range.getBoundingClientRect(), box = node.getBoundingClientRect();
      return text.top >= box.top - 1 && text.bottom <= box.bottom + 1 && node.scrollWidth <= node.clientWidth + 1;
    })), true, `${width}x${height}: wrapped compact menu labels fit their rows`);
    if (width === 2536) await legacy.screenshot({path:fileURLToPath(new URL('icue-min-compatible-picker.png',output))});
    await legacy.keyboard.press('Escape');
  }
  [fixture.windows.title, fixture.chrome.title] = oldTitles; fixture.emit();
  await legacy.evaluate(() => {window.titleSize=window.artistSize=window.albumSize=window.labelSize=100;window.icueEvents.onDataUpdated();});
  await legacy.setViewportSize({width:840,height:344});
  await audioPicker.click();
  await legacy.evaluate(() => {window.bridgeToken='e'.repeat(64);window.icueEvents.onDataUpdated();});
  await legacy.waitForFunction(() => document.getElementById('audioTargetPicker').disabled);
  assert.equal(await audioPicker.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(pickerErrors, []);
  fixture.audio.name = 'Player';
  await legacyContext.close();
  console.log('OK native styled picker and Chromium 130 fallback: keyboard, touch, cancel, live choices and disconnect');
  // iCUE's body scripts can receive properties as function locals, not window globals.
  // Exercise the packaged scripts in that scope rather than mocking window.bridgeToken.
  const scopedContext = await browser.newContext({ignoreHTTPSErrors:true,reducedMotion:'reduce',viewport:{width:840,height:344}});
  await isolateBridge(scopedContext);
  const scopedErrors = [];
  const scoped = await scopedContext.newPage();
  scoped.on('pageerror',error=>scopedErrors.push(error.message));
  const html = (await buildIcueHtml(fileURLToPath(new URL('../icue-widget/',import.meta.url))))
    .replace('<link rel="stylesheet" href="styles/style.css" />',`<link rel="stylesheet" href="${new URL('../icue-widget/styles/style.css',import.meta.url).href}" />`)
    .replace(/<script>\n([\s\S]*?)\n  <\/script>/g,(_,code)=>`<script>
      (function(bridgeToken,useBridge,scrollTitle,icueEvents,pluginMediadataproviderEvents){
        ${code}
        window.hostEvents=icueEvents;window.hostMediaEvents=pluginMediadataproviderEvents;
      })(${JSON.stringify(token)},true,true,{},{});
    </script>`);
  const hostEntry = new URL('.generated/icue-host-scope.html',import.meta.url);
  await writeFile(hostEntry,html);
  await scoped.goto(hostEntry.href);
  await scoped.waitForFunction(()=>!document.getElementById('playPauseButton').disabled);
  assert.equal(await scoped.evaluate(()=>typeof window.bridgeToken),'undefined');
  assert.equal(await scoped.evaluate(()=>typeof window.scrollTitle),'undefined');
  assert.equal(await scoped.evaluate(()=>window.hostEvents===window.icueEvents),true);
  assert.equal(await scoped.evaluate(()=>window.hostMediaEvents===window.pluginMediadataproviderEvents),true);
  assert.equal(await scoped.locator('#songName').textContent(),fixture.windows.title);
  fixture.windows.title = 'Packaged host-local scrolling title '.repeat(20); fixture.emit();
  await scoped.waitForFunction(() => new DOMMatrix(getComputedStyle(document.getElementById('songTitleText')).transform).m41 < -3, null, {timeout:4000});
  assert.deepEqual(scopedErrors,[]);
  await scopedContext.close();
  console.log('OK packaged iCUE scripts read host-local credentials and register host-local event handlers');
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
