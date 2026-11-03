import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const entry = new URL('../icue-widget/index.html', import.meta.url).href;
const output = new URL('./.generated/', import.meta.url);
await mkdir(output, {recursive:true});
const browser = await chromium.launch({headless:true,
  env:{...process.env, CHROME_LOG_FILE:fileURLToPath(new URL('icue-chromium.log', output))}});
const errors = [], remote = [];
try {
  const context = await browser.newContext({viewport:{width:1280, height:360}});
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

  for (const [width, height] of [[2560,720], [1280,360], [640,180], [320,140], [280,320]]) {
    await page.setViewportSize({width, height});
    // Check actual controls, not just document overflow (the template clips overflow).
    const boxes = await page.locator('.control, .metadata, .cover').evaluateAll(nodes => nodes.map(node => {
      const {x, y, width, height} = node.getBoundingClientRect();
      return {id:node.id, x, y, width, height};
    }));
    for (const box of boxes) {
      assert.ok(box.x >= -0.5 && box.y >= -0.5 && box.x + box.width <= width + 0.5 &&
        box.y + box.height <= height + 0.5, `${width}x${height}: clipped ${JSON.stringify(box)}`);
      if (box.id.endsWith('Button')) assert.ok(box.width >= 42 && box.height >= 42);
    }
    await page.locator('#playPauseButton').click();
    await page.locator('#playPauseButton').click();
    if (width === 1280 || width === 280) {
      await page.screenshot({path:fileURLToPath(new URL(`icue-${width}x${height}.png`, output))});
    }
    console.log(`OK iCUE layout and controls: ${width}x${height}`);
  }

  // Keyboard operation uses native buttons and visible focus.
  await page.setViewportSize({width:1280, height:360});
  await page.locator('#playPauseButton').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#statusText').innerText(), '一時停止');
  assert.notEqual(await page.locator('#playPauseButton').evaluate(node => getComputedStyle(node).outlineStyle), 'none');

  const live = await context.newPage();
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
  await live.evaluate(() => { window.plugins.Mediadataprovider.songName = '長い日本語の曲名'.repeat(80); window.plugins.Mediadataprovider.songNameChanged.emit(); });
  await live.setViewportSize({width:320, height:140});
  assert.equal(await live.locator('#songName').evaluate(node => getComputedStyle(node).textOverflow), 'ellipsis');
  await live.evaluate(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pageshow')); });
  assert.equal(await live.locator('#playPauseButton').isEnabled(), true);
  await live.evaluate(() => { window.plugins.Mediadataprovider.songName = ''; window.plugins.Mediadataprovider.songNameChanged.emit(); });
  assert.equal(await live.locator('#playPauseButton').isDisabled(), true);
  assert.equal(await live.locator('#coverPlaceholder').isVisible(), true);
  assert.deepEqual(errors, []);
  assert.deepEqual(remote, []);
  console.log('OK iCUE demo, keyboard, late provider, settings, unknown metadata, restore, no remote requests or JS errors');
} finally {
  await browser.close();
}
