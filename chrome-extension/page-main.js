(() => {
  // Read only page-provided Media Session metadata and HTML media element state.
  // We do not inspect page text, cookies, credentials, audio/video bytes or DRM streams.
  const TAG = "__streamdeck_media_metadata_v1__";
  let resyncInterval=1000;
  const clean = (x,max=500) => typeof x === "string" ? x.slice(0,max) : "";
  // MediaSession has no public getter for the last setPositionState argument.
  // Capture future calls opportunistically; never break playback if wrapping fails.
  let lastPositionState;
  let positionMetadata;
  let currentTarget,targetSequence=0;
  function targetId(player,meta) {
    if(!player) {currentTarget=undefined;return undefined;}
    const identity={player,src:player.currentSrc||player.src||"",srcObject:player.srcObject,
      title:meta?.title,artist:meta?.artist,album:meta?.album};
    if(!currentTarget || Object.keys(identity).some(key=>currentTarget[key]!==identity[key])) {
      // The ID is scoped to this document. Media URLs and objects stay in the page.
      currentTarget={...identity,id:`media-${++targetSequence}`};
    }
    return currentTarget.id;
  }
  try {
    const session = navigator.mediaSession;
    if(session && typeof session.setPositionState === "function") {
      const original = session.setPositionState.bind(session);
      session.setPositionState = function(state) {
        const result = original(...arguments);
        lastPositionState = undefined;
        positionMetadata = JSON.stringify([session.metadata?.title,session.metadata?.artist,session.metadata?.album]);
        if(state && typeof state === "object" && "duration" in state) {
          lastPositionState = {
            position: Number.isFinite(state.position) ? state.position : 0,
            duration: Number.isFinite(state.duration) ? state.duration : undefined,
            playbackRate: Number.isFinite(state.playbackRate) ? state.playbackRate : 1,
            updatedAt: Date.now(),
            playing: session.playbackState === "playing"
          };
        }
        send();
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
    const observed = Date.now();
    const session = navigator.mediaSession;
    const meta = session?.metadata;
    if(positionMetadata!==JSON.stringify([meta?.title,meta?.artist,meta?.album])) lastPositionState=undefined;
    if(lastPositionState) {
      // Keep a clock for the observed Media Session sample across pause/resume.
      if(lastPositionState.playing) lastPositionState.position += Math.max(0,observed-lastPositionState.updatedAt)/1000*lastPositionState.playbackRate;
      lastPositionState.position = Math.max(0,lastPositionState.position);
      if(lastPositionState.duration!==undefined) lastPositionState.position=Math.min(lastPositionState.duration,lastPositionState.position);
      lastPositionState.updatedAt=observed;
      lastPositionState.playing=session?.playbackState==="playing";
    }
    const players = Array.from(document.querySelectorAll("audio,video"))
      .filter(p => p.currentSrc || p.src || p.readyState > 0);
    const active = players.filter(p=>!p.paused && !p.ended);
    // Multiple active elements are ambiguous; don't attach an arbitrary element to Media Session metadata.
    const playing = active.length===1 ? active[0] : players.length===1 ? players[0] : undefined;
    const target=targetId(playing,meta);
    if(!meta?.title && !playing) return {title:""};
    const artwork = (meta?.artwork ?? []).slice(0,16).map(a=>({
      src:clean(a.src,2048), sizes:clean(a.sizes,50), type:clean(a.type,50)
    }));
    const duration = playing && Number.isFinite(playing.duration) && playing.duration>=0 ? playing.duration : lastPositionState?.duration;
    const position = playing && Number.isFinite(playing.currentTime) ? playing.currentTime : lastPositionState?.position;
    return {
      title:clean(meta?.title),
      artist:clean(meta?.artist), album:clean(meta?.album),
      artwork_candidates:artwork,
      favicon_candidates:Array.from(document.querySelectorAll('link[rel~="icon"],link[rel~="apple-touch-icon"],link[rel~="apple-touch-icon-precomposed"]')).slice(0,16).map(a=>({src:clean(a.href,2048),sizes:clean(a.sizes?.value,50),type:clean(a.type,50)})),
      playback_state:playing ? (playing.paused ? "paused" : "playing") : session?.playbackState,
      playback_rate:playing?.playbackRate ?? lastPositionState?.playbackRate,
      timeline:{updated_at:observed,start_sec:0,position_sec:position,end_sec:duration,min_seek_sec:playing?.seekable.length?playing.seekable.start(0):undefined,max_seek_sec:playing?.seekable.length?playing.seekable.end(playing.seekable.length-1):undefined},
      controls:{toggle:!!playing,play:!!playing,pause:!!playing,stop:!!playing,seek:!!playing && playing.seekable.length>0,next:false,previous:false},
      browser_media:playing ? {
        target_id:target,
        element_type:playing.tagName.toLowerCase(), muted:playing.muted,
        volume:playing.volume,loop:playing.loop,ended:playing.ended,seeking:playing.seeking,
        ready_state:playing.readyState,
        picture_in_picture:document.pictureInPictureElement===playing,
        buffered_ranges:ranges(playing.buffered),seekable_ranges:ranges(playing.seekable)
      } : undefined
    };
  }
  window.addEventListener("message",async event=>{
    if(event.source===window&&event.origin===location.origin&&event.data?.kind===TAG+"_transport") {resyncInterval=event.data.protocol===2?5000:1000;return;}
    if(event.source!==window || event.origin!==location.origin || event.data?.kind!==TAG+"_command") return;
    const c=event.data.command;
    if(!c || typeof c.id!=="string") return;
    let ok=false;
    try {
      const media=snapshot();
      if(c.title!==media.title || !media.browser_media?.target_id || c.target_id!==media.browser_media.target_id) throw new Error("Media changed");
      const players=Array.from(document.querySelectorAll("audio,video")).filter(p=>p.currentSrc||p.src||p.readyState>0);
      const active=players.filter(p=>!p.paused&&!p.ended);
      const player=active.length===1?active[0]:players.length===1?players[0]:undefined;
      if(!player) throw new Error("No accessible player");
      if(c.command==="play-pause") {if(player.paused) await player.play();else player.pause();}
      else if(c.command==="stop") {player.pause();if(player.seekable.length) player.currentTime=player.seekable.start(0);}
      else if(c.command==="seek" && Number.isFinite(c.position) && ranges(player.seekable).some(([a,b])=>c.position>=a&&c.position<=b)) player.currentTime=c.position;
      else throw new Error("Unavailable operation");
      ok=true;send();
    } catch { /* Result is returned to the plugin, without a global-key fallback. */ }
    window.postMessage({kind:TAG+"_result",id:c.id,ok},location.origin);
  });
  let lastMedia,lastSignature,lastSent=0;
  function send(event) {
    try {
      const media=snapshot(),now=Date.now(),active=!!media.title||!!media.browser_media;
      const stable={...media,timeline:media.timeline?{...media.timeline,updated_at:undefined,position_sec:undefined}:undefined};
      const signature=JSON.stringify(stable);
      const previous=lastMedia?.timeline,position=media.timeline?.position_sec;
      const advancing=lastMedia?.playback_state==='playing'&&!lastMedia?.browser_media?.seeking&&!lastMedia?.browser_media?.ended&&(lastMedia?.browser_media?.ready_state??4)>=3;
      const predicted=typeof previous?.position_sec==='number'?previous.position_sec+(advancing?Math.max(0,now-previous.updated_at)/1000*(lastMedia.playback_rate??1):0):undefined;
      const drift=typeof position==='number'&&typeof predicted==='number'?Math.abs(position-predicted)>0.25:position!==predicted;
      // Keep the one-second local discovery check for APIs without change events.
      // Only a compact five-second resync crosses the extension boundary.
      const important=event&&event.type!=='timeupdate';
      if(signature===lastSignature&&!drift&&!important&&(!active||now-lastSent<resyncInterval)) return;
      lastMedia=media;lastSignature=signature;lastSent=now;
      window.postMessage({kind:TAG,media}, location.origin);
    }
    catch { /* inaccessible site; ignore */ }
  }
  setInterval(send,1000);
  document.addEventListener("play",send,true);
  document.addEventListener("pause",send,true);
  document.addEventListener("loadedmetadata",send,true);
  for(const event of ["emptied","ended","seeking","seeked","waiting","playing","timeupdate","ratechange","volumechange","durationchange"]) document.addEventListener(event,send,true);
  send();
})();
