(() => {
  // Read only page-provided Media Session metadata and HTML media element state.
  // We do not inspect page text, cookies, credentials, audio/video bytes or DRM streams.
  const TAG = "__streamdeck_media_metadata_v1__";
  const clean = (x,max=500) => typeof x === "string" ? x.slice(0,max) : "";
  // MediaSession has no public getter for the last setPositionState argument.
  // Capture future calls opportunistically; never break playback if wrapping fails.
  let lastPositionState;
  try {
    const session = navigator.mediaSession;
    if(session && typeof session.setPositionState === "function") {
      const original = session.setPositionState.bind(session);
      session.setPositionState = function(state) {
        const result = original(...arguments);
        if(state && typeof state === "object") {
          lastPositionState = {
            position: Number.isFinite(state.position) ? state.position : undefined,
            duration: Number.isFinite(state.duration) ? state.duration : undefined,
            playbackRate: Number.isFinite(state.playbackRate) ? state.playbackRate : undefined
          };
        }
        return result;
      };
    }
  } catch { /* managed browser API; leave it intact */ }
  const ranges = (r) => {
    const a=[];
    if(!r) return a;
    for(let i=0;i<Math.min(r.length,32);i++) {
      try {a.push([r.start(i),r.end(i)]);}catch {break;}
    }
    return a;
  };
  function snapshot() {
    const session = navigator.mediaSession;
    const meta = session?.metadata;
    const players = Array.from(document.querySelectorAll("audio,video"))
      .filter(p => p.currentSrc || p.src || p.readyState > 0);
    const playing = players.find(p=>!p.paused && !p.ended) ?? players[0];
    if(!meta?.title && !playing) return {title:""};
    const artwork = (meta?.artwork ?? []).slice(0,16).map(a=>({
      src:clean(a.src,2048), sizes:clean(a.sizes,50), type:clean(a.type,50)
    }));
    const duration = playing && Number.isFinite(playing.duration) && playing.duration>=0 ? playing.duration : lastPositionState?.duration;
    const position = playing && Number.isFinite(playing.currentTime) ? playing.currentTime : lastPositionState?.position;
    return {
      title:clean(meta?.title || document.title),
      artist:clean(meta?.artist), album:clean(meta?.album),
      artwork_candidates:artwork,
      playback_state:playing ? (playing.paused ? "paused" : "playing") : session?.playbackState,
      playback_rate:playing?.playbackRate ?? lastPositionState?.playbackRate,
      timeline:{position_sec:position,end_sec:duration},
      browser_media:playing ? {
        element_type:playing.tagName.toLowerCase(), muted:playing.muted,
        volume:playing.volume,loop:playing.loop,ended:playing.ended,
        ready_state:playing.readyState,
        picture_in_picture:document.pictureInPictureElement===playing,
        buffered_ranges:ranges(playing.buffered),seekable_ranges:ranges(playing.seekable)
      } : undefined
    };
  }
  function send() {
    try { window.postMessage({kind:TAG,media:snapshot()}, location.origin); }
    catch { /* inaccessible site; ignore */ }
  }
  setInterval(send,2000);
  document.addEventListener("play",send,true);
  document.addEventListener("pause",send,true);
  document.addEventListener("loadedmetadata",send,true);
  send();
})();
