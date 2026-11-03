import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {widget, mediaProvider, keys} from './icue-harness.mjs';

test('iCUE waits without a provider, initializes late once, and checks each command method', async () => {
  const w = widget();
  assert.equal(w.elements.get('statusText').textContent, 'iCUEメディアを待機中');
  w.click('playPauseButton');
  const p = mediaProvider();
  delete p.media.triggerNextTrack;
  w.window.plugins.Mediadataprovider = p.media;
  w.window.pluginMediadataproviderEvents.onInitialized();
  w.window.pluginMediadataproviderEvents.onInitialized();
  await w.flush();
  assert.equal(w.elements.get('songName').textContent, 'Track A');
  assert.equal(w.elements.get('statusText').textContent, '再生中');
  assert.equal(w.elements.get('nextButton').disabled, true);
  assert.equal(p.media.songNameChanged.size, 1);
  assert.equal(w.intervals.size, 1);
  w.click('previousButton'); w.click('playPauseButton'); w.click('nextButton');
  assert.deepEqual(p.calls, ['triggerPreviousTrack', 'triggerPlayPause']);
});

test('iCUE does not invent metadata or treat malformed playback state as paused', async () => {
  const p = mediaProvider({isPlaying:'true', artist:null, album:{}}), w = widget(p);
  await w.flush();
  assert.equal(w.elements.get('statusText').textContent, '再生状態不明');
  assert.equal(w.elements.get('playPauseButton').getAttribute('aria-label'), '再生／一時停止');
  assert.equal(w.elements.get('artist').textContent, 'アーティスト不明');
  assert.equal(w.elements.get('album').textContent, '');
  p.data.songName = undefined; p.emit();
  assert.equal(w.elements.get('playPauseButton').disabled, true);
  assert.equal(w.elements.get('songName').textContent, '再生中の曲はありません');
  w.click('playPauseButton'); assert.equal(p.calls.length, 0);
});

test('iCUE ignores out-of-order async snapshots and cancels their request timers', async () => {
  const p = mediaProvider({}, {asyncOnly:true, autoRespond:false}), w = widget(p);
  await w.flush();
  const old = [...p.requests];
  p.data.songName = 'Track B'; p.emit();
  await w.flush();
  const current = p.requests.slice(old.length);
  for (const r of current.toReversed()) p.media.asyncResponse.emit(r.id, r.value);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(w.elements.get('songName').textContent, 'Track B');
  for (const r of old) p.media.asyncResponse.emit(r.id, r.value);
  await Promise.resolve();
  assert.equal(w.elements.get('songName').textContent, 'Track B');
  assert.equal(w.timers.size, 0);
});

test('iCUE timeouts clear old async-only metadata and preserve fresh property fallback', async () => {
  const p = mediaProvider({}, {asyncOnly:true}), w = widget(p);
  await w.flush();
  for (const method of ['getSongName','getArtist','getAlbum','getThumbnail','getIsPlaying']) p.media[method] = () => {};
  w.visibility('visible'); await w.flush(); await w.flush(3500);
  assert.equal(w.elements.get('songName').textContent, '再生中の曲はありません');
  assert.equal(w.elements.get('playPauseButton').disabled, true);
  const p2 = mediaProvider({}, {autoRespond:false}), w2 = widget(p2);
  await w2.flush(); await w2.flush(3500);
  assert.equal(w2.elements.get('songName').textContent, 'Track A');
});

test('iCUE rejects commands after an unannounced track or provider change', () => {
  const p = mediaProvider(), w = widget(p);
  p.data.songName = 'Track B';
  w.click('playPauseButton');
  assert.equal(p.calls.length, 0);
  assert.equal(w.elements.get('songName').textContent, 'Track B');
  w.click('playPauseButton'); assert.equal(p.calls.length, 1);
  const p2 = mediaProvider({songName:'Track C'});
  w.window.plugins.Mediadataprovider = p2.media;
  w.click('playPauseButton'); assert.equal(p2.calls.length, 0);
  assert.equal(p.media.songNameChanged.size, 0);
  w.click('playPauseButton'); assert.equal(p2.calls.length, 1);
});

test('iCUE suspends pending work on pagehide and reconnects on pageshow', async () => {
  const p = mediaProvider({}, {autoRespond:false}), w = widget(p);
  await w.flush();
  const old = [...p.requests];
  w.event('pagehide');
  assert.equal(w.timers.size, 0); assert.equal(w.intervals.size, 0);
  assert.equal(p.media.asyncResponse.size, 0);
  for (const key of keys) assert.equal(p.media[key + 'Changed'].size, 0);
  w.click('playPauseButton'); assert.equal(p.calls.length, 0);
  w.event('pageshow'); await w.flush();
  assert.equal(w.intervals.size, 1);
  assert.equal(p.media.songNameChanged.size, 1);
  assert.ok(p.requests.slice(old.length).every(r => r.id > old.at(-1).id));
  p.data.songName = 'After resume'; p.emit();
  assert.equal(w.elements.get('songName').textContent, 'After resume');
});

test('iCUE handles literal text, unsafe artwork, decode failure, and lexical color settings', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const p = mediaProvider({songName:'<img src=x onerror=alert(1)>', thumbnail:'https://example.com/art.png'}), w = widget(p);
  assert.equal(w.elements.get('songName').textContent, p.data.songName);
  assert.equal(w.elements.get('albumArt').getAttribute('src'), null);
  p.data.thumbnail = png; p.emit();
  w.elements.get('albumArt').fire('error');
  p.emit('isPlaying');
  assert.equal(w.elements.get('albumArt').hidden, true);
  assert.equal(w.elements.get('coverPlaceholder').hidden, false);
  w.run('let accentColor = "#abcdef"; let backgroundColor = "#012345"; window.icueEvents.onDataUpdated()');
  assert.equal(w.styles.get('--accent'), '#abcdef');
  w.run('accentColor = "url(https://example.com)"; window.icueEvents.onDataUpdated()');
  assert.equal(w.styles.get('--accent'), '#abcdef');
});

test('iCUE command exceptions show a recoverable error without optimistic playback changes', async () => {
  const p = mediaProvider(), w = widget(p);
  p.media.triggerPlayPause = () => { throw new Error('Host unavailable'); };
  w.click('playPauseButton');
  assert.equal(w.elements.get('statusText').textContent, '操作に失敗しました');
  await w.flush();
  assert.equal(w.elements.get('statusText').textContent, '操作に失敗しました');
  await w.flush(2500);
  assert.equal(w.elements.get('statusText').textContent, '再生中');
});

test('iCUE browser demo cannot replace a real injected media provider', () => {
  const provider = {};
  const window = {plugins:{Mediadataprovider:provider}, __EDGE_DEMO_OVERRIDE__:true};
  vm.runInNewContext(readFileSync(new URL('../icue-widget/scripts/demo-provider.js', import.meta.url), 'utf8'), {window});
  assert.equal(window.plugins.Mediadataprovider, provider);
});
