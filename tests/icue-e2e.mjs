import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {checkDisplayPreferences} from './icue-display-checks.mjs';

const entry = new URL('../icue-widget/index.html', import.meta.url).href;
const output = new URL('./.generated/', import.meta.url);
await mkdir(output, {recursive:true});
const browser = await chromium.launch({headless:true,
  env:{...process.env, CHROME_LOG_FILE:fileURLToPath(new URL('icue-chromium.log', output))}});
const errors = [], remote = [];
try {
  const context = await browser.newContext({viewport:{width:1280, height:360}, hasTouch:true});
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  context.on('request', request => { if (/^https?:/.test(request.url())) remote.push(request.url()); });
  const page = await context.newPage();
  await page.goto(entry + '?demo=1');
  await page.waitForFunction(() => document.getElementById('songName').textContent === 'Midnight Current');
  assert.equal(await page.locator('#artist').innerText(), 'Demo Artist');
  await page.waitForFunction(() => document.getElementById('albumArt').naturalWidth > 0);
  assert.equal(await page.locator('.icon-pause').isVisible(), true);
  assert.equal(await page.locator('.icon-play').isVisible(), false);
  await page.locator('#playPauseButton').click();
  assert.equal(await page.locator('#statusText').innerText(), '一時停止');
  assert.equal(await page.locator('.icon-play').isVisible(), true);
  assert.equal(await page.locator('.icon-pause').isVisible(), false);
  await page.locator('#playPauseButton').click();
  assert.equal(await page.locator('#statusText').innerText(), '再生中');
  await page.locator('#nextButton').click();
  assert.equal(await page.locator('#songName').innerText(), 'A New Momentum');
  await page.locator('#previousButton').click();
  assert.equal(await page.locator('#songName').innerText(), 'Midnight Current');

  const sizes = [[840,344], [696,416], [840,696], [696,840], [1688,696], [696,1688],
    [2536,696], [696,2536], [2560,720], [1280,360], [640,180], [320,140], [280,320]];
  const fonts = new Map();
  for (const [width, height] of sizes) {
    await page.setViewportSize({width, height});
    // Check actual controls, not just document overflow (the template clips overflow).
    const boxes = await page.locator('.control, .metadata, .cover, .topline, .bottomline').evaluateAll(nodes => nodes.map(node => {
      const {x, y, width, height} = node.getBoundingClientRect();
      return {id:node.id, x, y, width, height};
    }));
    for (const box of boxes) {
      assert.ok(box.x >= -0.5 && box.y >= -0.5 && box.x + box.width <= width + 0.5 &&
        box.y + box.height <= height + 0.5, `${width}x${height}: clipped ${JSON.stringify(box)}`);
      if (box.id.endsWith('Button')) assert.ok(box.width >= 44 && box.height >= 44);
    }
    for (const selector of ['#songName', '#artist', '#album', '#statusText']) {
      assert.ok(await page.locator(selector).evaluate(node => {
        if (getComputedStyle(node).display === 'none') return true;
        const box = node.getBoundingClientRect(), parent = node.parentElement.getBoundingClientRect();
        return box.x >= parent.x - .5 && box.right <= parent.right + .5 &&
          box.y >= -.5 && box.bottom <= innerHeight + .5 && node.clientHeight >= parseFloat(getComputedStyle(node).fontSize);
      }), `${width}x${height}: clipped text ${selector}`);
    }
    fonts.set(`${width}x${height}`, await page.locator('#songName').evaluate(node => parseFloat(getComputedStyle(node).fontSize)));
    assert.equal(await page.locator('.player').evaluate(node => getComputedStyle(node).flexDirection), width / height <= 1.05 ? 'column' : 'row');
    await page.locator('#playPauseButton').click();
    await page.locator('#playPauseButton').click();
    if (width === 1280 || width === 280 || width === 696 || width === 840 || width === 2536 || width === 2560) {
      await page.screenshot({path:fileURLToPath(new URL(`icue-${width}x${height}.png`, output))});
    }
    console.log(`OK iCUE layout and controls: ${width}x${height}`);
  }
  assert.ok(fonts.get('2536x696') > fonts.get('840x344'));
  for (const height of [840,1688,2536]) assert.equal(fonts.get(`696x${height}`), fonts.get('696x416'));

  // The iCUE mimic can expose a reduced CSS viewport rather than a scaled full-size one.
  // Compare normalized geometry, computed type and visibility with the device surface.
  const mimic = await context.newPage();
  await mimic.addInitScript(() => { window.iCUE = {isPreview:false}; });
  await mimic.goto(entry + '?demo=1');
  await mimic.waitForFunction(() => document.getElementById('albumArt').naturalWidth > 0);
  const composition = () => mimic.evaluate(() => {
    const selectors = ['.cover', '.content', '.topline', '.now-label', '#songName', '#artist', '#album',
      '.bottomline', '.control', '.control-primary', '.brand', '.hint'];
    return selectors.map(selector => {
      const node = document.querySelector(selector), style = getComputedStyle(node);
      const {x, y, width, height} = node.getBoundingClientRect();
      return {selector, display:style.display,
        geometry:[x / innerWidth, y / innerHeight, width / innerWidth, height / innerHeight],
        font:node.matches('.now-label, #songName, #artist, #album, .brand, .hint')
          ? parseFloat(style.fontSize) / Math.min(innerWidth, innerHeight) : null};
    });
  });
  for (const [width, height] of sizes.slice(0, 8)) {
    await mimic.setViewportSize({width, height});
    await mimic.evaluate(() => { window.iCUE.isPreview = false; window.icueEvents.onDataUpdated(); });
    assert.equal(await mimic.locator('html').getAttribute('data-icue-surface'), 'device');
    const device = await composition();
    for (const item of device) {
      if (item.display === 'none') continue;
      const [x, y, w, h] = item.geometry;
      assert.ok(x >= -.001 && y >= -.001 && x + w <= 1.001 && y + h <= 1.001,
        `${width}x${height}: device clips ${item.selector}`);
    }
    assert.ok(await mimic.locator('.control').first().evaluate(node => node.getBoundingClientRect().width >= 44));
    if (width === 840 && height === 344) await mimic.screenshot({path:fileURLToPath(new URL('icue-device-s-horizontal.png', output))});
    if (height === 2536) await mimic.screenshot({path:fileURLToPath(new URL('icue-device-xl-vertical.png', output))});
    for (const scale of [.5, .25]) {
      await mimic.setViewportSize({width:width * scale, height:height * scale});
      await mimic.evaluate(() => { window.iCUE.isPreview = true; window.icueEvents.onDataUpdated(); });
      assert.equal(await mimic.locator('html').getAttribute('data-icue-surface'), 'preview');
      const preview = await composition();
      for (let i = 0; i < device.length; i++) {
        const message = `${width}x${height} at ${scale}: ${device[i].selector}`;
        assert.equal(preview[i].display, device[i].display, `${message} visibility differs`);
        if (device[i].display === 'none') continue;
        for (let axis = 0; axis < 4; axis++) {
          assert.ok(Math.abs(preview[i].geometry[axis] - device[i].geometry[axis]) < .006,
            `${message} geometry differs: ${JSON.stringify({device:device[i], preview:preview[i]})}`);
        }
        assert.ok(Math.abs(preview[i].font - device[i].font) < .0001, `${message} type scale differs`);
      }
      if (height === 2536 && scale === .25) await mimic.screenshot({path:fileURLToPath(new URL('icue-preview-xl-vertical.png', output))});
    }
    console.log(`OK iCUE preview/device proportions: ${width}x${height}, half and quarter size`);
  }
  await mimic.close();

  // Settings change the background layer without dimming text or controls.
  await page.setViewportSize({width:696, height:840});
  await page.evaluate(() => {
    window.textColor = '#ddeeff'; window.transparency = 75; window.showArtwork = false; window.showAlbum = false;
    window.accentColor = '#000000'; window.icueEvents.onDataUpdated();
  });
  assert.equal(await page.locator('#cover').isVisible(), false);
  assert.equal(await page.locator('#album').isVisible(), false);
  assert.equal(await page.locator('#songName').evaluate(node => getComputedStyle(node).color), 'rgb(221, 238, 255)');
  assert.equal(await page.locator('#deck').evaluate(node => getComputedStyle(node, '::before').opacity), '0.25');
  assert.equal(await page.locator('#playPauseButton').evaluate(node => getComputedStyle(node).color), 'rgb(255, 255, 255)');
  for (const [width, height] of sizes.slice(0, 8)) {
    await page.setViewportSize({width, height});
    assert.ok(await page.locator('#playPauseButton').evaluate(node => {
      const box = node.getBoundingClientRect();
      return box.x >= 0 && box.right <= innerWidth && box.y >= 0 && box.bottom <= innerHeight;
    }));
  }
  await page.evaluate(() => {
    window.transparency = 0; window.showArtwork = true; window.showAlbum = true;
    window.accentColor = '#66e6ce'; window.textColor = '#f7f8fc'; window.icueEvents.onDataUpdated();
  });
  assert.equal(await page.locator('#cover').isVisible(), true);
  assert.equal(await page.locator('#album').innerText(), 'Offline Preview • Vol. 1');

  // Keyboard operation uses native buttons and visible focus.
  await page.evaluate(() => {window.iCUE = {isPreview:false}; window.icueEvents.onDataUpdated();});
  await checkDisplayPreferences(page, {bridge:false,sizes:sizes.slice(0,8)});
  await page.screenshot({path:fileURLToPath(new URL('icue-display-settings.png',output))});
  await page.setViewportSize({width:1280, height:360});
  await page.locator('#playPauseButton').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#statusText').innerText(), '一時停止');
  assert.notEqual(await page.locator('#playPauseButton').evaluate(node => getComputedStyle(node).outlineStyle), 'none');

  const live = await context.newPage();
  await live.addInitScript(() => {window.useBridge = false;});
  await live.goto(entry);
  assert.equal(await live.locator('#playPauseButton').isDisabled(), true);
  assert.equal(await live.locator('#statusText').innerText(), 'iCUEメディアを待機中');
  await live.evaluate(() => {
    const makeSignal = () => {
      const callbacks = new Set();
      return {connect:fn => callbacks.add(fn), disconnect:fn => callbacks.delete(fn),
        emit(...args) { for (const callback of callbacks) callback(...args); }};
    };
    const media = {songName:'実際の曲名 <b>テスト</b>', artist:'アーティスト', album:'アルバム',
      thumbnail:'', isPlaying:false, asyncResponse:makeSignal()};
    for (const [key, method] of Object.entries({songName:'getSongName', artist:'getArtist', album:'getAlbum',
      thumbnail:'getThumbnail', isPlaying:'getIsPlaying'})) {
      media[key + 'Changed'] = makeSignal();
      media[method] = id => setTimeout(() => media.asyncResponse.emit(id, media[key]), 10);
    }
    media.triggerPlayPause = () => { media.isPlaying = !media.isPlaying; media.isPlayingChanged.emit(); };
    // No next/previous methods: those controls must stay disabled.
    window.plugins = {Mediadataprovider:media};
    window.pluginMediadataproviderEvents.onInitialized();
    window.accentColor = '#ffcc66'; window.backgroundColor = '#102030';
    window.icueEvents.onDataUpdated();
  });
  assert.equal(await live.locator('#songName').innerText(), '実際の曲名 <b>テスト</b>');
  assert.equal(await live.locator('#songName b').count(), 0);
  assert.equal(await live.locator('#nextButton').isDisabled(), true);
  assert.equal(await live.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()), '#ffcc66');
  await live.locator('#playPauseButton').click();
  assert.equal(await live.locator('#statusText').innerText(), '再生中');
  await live.evaluate(() => {
    const media = window.plugins.Mediadataprovider;
    media.songName = '長い日本語の曲名 🎧 e\u0301'.repeat(80);
    media.artist = '長いアーティスト名'.repeat(80);
    media.album = '長いアルバム名'.repeat(80);
    media.songNameChanged.emit();
  });
  for (const [width, height] of sizes.slice(0, 8)) {
    await live.setViewportSize({width, height});
    for (const selector of ['#songName', '#artist', '#album']) {
      assert.ok(await live.locator(selector).evaluate(node => {
        const box = node.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight &&
          getComputedStyle(node).textOverflow === (node.id === 'songName' ? 'clip' : 'ellipsis');
      }), `${width}x${height}: long text ${selector}`);
    }
  }
  // Observe elapsed-time motion, not only manually advanced CSS keyframes.
  // Even this very long title must start within a fixed pause, during host updates.
  await live.evaluate(() => {window.hostUpdates = setInterval(() => window.icueEvents.onDataUpdated(), 100);});
  await live.waitForFunction(() => new DOMMatrix(getComputedStyle(document.getElementById('songTitleText')).transform).m41 < -3, null, {timeout:4000});
  await live.evaluate(() => clearInterval(window.hostUpdates));
  // Verify the first and last glyphs, including a host that scales the full
  // widget with a transform instead of changing its CSS viewport dimensions.
  await live.setViewportSize({width:696, height:840});
  for (const scale of [1, .5, .25]) {
    await live.evaluate(scale => {
      const deck = document.getElementById('deck');
      deck.style.transformOrigin = 'top left'; deck.style.transform = `scale(${scale})`;
      window.dispatchEvent(new Event('resize'));
    }, scale);
    const endpoints = await live.locator('#songTitleText').evaluate(node => {
      const animation = node.getAnimations()[0];
      animation.pause(); animation.currentTime = 0;
      const parent = node.parentElement.getBoundingClientRect();
      const start = node.getBoundingClientRect();
      const {delay, duration} = animation.effect.getTiming();
      animation.currentTime = delay + duration - .01;
      const end = node.getBoundingClientRect();
      animation.currentTime = delay + duration + .01;
      const restart = node.getBoundingClientRect();
      return {start:start.left-parent.left, end:end.right-parent.right, restart:restart.left-parent.left};
    });
    assert.ok(Math.abs(endpoints.start) < 1 && Math.abs(endpoints.end) < 1,
      `scaled title must reveal both ends: ${scale} ${JSON.stringify(endpoints)}`);
    assert.ok(Math.abs(endpoints.restart) < 1, `title must return directly to its start: ${scale}`);
  }
  // Real touch input must scrub from the displayed position, even in a scaled host.
  const touch = await context.newCDPSession(live);
  for (const scale of [1, .5, .25]) {
    await live.evaluate(scale => {
      document.getElementById('deck').style.transform = `scale(${scale})`;
      const animation = document.getElementById('songTitleText').getAnimations()[0];
      animation.pause();
      const distance = document.getElementById('songTitleText').offsetWidth - document.getElementById('songName').offsetWidth;
      animation.currentTime = 1000 + 60 / distance * (animation.effect.getTiming().duration - 2000);
    }, scale);
    const box = await live.locator('#songName').boundingBox();
    const x = box.x + box.width * .8, y = box.y + box.height / 2;
    const delta = 40 * scale;
    await touch.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x,y}]});
    await touch.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x:x-delta,y}]});
    const offset = await live.locator('#songTitleText').evaluate(node => -new DOMMatrix(getComputedStyle(node).transform).m41);
    assert.ok(Math.abs(offset - 100) < 2, `touch follows local CSS pixels from the displayed position: ${scale} ${offset}`);
    await touch.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x,y}]});
    await live.waitForFunction(() => Math.abs(new DOMMatrix(getComputedStyle(document.getElementById('songTitleText')).transform).m41 + 60) < 2);
    await touch.send('Input.dispatchTouchEvent', {type:scale === .5 ? 'touchCancel' : 'touchEnd', touchPoints:[]});
    await live.waitForFunction(() => !document.getElementById('songName').dataset.manual);
  }
  await touch.detach();
  await live.evaluate(() => {document.getElementById('deck').style.transform = '';});
  await live.locator('#songName').focus();
  await live.keyboard.press('End');
  assert.ok(await live.locator('#songTitleText').evaluate(node => {
    return Math.abs(node.getBoundingClientRect().right - node.parentElement.getBoundingClientRect().right) < 1;
  }), 'keyboard can reveal the final characters');
  await live.evaluate(() => {
    window.plugins.Mediadataprovider.songName += ' 新しい曲';
    window.plugins.Mediadataprovider.songNameChanged.emit();
  });
  assert.ok(await live.locator('#songTitleText').evaluate(node => node.getAnimations()[0].currentTime < 100), 'new track restarts at its title');
  await live.evaluate(() => {document.getElementById('deck').style.transform = ''; window.scrollTitle = false; window.icueEvents.onDataUpdated();});
  assert.equal(await live.locator('#songTitleText').evaluate(node => getComputedStyle(node).animationName), 'none');
  assert.equal(await live.locator('#songName').evaluate(node => getComputedStyle(node).textOverflow), 'ellipsis');
  await live.keyboard.press('End');
  assert.ok(await live.locator('#songTitleText').evaluate(node => {
    return Math.abs(node.getBoundingClientRect().right - node.parentElement.getBoundingClientRect().right) < 1;
  }), 'manual scrolling works with automatic scrolling disabled');
  await live.keyboard.press('Home');
  await live.waitForFunction(() => !document.getElementById('songName').dataset.manual);
  await live.evaluate(() => { window.plugins.Mediadataprovider.album = 'アルバム'; window.plugins.Mediadataprovider.albumChanged.emit(); });
  await live.setViewportSize({width:320, height:140});
  assert.equal(await live.locator('#songName').evaluate(node => getComputedStyle(node).textOverflow), 'ellipsis');
  await live.setViewportSize({width:696, height:840});
  assert.equal(await live.locator('#album').innerText(), 'アルバム');
  await live.evaluate(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pageshow')); });
  assert.equal(await live.locator('#playPauseButton').isEnabled(), true);
  await live.evaluate(() => { window.plugins.Mediadataprovider.songName = ''; window.plugins.Mediadataprovider.songNameChanged.emit(); });
  assert.equal(await live.locator('#playPauseButton').isDisabled(), true);
  assert.equal(await live.locator('#coverPlaceholder').isVisible(), true);
  await live.screenshot({path:fileURLToPath(new URL('icue-placeholder.png', output))});
  // Delayed async-only providers distinguish loading, an empty session and a lost connection.
  const pending = await context.newPage();
  await pending.addInitScript(() => {window.useBridge = false;});
  await pending.goto(entry);
  await pending.evaluate(() => {
    const listeners = new Set();
    window.pendingRequests = [];
    window.plugins = {Mediadataprovider:{
      asyncResponse:{connect:fn => listeners.add(fn), disconnect:fn => listeners.delete(fn)},
      getSongName(id) { window.pendingRequests.push(id); },
    }};
    window.reply = value => { for (const fn of listeners) fn(window.pendingRequests.at(-1), value); };
    window.pluginMediadataproviderEvents.onInitialized();
  });
  assert.equal(await pending.locator('#deck').getAttribute('data-status'), 'loading');
  await pending.waitForFunction(() => window.pendingRequests.length > 0);
  await pending.evaluate(() => window.reply(''));
  await pending.waitForFunction(() => document.getElementById('deck').dataset.status === 'idle');
  await pending.evaluate(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pageshow')); });
  await pending.waitForFunction(() => document.getElementById('deck').dataset.status === 'error');
  assert.equal(await pending.locator('#playPauseButton').isDisabled(), true);
  await pending.screenshot({path:fileURLToPath(new URL('icue-unavailable.png', output))});
  assert.deepEqual(errors, []);
  assert.deepEqual(remote, []);
  console.log('OK iCUE all Edge slots, stable vertical type, personalization, keyboard, loading/empty/error, restore, no remote requests or JS errors');
} finally {
  await browser.close();
}
