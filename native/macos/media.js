// JavaScript for Automation, executed by /usr/bin/osascript. No shell commands.
function run(argv) {
  ObjC.import("AppKit");
  var request = JSON.parse(argv[0]);
  var apps = ['com.apple.Music', 'com.spotify.client'];
  function read(fn) { try { return fn(); } catch (_) { return null; } }
  function session(id) {
    var running = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(id);
    if (Number(running.count) === 0) return null;
    var processId = running.objectAtIndex(0).processIdentifier;
    var app = Application(id);
    if (!app.running()) return null;
    var state = app.playerState();
    if (state !== 'playing' && state !== 'paused') return null;
    var track = app.currentTrack();
    var identity = String(track.id());
    var duration = read(function () { return track.duration(); });
    if (id === 'com.spotify.client' && duration !== null) duration /= 1000;
    var position = read(function () { return app.playerPosition(); });
    return {source:'macos', session_id:'macos:' + id + ':' + processId + ':' + identity, app_id:id,
      title:read(function () { return track.name(); }), artist:read(function () { return track.artist(); }),
      album:read(function () { return track.album(); }), playback_state:state,
      controls:{toggle:true,play:true,pause:true,next:true,previous:true,stop:id==='com.apple.Music',seek:position!==null && duration>0},
      timeline:{updated_at:Date.now(),start_sec:0,end_sec:duration,position_sec:position,min_seek_sec:0,max_seek_sec:duration}};
  }
  var system = Application.currentApplication(); system.includeStandardAdditions = true;
  if (request.command === 'snapshot') {
    var errors = [], sessions = [];
    apps.forEach(function (id) { try { var value = session(id); if(value) sessions.push(value); } catch (e) { errors.push(id + ': ' + e.message); } });
    var audio = null;
    try { var v = system.getVolumeSettings(); audio = {master:{id:'master',name:'System',volume:v.outputVolume/100,muted:v.outputMuted},sessions:[],observed_at:Date.now()}; } catch (e) { errors.push(e.message); }
    return JSON.stringify({current:sessions.filter(function(s){return s.playback_state==='playing';})[0] || sessions[0] || null,sessions:sessions,audio:audio,errors:errors});
  }
  if (Date.now() >= request.expires_at) throw Error('Expired command');
  if (request.command === 'volume' || request.command === 'mute') {
    if(request.target !== 'master') throw Error('Only system volume is supported on macOS');
    var volume = system.getVolumeSettings();
    if(request.command === 'mute') system.setVolume(null,{outputMuted:!volume.outputMuted});
    else system.setVolume(null,{outputVolume:Math.round(Math.max(0,Math.min(100,volume.outputVolume + request.delta*100)))});
    return 'ok';
  }
  var id = apps.filter(function(id){return request.session_id.indexOf('macos:'+id+':')===0;})[0];
  if(!id) throw Error('Unknown media target');
  var current = session(id);
  if(!current || current.session_id !== request.session_id || Date.now() >= request.expires_at) throw Error('Stale media target');
  var app = Application(id);
  switch(request.command) {
    case 'play-pause': app.playpause(); break;
    case 'play': app.play(); break;
    case 'pause': app.pause(); break;
    case 'next': app.nextTrack(); break;
    case 'previous': app.previousTrack(); break;
    case 'stop': if(id!=='com.apple.Music') throw Error('Stop unsupported'); app.stop(); break;
    case 'seek':
      if(!current.controls.seek || !isFinite(request.position) || request.position<0 || request.position>current.timeline.end_sec) throw Error('Invalid seek');
      app.playerPosition = request.position; break;
    default: throw Error('Unsupported command');
  }
  return 'ok';
}
