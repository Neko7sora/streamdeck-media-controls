/* Edge Media Deck: documented iCUE Media Data Provider 1.1 APIs only. */
(function () {
  "use strict";

  const el = Object.fromEntries(Object.entries({
    deck: "deck", song: "songName", artist: "artist", album: "album",
    art: "albumArt", artPlaceholder: "coverPlaceholder", status: "statusText",
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
  // Keep IDs unique across host reconnections so delayed responses cannot cross bindings.
  let nextRequestId = 1;

  function setStatus(value, label) {
    el.deck.dataset.status = value;
    el.status.textContent = label;
  }

  function updateAppearance() {
    // iCUE can expose property globals as lexical bindings rather than window properties.
    const accent = typeof accentColor === "undefined" ? null : accentColor;
    const background = typeof backgroundColor === "undefined" ? null : backgroundColor;
    for (const [property, value] of [["--accent", accent], ["--base", background]]) {
      if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) {
        document.documentElement.style.setProperty(property, value);
      }
    }
  }

  function setText(element, value, fallback) {
    element.textContent = value || fallback;
    element.title = element.textContent;
  }

  function validArtwork(value) {
    return typeof value === "string" && value.length <= 12_000_000 &&
      /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
  }

  function normalize(values) {
    return Object.fromEntries(fields.map(([key], index) => [key, key === "isPlaying"
      ? (typeof values[index] === "boolean" ? values[index] : null)
      : (typeof values[index] === "string" ? values[index].trim() : "")]));
  }

  function property(key) {
    try { return plugin?.[key]; } catch { return undefined; }
  }

  function render() {
    const hasTrack = Boolean(state.songName);
    setText(el.song, state.songName, plugin ? "再生中の曲はありません" : "メディアを待機中");
    setText(el.artist, state.artist, hasTrack ? "アーティスト不明" : "メディアプレーヤーで曲を再生してください");
    setText(el.album, state.album, "");

    const artwork = hasTrack && validArtwork(state.thumbnail) ? state.thumbnail : "";
    if (artwork && artwork !== failedArtwork) {
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
    else if (!hasTrack) setStatus("idle", "再生待ち");
    else if (state.isPlaying === null) setStatus("idle", "再生状態不明");
    else if (state.isPlaying) setStatus("playing", "再生中");
    else setStatus("paused", "一時停止");

    // SVGElement.hidden is not a reflected boolean property in Qt/Chromium.
    el.play.querySelector(".icon-play").toggleAttribute("hidden", state.isPlaying === true);
    el.play.querySelector(".icon-pause").toggleAttribute("hidden", state.isPlaying !== true);
    const label = state.isPlaying === null ? "再生／一時停止" : state.isPlaying ? "一時停止" : "再生";
    el.play.setAttribute("aria-label", label);
    el.play.title = label;
    for (const [button, method] of controls) {
      button.disabled = suspended || !hasTrack || typeof plugin?.[method] !== "function";
    }
  }

  function connect(signal, callback) {
    if (!signal || typeof signal.connect !== "function") return false;
    signal.connect(callback);
    connections.push(() => {
      if (typeof signal.disconnect === "function") signal.disconnect(callback);
    });
    return true;
  }

  function createRequestBridge(media) {
    const pending = new Map();
    const supported = connect(media.asyncResponse, (requestId, value) => {
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
        if (!supported || typeof media[method] !== "function") return Promise.resolve(fallback);
        return new Promise(resolve => {
          const requestId = nextRequestId++;
          const timeout = setTimeout(() => {
            pending.delete(requestId);
            resolve(fallback);
          }, 3500);
          pending.set(requestId, { resolve, timeout });
          try { media[method](requestId); }
          catch {
            clearTimeout(timeout);
            pending.delete(requestId);
            resolve(fallback);
          }
        });
      },
    };
  }

  async function refresh() {
    if (!plugin || !bridge || suspended) return;
    const current = ++generation;
    bridge.cancel();
    const values = await Promise.all(fields.map(([key, method]) => bridge.request(method, property(key))));
    if (current !== generation || suspended) return;
    state = normalize(values);
    render();
  }

  function scheduleRefresh() {
    if (!plugin || suspended) return;
    ++generation;
    bridge.cancel();
    // Never reuse metadata from the previous track when fields disappear.
    state = normalize(fields.map(([key]) => property(key)));
    render();
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 100);
  }

  function detach() {
    ++binding;
    ++generation;
    clearTimeout(refreshTimer);
    clearTimeout(errorTimer);
    clearInterval(pollTimer);
    bridge?.cancel();
    for (const disconnect of connections) {
      try { disconnect(); } catch { /* The host may already have destroyed the Qt object. */ }
    }
    connections = [];
    bridge = null;
    plugin = null;
    commandError = false;
    state = emptyState();
  }

  function initializeMedia() {
    if (suspended) return;
    const media = window.plugins?.Mediadataprovider;
    if (plugin === media) return;
    detach();
    if (media) {
      plugin = media;
      bridge = createRequestBridge(media);
      const currentBinding = binding;
      for (const [key] of fields) {
        connect(media[key + "Changed"], () => {
          if (currentBinding === binding && !suspended) scheduleRefresh();
        });
      }
      scheduleRefresh();
      pollTimer = setInterval(() => {
        if (document.visibilityState !== "hidden") refresh();
      }, 20000);
    }
    render();
  }

  function action(button, method) {
    if (button.disabled || suspended || !plugin || typeof plugin[method] !== "function") return;
    // If the host replaced the provider, refresh the display before accepting another action.
    if (window.plugins?.Mediadataprovider !== plugin) { initializeMedia(); return; }
    for (const key of ["songName", "artist", "album"]) {
      const value = property(key);
      if (typeof value === "string" && value.trim() !== state[key]) { scheduleRefresh(); return; }
    }
    try {
      plugin[method]();
      commandError = false;
      clearTimeout(errorTimer);
      scheduleRefresh();
    } catch {
      commandError = true;
      render();
      clearTimeout(errorTimer);
      errorTimer = setTimeout(() => { commandError = false; render(); }, 2500);
    }
  }

  for (const [button, method] of controls) button.addEventListener("click", () => action(button, method));
  el.art.addEventListener("error", () => {
    failedArtwork = el.art.getAttribute("src") || "";
    el.art.hidden = true;
    el.artPlaceholder.hidden = false;
  });
  window.icueEvents = {
    onICUEInitialized() { updateAppearance(); initializeMedia(); },
    onDataUpdated: updateAppearance,
  };
  window.pluginMediadataproviderEvents = { onInitialized: initializeMedia };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") { initializeMedia(); scheduleRefresh(); }
  });
  window.addEventListener("pagehide", () => { suspended = true; detach(); render(); });
  window.addEventListener("pageshow", () => { suspended = false; updateAppearance(); initializeMedia(); });

  updateAppearance();
  render();
  initializeMedia();
})();
