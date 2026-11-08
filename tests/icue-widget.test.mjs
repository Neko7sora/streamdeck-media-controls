import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {widget, mediaProvider, keys} from './icue-harness.mjs';

test('iCUE compacts spacing only when every text size is reduced and restores it on updates', () => {
  const w = widget(mediaProvider());
  assert.equal(w.document.documentElement.dataset.smallText, 'false');
  w.run('let titleSize=75, artistSize=75, albumSize=75, labelSize=75; window.icueEvents.onDataUpdated()');
  assert.equal(w.document.documentElement.dataset.smallText, 'true');
  assert.equal(w.document.documentElement.dataset.largeText, 'false');
  w.run('titleSize=150; window.icueEvents.onDataUpdated()');
  assert.equal(w.document.documentElement.dataset.smallText, 'false');
  assert.equal(w.document.documentElement.dataset.largeText, 'true');
  w.run('titleSize=75; labelSize=NaN; window.icueEvents.onDataUpdated()');
  assert.equal(w.document.documentElement.dataset.smallText, 'false');
});

test('iCUE display preferences read late lexical properties and keep updating hidden metadata', () => {
  const p = mediaProvider(), w = widget(p);
  assert.equal(w.elements.get('artist').dataset.displayHidden, 'false');
  assert.equal(w.styles.get('--title-scale'), '1');
  w.run('let showTitle = false, showArtist = false, showPlayPause = false, showSeekBar = false; let titleSize = 150, artistSize = 75; window.icueEvents.onDataUpdated()');
  for (const id of ['songName','artist','playPauseButton','seekLabel','seekRange']) {
    assert.equal(w.elements.get(id).dataset.displayHidden, 'true', id);
  }
  assert.equal(w.styles.get('--title-scale'), '1.5');
  assert.equal(w.styles.get('--artist-scale'), '0.75');
  p.data.songName = 'New track'; p.data.artist = 'New artist'; p.emit();
  w.run('showTitle = true; showArtist = true; showPlayPause = true; window.icueEvents.onDataUpdated()');
  assert.equal(w.elements.get('artist').textContent, 'New artist');
  assert.equal(w.elements.get('songName').textContent, 'New track');
  assert.equal(w.elements.get('playPauseButton').dataset.displayHidden, 'false');
  w.click('playPauseButton');
  assert.deepEqual(p.calls, ['triggerPlayPause']);
  w.run('titleSize = Infinity; artistSize = -40; let albumSize = 999, labelSize = "150"; window.icueEvents.onDataUpdated()');
  assert.equal(w.styles.get('--title-scale'), '1');
  assert.equal(w.styles.get('--artist-scale'), '0.75');
  assert.equal(w.styles.get('--album-scale'), '1.5');
  assert.equal(w.styles.get('--label-scale'), '1');
});

test('iCUE uses proportional host styling on late initialization for preview and device', () => {
  const w = widget();
  assert.equal(w.document.documentElement.dataset.icueSurface, undefined);
  w.run('let iCUE = {isPreview:true}; window.icueEvents.onICUEInitialized()');
  assert.equal(w.document.documentElement.dataset.icueSurface, 'preview');
  w.run('iCUE.isPreview = false; window.icueEvents.onDataUpdated()');
  assert.equal(w.document.documentElement.dataset.icueSurface, 'device');
});

test('iCUE distinguishes explicit title scrolling from the default OS motion preference', () => {
  const w = widget(mediaProvider()), song = w.elements.get('songName');
  assert.equal(song.dataset.scroll, 'true');
  assert.equal(song.dataset.scrollExplicit, 'false');
  w.run('let scrollTitle = true; window.icueEvents.onDataUpdated()');
  assert.equal(song.dataset.scroll, 'true');
  assert.equal(song.dataset.scrollExplicit, 'true');
  w.run('scrollTitle = false; window.icueEvents.onDataUpdated()');
  assert.equal(song.dataset.scroll, 'false');
  assert.equal(song.dataset.scrollExplicit, 'false');
});

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
  assert.equal(w.elements.get('songName').textContent, '再生中のメディアはありません');
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
  assert.equal(w.elements.get('songName').textContent, 'メディア情報を取得できません');
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

test('iCUE periodically discovers, replaces and loses providers without host events', async () => {
  const w = widget(), p = mediaProvider();
  w.window.plugins.Mediadataprovider = p.media;
  for (const tick of [...w.intervals.values()]) tick();
  await w.flush();
  assert.equal(w.elements.get('songName').textContent, 'Track A');
  const replacement = mediaProvider({songName:'Replacement'});
  w.window.plugins.Mediadataprovider = replacement.media;
  for (const tick of [...w.intervals.values()]) tick();
  assert.equal(w.elements.get('songName').textContent, 'Replacement');
  assert.equal(p.media.songNameChanged.size, 0);
  assert.equal(replacement.media.songNameChanged.size, 1);
  delete w.window.plugins.Mediadataprovider;
  for (const tick of [...w.intervals.values()]) tick();
  assert.equal(w.elements.get('statusText').textContent, 'iCUEメディアを待機中');
  assert.equal(w.elements.get('playPauseButton').disabled, true);
  assert.equal(replacement.media.songNameChanged.size, 0);
  assert.equal(w.intervals.size, 1);
});

test('iCUE hides cancel requests and subscriptions, then visible resumes only once', async () => {
  const p = mediaProvider({}, {autoRespond:false}), w = widget(p);
  await w.flush();
  const old = [...p.requests];
  w.visibility('hidden');
  assert.equal(w.timers.size, 0);
  assert.equal(w.intervals.size, 0);
  assert.equal(p.media.asyncResponse.size, 0);
  for (const r of old) p.media.asyncResponse.emit(r.id, r.value);
  assert.equal(w.elements.get('playPauseButton').disabled, true);
  p.data.songName = 'Resumed';
  w.visibility('visible'); w.event('pageshow');
  assert.equal(w.elements.get('songName').textContent, 'Resumed');
  assert.equal(w.intervals.size, 1);
  assert.equal(p.media.songNameChanged.size, 1);
});

test('iCUE shows loading and unavailable states for async-only timeouts, then recovers', async () => {
  const p = mediaProvider({}, {asyncOnly:true, autoRespond:false}), w = widget(p);
  assert.equal(w.elements.get('deck').dataset.status, 'loading');
  await w.flush(); await w.flush(3500);
  assert.equal(w.elements.get('deck').dataset.status, 'error');
  assert.equal(w.elements.get('playPauseButton').disabled, true);
  for (const tick of [...w.intervals.values()]) tick();
  for (const r of p.requests.slice(-5)) p.media.asyncResponse.emit(r.id, r.value);
  await w.flush();
  assert.equal(w.elements.get('statusText').textContent, '再生中');
  assert.equal(w.elements.get('playPauseButton').disabled, false);
});

test('iCUE timeout fallback reads current properties and rejects stale successful snapshots', async () => {
  const p = mediaProvider({}, {autoRespond:false}), w = widget(p);
  await w.flush();
  p.data.songName = 'New while waiting';
  p.data.artist = 'New artist';
  await w.flush(3500);
  assert.equal(w.elements.get('songName').textContent, 'New while waiting');
  assert.equal(w.elements.get('artist').textContent, 'New artist');
  for (const tick of [...w.intervals.values()]) tick();
  const stale = p.requests.slice(-5);
  p.data.songName = 'Unannounced change';
  for (const r of stale) p.media.asyncResponse.emit(r.id, r.value);
  await w.flush();
  assert.equal(w.elements.get('songName').textContent, 'Unannounced change');
  w.click('playPauseButton');
  assert.equal(p.calls.length, 1);
});

test('iCUE a destroyed provider cannot throw from rendering or enable commands', async () => {
  let destroyed = false;
  const p = mediaProvider();
  const media = new Proxy(p.media, {get(target, key) {
    if (destroyed) throw new Error('Qt object deleted');
    return Reflect.get(target, key);
  }});
  const w = widget({media});
  await w.flush();
  destroyed = true;
  for (const tick of [...w.intervals.values()]) tick();
  await w.flush();
  assert.equal(w.elements.get('deck').dataset.status, 'error');
  assert.equal(w.elements.get('playPauseButton').disabled, true);
  w.window.plugins.Mediadataprovider = p.media;
  for (const tick of [...w.intervals.values()]) tick();
  assert.equal(w.elements.get('songName').textContent, 'Track A');
});

test('iCUE personalization keeps old IDs and accepts only bounded typed values', () => {
  const w = widget(mediaProvider());
  w.run('let textColor = "#fedcba"; let transparency = 75; let showArtwork = false; let showAlbum = false; let accentColor = "#000000"; window.icueEvents.onDataUpdated()');
  assert.equal(w.styles.get('--ink'), '#fedcba');
  assert.equal(w.styles.get('--background-opacity'), '0.25');
  assert.equal(w.styles.get('--art-display'), 'none');
  assert.equal(w.styles.get('--album-display'), 'none');
  assert.equal(w.styles.get('--accent-ink'), '#ffffff');
  w.run('transparency = 150; textColor = "red; background:url(https://example.com)"; window.icueEvents.onDataUpdated()');
  assert.equal(w.styles.get('--background-opacity'), '0');
  assert.equal(w.styles.get('--ink'), '#fedcba');
  w.run('transparency = NaN; showArtwork = true; showAlbum = true; accentColor = "#ffffff"; window.icueEvents.onDataUpdated()');
  assert.equal(w.styles.get('--background-opacity'), '0');
  assert.equal(w.styles.get('--accent-ink'), '#000000');
  assert.equal(w.elements.get('album').textContent, 'Album');
});
