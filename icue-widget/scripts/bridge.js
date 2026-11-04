/* Independent Windows bridge. Tokens stay in iCUE settings, never in URLs/storage/logs. */
(function () {
  "use strict";
  const endpoint = "https://127.0.0.1:39762";
  const ids = ["bridgePanel", "mediaTarget", "audioTarget", "seekRange", "positionText", "volumeRange", "volumeText",
    "muteButton", "rewindButton", "stopButton", "forwardButton", "bridgeNotice"];
  const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  const targetPickers = new Map();
  // Chromium 130 (iCUE) cannot style the native option popup. Keep the select
  // as the source of truth and dispatch its existing change event on commit.
  function enhanceTargetPicker(select) {
    if (CSS.supports("appearance", "base-select") || typeof HTMLElement.prototype.showPopover !== "function") return;
    const label = document.querySelector(`label[for="${select.id}"]`);
    const button = document.createElement("button"), list = document.createElement("div");
    label.id = `${select.id}Label`;
    button.id = `${select.id}Picker`; button.type = "button"; button.className = "target-picker";
    button.setAttribute("role", "combobox"); button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-labelledby", label.id); button.setAttribute("aria-expanded", "false");
    list.id = `${select.id}Options`; list.className = "target-options"; list.popover = "auto";
    list.setAttribute("role", "listbox"); list.setAttribute("aria-labelledby", label.id);
    button.setAttribute("aria-controls", list.id);
    label.htmlFor = button.id;
    select.hidden = true;
    select.after(button, list);
    let active = 0, search = "", lastKey = 0;
    const opened = () => list.matches(":popover-open");
    const close = () => {if (opened()) list.hidePopover();};
    function position() {
      if (!opened()) return;
      const rect = button.getBoundingClientRect(), gap = rect.height / 12;
      const below = innerHeight - rect.bottom - gap, above = rect.top - gap;
      const down = below >= Math.min(list.scrollHeight, rect.height * 3.75) || below >= above;
      list.style.inlineSize = `${Math.min(rect.width, innerWidth - gap * 2)}px`;
      list.style.maxBlockSize = `${Math.max(0, (down ? below : above) - gap)}px`;
      list.style.left = `${Math.max(gap, Math.min(rect.left, innerWidth - rect.width - gap))}px`;
      list.style.top = `${down ? rect.bottom + gap : Math.max(gap, rect.top - gap - list.getBoundingClientRect().height)}px`;
    }
    function highlight(index) {
      active = Math.max(0, Math.min(list.children.length - 1, index));
      for (const [i, node] of [...list.children].entries()) {
        node.dataset.active = String(i === active);
        node.setAttribute("aria-selected", String(i === active));
      }
      const option = list.children[active];
      if (option && opened()) {
        button.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({block:"nearest"});
      }
    }
    function sync() {
      button.disabled = select.disabled;
      button.textContent = select.selectedOptions[0]?.textContent || "";
      button.title = button.textContent;
      const signature = JSON.stringify([...select.options].map(option => [option.value, option.textContent]));
      if (list.dataset.options !== signature) {
        close();
        list.replaceChildren(...[...select.options].map((option, index) => {
          const node = document.createElement("div");
          node.id = `${list.id}-${index}`; node.className = "target-option";
          node.setAttribute("role", "option"); node.textContent = option.textContent; node.title = option.textContent;
          node.dataset.value = option.value;
          return node;
        }));
        list.dataset.options = signature;
      }
      if (select.disabled) close();
      if (!opened()) highlight(select.selectedIndex);
    }
    function open() {
      if (button.disabled) return;
      if (!opened()) {list.showPopover(); button.setAttribute("aria-expanded", "true"); position(); highlight(select.selectedIndex);}
    }
    function commit() {
      const option = list.children[active];
      close();
      if (button.disabled || !option || select.value === option.dataset.value) return;
      select.value = option.dataset.value;
      button.textContent = option.textContent;
      select.dispatchEvent(new Event("change", {bubbles:true}));
    }
    button.addEventListener("click", () => {if (opened()) close(); else open();});
    button.addEventListener("keydown", event => {
      const wasOpen = opened(), key = event.key;
      if (key === "Tab") {if (wasOpen) commit(); return;}
      if (key === "Escape") {if (wasOpen) {event.preventDefault(); close();} return;}
      if (["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp", "Enter", " "].includes(key)) {
        event.preventDefault();
        if ((key === "Enter" || key === " " || (event.altKey && key === "ArrowUp")) && wasOpen) {commit(); return;}
        open();
        if (key === "Home") highlight(0);
        else if (key === "End") highlight(list.children.length - 1);
        else if (wasOpen && key === "ArrowDown") highlight(active + 1);
        else if (wasOpen && key === "ArrowUp") highlight(active - 1);
        else if (key === "PageDown") highlight(active + 10);
        else if (key === "PageUp") highlight(active - 10);
      } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault(); open();
        const now = Date.now(); search = now - lastKey < 700 ? search + key : key; lastKey = now;
        const repeated = [...search].every(character => character === search[0]);
        const prefix = (repeated ? key : search).toLocaleLowerCase();
        const nodes = [...list.children];
        const start = repeated ? active + 1 : active;
        for (let offset = 0; offset < nodes.length; offset++) {
          const index = (start + offset) % nodes.length;
          if (nodes[index].textContent.toLocaleLowerCase().startsWith(prefix)) {highlight(index); break;}
        }
      }
    });
    list.addEventListener("pointerdown", event => {if (event.target.closest(".target-option")) event.preventDefault();});
    list.addEventListener("click", event => {
      const option = event.target.closest(".target-option");
      if (!option) return;
      highlight([...list.children].indexOf(option)); commit(); button.focus();
    });
    list.addEventListener("beforetoggle", event => {
      if (event.newState === "closed") {button.setAttribute("aria-expanded", "false"); button.removeAttribute("aria-activedescendant"); search = "";}
    });
    button.addEventListener("blur", close);
    select.addEventListener("change", sync);
    new MutationObserver(sync).observe(select, {attributes:true, attributeFilter:["disabled"]});
    window.addEventListener("resize", close);
    window.addEventListener("pagehide", close);
    document.getElementById("deck").addEventListener("scroll", close);
    targetPickers.set(select, {sync}); sync();
  }
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
  // Paint only: the range's native value and existing gesture handling remain authoritative.
  function paintRange(slider) {
    const min = Number(slider.min), max = Number(slider.max);
    const progress = max > min ? (Number(slider.value) - min) / (max - min) * 100 : 0;
    slider.style.setProperty("--range-progress", `${Math.max(0, Math.min(100, progress))}%`);
  }
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
    el.seekRange.setAttribute("aria-valuetext", "再生位置不明");
    el.volumeRange.setAttribute("aria-valuetext", "音量不明");
    for (const slider of [el.seekRange, el.volumeRange]) slider.style.setProperty("--range-progress", "0%");
    el.muteButton.textContent = "ミュート";
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
    targetPickers.get(select)?.sync();
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
    // A live snapshot must not overwrite the value the user is previewing while dragging.
    if (!gestures.has(el.volumeRange)) {
      el.volumeRange.value = String(Math.round((audio?.volume ?? 0) * 100));
      el.volumeText.textContent = Number.isFinite(audio?.volume) ? `${Math.round(audio.volume * 100)}%` : "--%";
      el.volumeRange.setAttribute("aria-valuetext", el.volumeText.textContent);
      paintRange(el.volumeRange);
    }
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
      paintRange(el.seekRange);
    }
    if (errorUntil && Date.now() > errorUntil) {errorUntil = 0; showConnection();}
  }
  function showConnection() {
    const connected = data?.chrome?.state === "connected";
    const text = connected ? "Windows接続済み · Chrome接続済み" : "Windows接続済み · Chrome未接続（任意）";
    if (el.bridgeNotice.textContent === text) return;
    const badges = [["Windows接続済み", true], [connected ? "Chrome接続済み" : "Chrome未接続（任意）", connected]].map(([label, active]) => {
      const badge = document.createElement("span");
      badge.className = "connection-badge";
      badge.dataset.connected = String(active);
      badge.textContent = label;
      return badge;
    });
    el.bridgeNotice.replaceChildren(badges[0], " · ", badges[1]);
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
      paintRange(slider);
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
  for (const select of [el.mediaTarget, el.audioTarget]) enhanceTargetPicker(select);
})();
