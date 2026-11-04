import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../icue-widget/scripts/widget.js', import.meta.url), 'utf8');
export const keys = ['songName', 'artist', 'album', 'thumbnail', 'isPlaying'];
export function signal() {
  const listeners = new Set();
  return {
    connect:callback => listeners.add(callback),
    disconnect:callback => listeners.delete(callback),
    emit(...args) { for (const callback of [...listeners]) callback(...args); },
    get size() { return listeners.size; },
  };
}

export function mediaProvider(values = {}, {asyncOnly = false, autoRespond = true} = {}) {
  const data = {songName:'Track A', artist:'Artist', album:'Album', thumbnail:'', isPlaying:true, ...values};
  const calls = [], requests = [];
  const media = {asyncResponse:signal()};
  for (const key of keys) {
    media[key + 'Changed'] = signal();
    if (!asyncOnly) Object.defineProperty(media, key, {get:() => data[key]});
  }
  for (const [key, method] of Object.entries({songName:'getSongName', artist:'getArtist', album:'getAlbum',
    thumbnail:'getThumbnail', isPlaying:'getIsPlaying'})) {
    media[method] = id => {
      requests.push({id, key, value:data[key]});
      if (autoRespond) media.asyncResponse.emit(id, data[key]);
    };
  }
  for (const method of ['triggerPreviousTrack', 'triggerPlayPause', 'triggerNextTrack']) {
    media[method] = () => calls.push(method);
  }
  return {media, data, calls, requests, emit:(key = 'songName') => media[key + 'Changed'].emit()};
}

export function widget(provider) {
  const elements = new Map();
  for (const id of ['deck', 'songName', 'artist', 'album', 'albumArt', 'coverPlaceholder', 'cover', 'statusText',
    'playPauseButton', 'previousButton', 'nextButton', 'playbackStatus', 'appIcon', 'mediaTargetField',
    'audioTargetField', 'seekLabel', 'seekRange', 'positionText', 'volumeSlider', 'volumeText', 'muteButton',
    'rewindButton', 'stopButton', 'forwardButton', 'bridgeNotice', 'brandLabel', 'footerBrand']) {
    const attributes = new Map(), listeners = new Map(), children = new Map();
    elements.set(id, {
      dataset:{}, hidden:false, disabled:false, textContent:'', title:'',
      setAttribute:(name, value) => attributes.set(name, value),
      getAttribute:name => attributes.get(name) ?? null,
      removeAttribute:name => attributes.delete(name),
      set src(value) { attributes.set('src', value); },
      querySelector(selector) {
        if (!children.has(selector)) children.set(selector, {toggleAttribute(name, value) { this[name] = value; }});
        return children.get(selector);
      },
      addEventListener:(event, callback) => listeners.set(event, callback),
      fire(event) { listeners.get(event)?.(); },
    });
  }
  const timers = new Map(), intervals = new Map(), windowEvents = new Map(), documentEvents = new Map(), styles = new Map();
  let nextTimer = 0;
  const document = {
    visibilityState:'visible', documentElement:{dataset:{}, style:{setProperty:(key, value) => styles.set(key, value)}},
    getElementById:id => elements.get(id),
    addEventListener:(event, callback) => documentEvents.set(event, callback),
  };
  const window = {
    plugins:provider ? {Mediadataprovider:provider.media} : {},
    addEventListener:(event, callback) => windowEvents.set(event, callback),
  };
  const context = vm.createContext({window, document,
    getComputedStyle(node) { return {display:node.dataset.displayHidden === 'true' ? 'none' : node === elements.get('cover') ? styles.get('--art-display') ?? 'block'
      : node === elements.get('album') ? styles.get('--album-display') ?? 'block' : 'block'}; },
    setTimeout(callback, delay) { timers.set(++nextTimer, {callback, delay}); return nextTimer; },
    clearTimeout:id => timers.delete(id),
    setInterval(callback) { intervals.set(++nextTimer, callback); return nextTimer; },
    clearInterval:id => intervals.delete(id),
  });
  vm.runInContext(source, context);
  return {elements, window, document, timers, intervals, styles,
    run:code => vm.runInContext(code, context),
    event:name => windowEvents.get(name)?.(),
    visibility(value) { document.visibilityState = value; documentEvents.get('visibilitychange')(); },
    click:id => elements.get(id).fire('click'),
    async flush(delay = 100) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay === delay && timers.delete(id)) timer.callback();
      }
      await Promise.resolve(); await Promise.resolve();
    },
  };
}
