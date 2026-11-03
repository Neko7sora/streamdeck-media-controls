/* Independent Windows bridge. Tokens stay in iCUE settings, never in URLs/storage/logs. */
(function () {
  "use strict";
  const endpoint = "https://127.0.0.1:39762";
  const ids = ["bridgePanel", "mediaTarget", "audioTarget", "seekRange", "positionText", "volumeRange", "volumeText",
    "muteButton", "rewindButton", "stopButton", "forwardButton", "bridgeNotice"];
  const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  const appIcon = document.getElementById("appIcon");
  let fallbackIcon = "";
  appIcon.addEventListener("error", () => {
    if (fallbackIcon && appIcon.getAttribute("src") !== fallbackIcon) appIcon.src = fallbackIcon;
    else {appIcon.hidden = true; appIcon.removeAttribute("src");}
  });
  let token = "", data = null, stream = null, retry = null, watchdog = null, tick = null, suspended = false;
  let mediaTarget = "auto", audioTarget = "master", busy = false, commandController = null;
  let persistenceKey = "", lastTrack = "", errorUntil = 0, failedArtwork = "";
  const gestures = new Map();
  const setting = read => {try {return read();} catch {return undefined;}};
  const api = window.edgeMediaBridge = {enabled: false, provider: null, message: "Windowsブリッジを待機中", configure, resume, suspend};
  api.artworkFailed = source => {
    failedArtwork = source;
    const fallback = data?.media?.fallback_artwork_data_url;
    if (api.enabled && api.provider && fallback && fallback !== source) {
      api.provider = {...api.provider, thumbnail: fallback}; notify();
    }
  };
  function notify() {window.pluginMediadataproviderEvents?.onInitialized();}
  function notice(text) {if (el.bridgeNotice.textContent !== text) el.bridgeNotice.textContent = text;}
  function saveTargets() {
    if (!persistenceKey) return;
    try {localStorage.setItem(persistenceKey, JSON.stringify({mediaTarget, audioTarget}));} catch { /* Host can disable storage. */ }
  }
  function configure() {
    const instance = setting(() => uniqueId);
    if (!persistenceKey && typeof instance === "string" && instance.length < 200) {
      persistenceKey = `edge-media-deck:${instance}:targets`;
      try {
        const saved = JSON.parse(localStorage.getItem(persistenceKey));
        if (typeof saved?.mediaTarget === "string" && saved.mediaTarget.length <= 2000) mediaTarget = saved.mediaTarget;
        if (typeof saved?.audioTarget === "string" && saved.audioTarget.length <= 2000) audioTarget = saved.audioTarget;
      } catch { /* Only non-sensitive target choices are persisted. */ }
    }
    const explicit = setting(() => useBridge);
    const demo = new URLSearchParams(location.search).get("demo") === "1" || window.__EDGE_DEMO_OVERRIDE__;
    const enabled = typeof explicit === "boolean" ? explicit : !demo && !window.plugins?.Mediadataprovider;
    const configured = setting(() => bridgeToken);
    const nextToken = typeof configured === "string" ? configured.trim() : "";
    if (api.enabled === enabled && token === nextToken) return;
    api.enabled = enabled; token = nextToken;
    el.bridgePanel.hidden = !enabled;
    document.getElementById("bridgeExtra").hidden = !enabled;
    document.documentElement.dataset.bridge = String(enabled);
    restart();
  }
  function reset() {
    data = null; api.provider = null; gestures.clear(); lastTrack = "";
    for (const id of ["mediaTarget", "audioTarget", "seekRange", "volumeRange", "muteButton", "rewindButton", "forwardButton", "stopButton"]) el[id].disabled = true;
    el.positionText.textContent = "--:-- / --:--"; el.volumeText.textContent = "--%";
    el.muteButton.removeAttribute("aria-pressed");
    appIcon.hidden = true; appIcon.removeAttribute("src"); fallbackIcon = "";
  }
  function disconnect() {
    clearTimeout(retry); clearTimeout(watchdog); clearInterval(tick);
    retry = watchdog = tick = null;
    const old = stream; stream = null; old?.abort();
    commandController?.abort(); commandController = null; busy = false;
    reset();
  }
  function restart() {
    disconnect();
    if (!api.enabled) {notify(); return;}
    api.message = /^[a-f0-9]{64}$/.test(token) ? "Windowsブリッジを待機中" : "接続トークンを設定してください";
    notice(api.message); notify();
    if (!suspended && /^[a-f0-9]{64}$/.test(token)) void connect();
  }
  function resume() {if (suspended) {suspended = false; restart();}}
  function suspend() {suspended = true; disconnect();}
  async function connect() {
    if (stream || suspended || !api.enabled) return;
    const controller = new AbortController(); stream = controller;
    let reader;
    const alive = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => controller.abort(), 18000);
    };
    alive();
    try {
      const query = new URLSearchParams({media: mediaTarget, audio: audioTarget});
      const response = await fetch(`${endpoint}/events?${query}`, {headers: {Authorization: `Bearer ${token}`},
        signal: controller.signal, cache: "no-store", credentials: "omit"});
      if (!response.ok || !response.body) throw new Error(response.status === 401 ? "token" : "connection");
      reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = "";
      while (true) {
        const {value, done} = await reader.read();
        if (done) throw new Error("connection");
        pending += decoder.decode(value, {stream: true});
        if (pending.length > 8_000_000) throw new Error("payload");
        let newline;
        while ((newline = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
          if (stream !== controller || suspended) return;
          const message = JSON.parse(line);
          if (message.event !== "state" || typeof message.view !== "string" || !Array.isArray(message.sessions) ||
              !Array.isArray(message.audioTargets) || message.mediaTarget !== mediaTarget || message.audioTarget !== audioTarget) throw new Error("payload");
          alive(); apply(message);
        }
      }
    } catch (error) {
      if (stream !== controller || suspended || !api.enabled) return;
      reset();
      api.message = error.message === "token" ? "接続トークンを確認してください" : "ブリッジ未接続・権限を確認してください";
      notice(api.message); notify();
    } finally {
      try {await reader?.cancel();} catch { /* Already closed or aborted. */ }
      controller.abort();
      if (stream === controller) {
        stream = null; clearTimeout(watchdog); clearInterval(tick); tick = null;
        if (!suspended && api.enabled) retry = setTimeout(connect, 3000);
      }
    }
  }
  function options(select, choices, selected, fallback) {
    const list = choices.filter(item => typeof item.id === "string" && typeof item.name === "string");
    if (!list.some(item => item.id === selected)) list.push({id: selected, name: fallback});
    const fingerprint = JSON.stringify(list);
    if (select.dataset.options !== fingerprint) {
      select.replaceChildren(...list.map(item => new Option(item.name, item.id)));
      select.dataset.options = fingerprint;
    }
    select.value = selected; select.disabled = false;
  }
  function apply(message) {
    const previous = data; data = message;
    const media = data.media;
    fallbackIcon = media?.app_icon_data_url || "";
    const icon = media?.favicon_data_url || fallbackIcon;
    if (icon) {if (appIcon.getAttribute("src") !== icon) appIcon.src = icon; appIcon.hidden = false;}
    else {appIcon.removeAttribute("src"); appIcon.hidden = true;}
    const identity = JSON.stringify([media?.session_id, media?.title, media?.artist, media?.album, media?.browser_media?.target_id]);
    const allowed = op => op === "play-pause" ? media?.controls?.toggle || media?.controls?.[media?.playback_state === "playing" ? "pause" : "play"] : media?.controls?.[op];
    // The adapter changes only when displayed metadata/capabilities change. Timeline-only events
    // must not cause repeatedly announced track text or reset command error timers.
    const metadata = JSON.stringify([identity, media?.artwork_data_url, media?.fallback_artwork_data_url, media?.playback_state, media?.controls]);
    if (!api.provider || metadata !== lastTrack) {
      lastTrack = metadata;
      api.provider = {songName: media?.title?.trim() || media?.page_title?.trim() || (media ? "曲名を取得できません" : ""),
        artist: media?.artist || "", album: media?.album || "", thumbnail: media?.artwork_data_url && media.artwork_data_url !== failedArtwork
          ? media.artwork_data_url : media?.fallback_artwork_data_url || "",
        isPlaying: media?.playback_state === "playing" ? true : media?.playback_state === "paused" || media?.playback_state === "stopped" ? false : null};
      for (const [method, op] of [["triggerPreviousTrack", "previous"], ["triggerPlayPause", "play-pause"], ["triggerNextTrack", "next"]]) {
        if (allowed(op)) api.provider[method] = () => send(op, undefined, data?.view, identity);
      }
      notify();
    }
    options(el.mediaTarget, [{id: "auto", name: "自動選択"}, ...data.sessions], mediaTarget, "選択したプレーヤーは未接続");
    options(el.audioTarget, data.audioTargets, audioTarget, "選択した音量対象は未接続");
    const audio = data.audio;
    el.volumeRange.disabled = busy || !Number.isFinite(audio?.volume);
    el.muteButton.disabled = busy || typeof audio?.muted !== "boolean";
    el.muteButton.textContent = audio?.muted ? "ミュート解除" : "ミュート";
    if (typeof audio?.muted === "boolean") el.muteButton.setAttribute("aria-pressed", String(audio.muted));
    else el.muteButton.removeAttribute("aria-pressed");
    if (!gestures.has(el.volumeRange)) el.volumeRange.value = String(Math.round((audio?.volume ?? 0) * 100));
    el.volumeText.textContent = Number.isFinite(audio?.volume) ? `${Math.round(audio.volume * 100)}%` : "--%";
    el.volumeRange.setAttribute("aria-valuetext", el.volumeText.textContent);
    el.stopButton.disabled = busy || !allowed("stop");
    updatePosition();
    if (!tick) tick = setInterval(updatePosition, 250);
    if (!previous || Date.now() > errorUntil) showConnection();
  }
  function time(value) {
    if (!Number.isFinite(value)) return "--:--";
    const seconds = Math.max(0, Math.floor(value));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  function position() {
    const media = data?.media, timeline = media?.timeline;
    if (!Number.isFinite(media?.position)) return null;
    const browser = media.browser_media;
    const advancing = media.playback_state === "playing" && !browser?.ended && !browser?.seeking && (browser?.ready_state === undefined || browser.ready_state >= 3);
    const value = media.position + (advancing ? Math.max(0, Date.now() - data.now) / 1000 * (media.playback_rate ?? 1) : 0);
    return Math.max(timeline?.start_sec ?? 0, Math.min(timeline?.end_sec ?? Infinity, value));
  }
  function updatePosition() {
    if (!data) return;
    const media = data.media, t = media?.timeline, current = position();
    const seekable = media?.controls?.seek && Number.isFinite(t?.min_seek_sec) && Number.isFinite(t?.max_seek_sec) && t.max_seek_sec > t.min_seek_sec;
    el.seekRange.disabled = busy || !seekable;
    el.rewindButton.disabled = el.forwardButton.disabled = busy || !seekable || current === null;
    if (!gestures.has(el.seekRange)) {
      el.seekRange.min = String(seekable ? t.min_seek_sec : 0); el.seekRange.max = String(seekable ? t.max_seek_sec : 1);
      el.seekRange.value = String(current ?? 0);
      el.positionText.textContent = `${time(current === null ? null : current - (t?.start_sec ?? 0))} / ${time(Number.isFinite(t?.end_sec) ? t.end_sec - (t.start_sec ?? 0) : null)}`;
      el.seekRange.setAttribute("aria-valuetext", el.positionText.textContent);
    }
    if (errorUntil && Date.now() > errorUntil) {errorUntil = 0; showConnection();}
  }
  function showConnection() {
    notice(data?.chrome?.state === "connected" ? "Windows接続済み · Chrome接続済み" : "Windows接続済み · Chrome未接続（任意）");
  }
  async function send(command, value, view = data?.view, expectedTrack) {
    if (busy || !view || !data || suspended || !stream) throw new Error("unavailable");
    if (expectedTrack && expectedTrack !== JSON.stringify([data.media?.session_id, data.media?.title, data.media?.artist, data.media?.album, data.media?.browser_media?.target_id])) throw new Error("stale");
    busy = true;
    const controller = new AbortController(); commandController = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${endpoint}/command`, {method: "POST", headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
        body: JSON.stringify({command, value, view}), signal: controller.signal, credentials: "omit", cache: "no-store"});
      if (!response.ok) throw new Error("rejected");
    } catch (error) {
      if (commandController === controller && !suspended) {
        errorUntil = Date.now() + 4000; notice("操作できませんでした・表示と接続を確認して再操作してください");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      if (commandController === controller) {commandController = null; busy = false; if (data) apply(data);}
    }
  }
  const attempt = (...args) => {void send(...args).catch(() => {});};
  for (const [select, kind] of [[el.mediaTarget, "media"], [el.audioTarget, "audio"]]) select.addEventListener("change", () => {
    if (kind === "media") mediaTarget = select.value; else audioTarget = select.value;
    saveTargets(); restart();
  });
  for (const [slider, command] of [[el.seekRange, "seek"], [el.volumeRange, "volume"]]) {
    slider.addEventListener("pointerdown", () => {if (!slider.disabled && data) gestures.set(slider, data.view);});
    slider.addEventListener("input", () => {
      if (!slider.disabled && data && !gestures.has(slider)) gestures.set(slider, data.view);
      const text = command === "volume" ? `${slider.value}%` : time(Number(slider.value) - (data?.media?.timeline?.start_sec ?? 0));
      slider.setAttribute("aria-valuetext", text);
      (command === "volume" ? el.volumeText : el.positionText).textContent = text;
    });
    slider.addEventListener("change", () => {
      const view = gestures.get(slider); gestures.delete(slider);
      if (view) attempt(command, Number(slider.value) / (command === "volume" ? 100 : 1), view);
    });
    slider.addEventListener("pointercancel", () => {gestures.delete(slider); if (data) apply(data);});
  }
  el.muteButton.addEventListener("click", () => attempt("mute"));
  el.stopButton.addEventListener("click", () => attempt("stop"));
  el.rewindButton.addEventListener("click", () => {const p = position(); if (p !== null) attempt("seek", p - 10);});
  el.forwardButton.addEventListener("click", () => {const p = position(); if (p !== null) attempt("seek", p + 10);});
})();
