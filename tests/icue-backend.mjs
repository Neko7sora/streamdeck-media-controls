// Test-only backend: no native commands, desktop applications or real player state.
export function icueBackend() {
  const windows = {source:'windows', session_id:'windows:player', app_id:'Player.exe', title:'Track A', artist:'Artist', album:'Album',
    playback_state:'playing', playback_rate:1, controls:{toggle:true, next:true, previous:true, stop:true, seek:true},
    timeline:{start_sec:0, end_sec:240, position_sec:30, min_seek_sec:0, max_seek_sec:240, updated_at:Date.now()}};
  const chrome = {source:'chrome', session_id:'chrome:1:0:doc', tab_id:1, frame_id:0, document_id:'doc',
    title:'Browser Track', artist:'Web Artist', playback_state:'paused', controls:{toggle:true, stop:true, seek:true},
    browser_media:{target_id:'media-1', seekable_ranges:[[10,30],[70,90]]},
    timeline:{start_sec:0, end_sec:100, position_sec:20, min_seek_sec:10, max_seek_sec:90}};
  const master = {id:'master', name:'Default output', volume:.5, muted:false};
  const audio = {id:'audio:player', name:'Player', pid:42, volume:.25, muted:false};
  const listeners = new Set(), calls = [];
  let current = windows;
  const fixture = {windows, chrome, master, audio, listeners, calls, emit:() => {for (const fn of listeners) fn();},
    setCurrent:value => {current = value;},
    backend:{media:target => target === 'auto' ? current : [windows, chrome].find(item => item.session_id === target) ?? null,
      sessions:() => [windows, chrome], audio:target => [master, audio].find(item => item.id === target) ?? null,
      audioTargets:() => [master, audio], subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);},
      async native(command) {calls.push(command);}, async chrome(media, command, position) {calls.push({source:'chrome', session_id:media.session_id, command, position});},
      chromeStatus:() => ({state:'connected'})}};
  return fixture;
}
