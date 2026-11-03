/* Edge Media Deck: documented iCUE Media Data Provider 1.1 APIs only. */
(function () {
  "use strict";

  const el = Object.fromEntries(Object.entries({
    deck: "deck", song: "songName", artist: "artist", album: "album",
    art: "albumArt", artPlaceholder: "coverPlaceholder", cover: "cover", status: "statusText",
    play: "playPauseButton", previous: "previousButton", next: "nextButton",
  }).map(([key, id]) => [key, document.getElementById(id)]));
  const fields = [
    ["songName", "getSongName"], ["artist", "getArtist"], ["album", "getAlbum"],
    ["thumbnail", "getThumbnail"], ["isPlaying", "getIsPlaying"],
  ];
  const controls = [
    [el.previous, "triggerPreviousTrack"], [el.play, "triggerPlayPause"],
    [el.next, "triggerNextTrack"],
  ];
  const emptyState = () => ({ songName: "", artist: "", album: "", thumbnail: "", isPlaying: null });
  let state = emptyState();
  let plugin = null;
  let bridge = null;
  let connections = [];
  let binding = 0;
  let generation = 0;
  let suspended = false;
  let refreshTimer = null;
  let pollTimer = null;
  let errorTimer = null;
  let failedArtwork = "";
  let commandError = false;
  let loading = false;
  let readError = false;
  // Keep IDs unique across host reconnections so delayed responses cannot cross bindings.
  let nextRequestId = 1;

  function setStatus(value, label) {
    el.deck.dataset.status = value;
    el.status.textContent = label;
  }

  function updateAppearance() {
    window.edgeMediaBridge?.configure();
    // Both iCUE surfaces use proportional tokens: a mimic can have a smaller CSS viewport.
    const preview = setting(() => iCUE.isPreview);
    if (typeof preview === "boolean") document.documentElement.dataset.icueSurface = preview ? "preview" : "device";
    else delete document.documentElement.dataset.icueSurface;
    // iCUE can expose property globals as lexical bindings rather than window properties.
    const accent = setting(() => accentColor);
    const background = setting(() => backgroundColor);
    const ink = setting(() => textColor);
    const transparent = setting(() => transparency);
    const artwork = setting(() => showArtwork);
    const album = setting(() => showAlbum);
    el.song.dataset.scroll = setting(() => scrollTitle) === false ? "false" : "true";
    for (const [property, value] of [["--accent", accent], ["--base", background], ["--ink", ink]]) {
      if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) {
        document.documentElement.style.setProperty(property, value);
        if (property === "--accent") {
          const [r, g, b] = value.slice(1).match(/../g).map(hex => {
            const channel = parseInt(hex, 16) / 255;
            return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
          });
          document.documentElement.style.setProperty("--accent-ink", .2126 * r + .7152 * g + .0722 * b > .179 ? "#000000" : "#ffffff");
        }
      }
    }
    if (typeof transparent === "number" && Number.isFinite(transparent)) {
      document.documentElement.style.setProperty("--background-opacity", String(1 - Math.min(100, Math.max(0, transparent)) / 100));
    }
    document.documentElement.style.setProperty("--art-display", artwork === false ? "none" : "block");
    document.documentElement.style.setProperty("--album-display", album === false ? "none" : "block");
  }

  function setting(getValue) {
    // Resolve on every update, including globals injected after the initial render.
    try { return getValue(); } catch { return undefined; }
  }

  function setText(element, value, fallback) {
    const content = element === el.song ? document.getElementById("songTitleText") || element : element;
    const text = value || fallback;
    if (content.textContent !== text) content.textContent = text;
    element.title = text;
  }

  function updateScrolling() {
    const content = document.getElementById("songTitleText");
    if (!content) return;
    const distance = Math.max(0, content.getBoundingClientRect().width - el.song.getBoundingClientRect().width);
    el.song.dataset.overflow = distance > 1 ? "true" : "false";
    el.song.style.setProperty("--title-overflow", `${distance}px`);
    el.song.style.setProperty("--title-duration", `${Math.max(12, distance / 30 + 6)}s`);
  }

  function validArtwork(value) {
    return typeof value === "string" && value.length <= 12_000_000 &&
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value);
  }

  function normalize(values) {
    return Object.fromEntries(fields.map(([key], index) => [key, key === "isPlaying"
      ? (typeof values[index] === "boolean" ? values[index] : null)
      : (typeof values[index] === "string" ? values[index].trim() : "")]));
  }

  function read(object, key) {
    try { return object?.[key]; } catch { return undefined; }
  }

  function currentProvider() {
    if (window.edgeMediaBridge?.enabled) return window.edgeMediaBridge.provider;
    return read(read(window, "plugins"), "Mediadataprovider") || null;
  }

  function property(key) {
    return read(plugin, key);
  }

  function render() {
    const hasTrack = Boolean(state.songName);
    setText(el.song, state.songName, loading ? "メディア情報を取得中" : readError ? "メディア情報を取得できません" : plugin ? "再生中の曲はありません" : "メディアを待機中");
    setText(el.artist, state.artist, hasTrack ? "アーティスト不明" : !plugin || readError
      ? "iCUEの接続を確認してください・自動的に再試行します" : loading ? "しばらくお待ちください" : "メディアプレーヤーで曲を再生してください");
    if (getComputedStyle(el.album).display !== "none") setText(el.album, state.album, "");

    const artwork = hasTrack && validArtwork(state.thumbnail) ? state.thumbnail : "";
    if (getComputedStyle(el.cover).display === "none") {
      el.art.removeAttribute("src");
      el.art.hidden = true;
      el.artPlaceholder.hidden = false;
    } else if (artwork && artwork !== failedArtwork) {
      if (el.art.getAttribute("src") !== artwork) el.art.src = artwork;
      el.art.hidden = false;
      el.artPlaceholder.hidden = true;
    } else {
      el.art.removeAttribute("src");
      el.art.hidden = true;
      el.artPlaceholder.hidden = false;
    }
    if (!artwork) failedArtwork = "";

    if (commandError) setStatus("error", "操作に失敗しました");
    else if (!plugin) setStatus("waiting", "iCUEメディアを待機中");
    else if (loading) setStatus("loading", "メディア情報を取得中");
    else if (readError) setStatus("error", "iCUE接続を確認してください");
    else if (!hasTrack) setStatus("idle", "再生待ち");
    else if (state.isPlaying === null) setStatus("idle", "再生状態不明");
    else if (state.isPlaying) setStatus("playing", "再生中");
    else setStatus("paused", "一時停止");
    if (window.edgeMediaBridge?.enabled && !plugin) {
      setStatus("waiting", window.edgeMediaBridge.message);
      setText(el.song, "", "Windowsブリッジに接続してください");
      setText(el.artist, "", "ブリッジの起動・接続トークン・iCUEの権限を確認してください");
    }

    // SVGElement.hidden is not a reflected boolean property in Qt/Chromium.
    el.play.querySelector(".icon-play").toggleAttribute("hidden", state.isPlaying === true);
    el.play.querySelector(".icon-pause").toggleAttribute("hidden", state.isPlaying !== true);
    const label = state.isPlaying === null ? "再生／一時停止" : state.isPlaying ? "一時停止" : "再生";
    el.play.setAttribute("aria-label", label);
    el.play.title = label;
    for (const [button, method] of controls) {
      button.disabled = suspended || !hasTrack || typeof property(method) !== "function";
    }
    updateScrolling();
  }

  function connect(signal, callback) {
    if (!signal || typeof signal.connect !== "function") return false;
    try { signal.connect(callback); } catch { return false; }
    connections.push(() => {
      if (typeof signal.disconnect === "function") signal.disconnect(callback);
    });
    return true;
  }

  function createRequestBridge(media) {
    const pending = new Map();
    const supported = connect(read(media, "asyncResponse"), (requestId, value) => {
      const entry = pending.get(Number(requestId));
      if (!entry) return;
      clearTimeout(entry.timeout);
      pending.delete(Number(requestId));
      entry.resolve(value);
    });
    return {
      cancel() {
        for (const entry of pending.values()) {
          clearTimeout(entry.timeout);
          entry.resolve(undefined);
        }
        pending.clear();
      },
      request(method, fallback) {
        const invoke = read(media, method);
        if (!supported || typeof invoke !== "function") return Promise.resolve(fallback());
        return new Promise(resolve => {
          const requestId = nextRequestId++;
          const timeout = setTimeout(() => {
            pending.delete(requestId);
            resolve(fallback());
          }, 3500);
          pending.set(requestId, { resolve, timeout });
          try { invoke.call(media, requestId); }
          catch {
            clearTimeout(timeout);
            pending.delete(requestId);
            resolve(fallback());
          }
        });
      },
    };
  }

  async function refresh() {
    if (!plugin || !bridge || suspended) return;
    const current = ++generation;
    bridge.cancel();
    const media = plugin;
    const values = await Promise.all(fields.map(([key, method]) => bridge.request(method, () => read(media, key))));
    if (current !== generation || suspended) return;
    if (currentProvider() !== media) { initializeMedia(); return; }
    // A provider may change properties without delivering a change signal while requests run.
    if (fields.some(([key], index) => {
      const value = property(key);
      return value !== undefined && value !== values[index];
    })) { scheduleRefresh(); return; }
    state = normalize(values);
    loading = false;
    readError = values.every(value => value === undefined);
    render();
  }

  function scheduleRefresh() {
    if (!plugin || suspended) return;
    ++generation;
    bridge.cancel();
    // Never reuse metadata from the previous track when fields disappear.
    const values = fields.map(([key]) => property(key));
    state = normalize(values);
    loading = values.every(value => value === undefined);
    readError = false;
    render();
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 100);
  }

  function detach() {
    ++binding;
    ++generation;
    clearTimeout(refreshTimer);
    clearTimeout(errorTimer);
    bridge?.cancel();
    for (const disconnect of connections) {
      try { disconnect(); } catch { /* The host may already have destroyed the Qt object. */ }
    }
    connections = [];
    bridge = null;
    plugin = null;
    commandError = false;
    loading = false;
    readError = false;
    state = emptyState();
  }

  function initializeMedia() {
    if (suspended) return false;
    const media = currentProvider();
    if (plugin === media) return false;
    detach();
    if (media) {
      plugin = media;
      bridge = createRequestBridge(media);
      const currentBinding = binding;
      for (const [key] of fields) {
        connect(read(media, key + "Changed"), () => {
          if (currentBinding === binding && !suspended) scheduleRefresh();
        });
      }
      scheduleRefresh();
    }
    render();
    return true;
  }

  function resume() {
    if (document.visibilityState === "hidden") return;
    suspended = false;
    window.edgeMediaBridge?.resume();
    updateAppearance();
    if (!initializeMedia()) scheduleRefresh();
    // Also recover missing/replaced providers when the host misses an initialization event.
    if (pollTimer === null) pollTimer = setInterval(() => {
      if (!initializeMedia()) refresh();
    }, 20000);
    render();
  }

  function suspend() {
    suspended = true;
    window.edgeMediaBridge?.suspend();
    clearInterval(pollTimer);
    pollTimer = null;
    detach();
    render();
  }

  function action(button, method) {
    if (button.disabled || suspended || !plugin || typeof property(method) !== "function") return;
    // If the host replaced the provider, refresh the display before accepting another action.
    if (currentProvider() !== plugin) { initializeMedia(); return; }
    for (const key of ["songName", "artist", "album"]) {
      const value = property(key);
      if (typeof value === "string" && value.trim() !== state[key]) { scheduleRefresh(); return; }
    }
    const activeBinding = binding;
    const success = () => {
      if (activeBinding !== binding || suspended) return;
      commandError = false;
      clearTimeout(errorTimer);
      scheduleRefresh();
    };
    const failure = () => {
      if (activeBinding !== binding || suspended) return;
      commandError = true;
      render();
      clearTimeout(errorTimer);
      errorTimer = setTimeout(() => { commandError = false; render(); }, 2500);
    };
    try {
      const result = plugin[method]();
      if (result && typeof result.then === "function") result.then(success, failure);
      else success();
    } catch { failure(); }
  }

  for (const [button, method] of controls) button.addEventListener("click", () => action(button, method));
  el.art.addEventListener("error", () => {
    failedArtwork = el.art.getAttribute("src") || "";
    el.art.hidden = true;
    el.artPlaceholder.hidden = false;
    window.edgeMediaBridge?.artworkFailed(failedArtwork);
  });
  window.icueEvents = {
    onICUEInitialized() { updateAppearance(); initializeMedia(); },
    onDataUpdated() { updateAppearance(); initializeMedia(); render(); },
  };
  window.pluginMediadataproviderEvents = { onInitialized() { initializeMedia(); render(); } };
  // iCUE's evaluated scripts can have host-local event bindings as well as window.
  try { icueEvents = window.icueEvents; } catch { /* Plain browser without host bindings. */ }
  try { pluginMediadataproviderEvents = window.pluginMediadataproviderEvents; } catch { /* Plain browser. */ }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") suspend();
    else resume();
  });
  window.addEventListener("pagehide", suspend);
  window.addEventListener("pageshow", resume);
  window.addEventListener("resize", render);
  if (typeof ResizeObserver !== "undefined" && document.getElementById("songTitleText")) {
    const observer = new ResizeObserver(updateScrolling);
    observer.observe(el.song); observer.observe(document.getElementById("songTitleText"));
    window.addEventListener("pagehide", () => observer.disconnect());
    window.addEventListener("pageshow", () => {observer.observe(el.song); observer.observe(document.getElementById("songTitleText"));});
  }

  updateAppearance();
  render();
  if (document.visibilityState === "hidden") suspend();
  else resume();
})();
