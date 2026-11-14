import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createHmac} from 'node:crypto';
import {load} from './load.mjs';
import {tls, httpsFetch as fetch} from './tls-fixture.mjs';
import {icueBackend} from './icue-backend.mjs';
const {startIcueServer} = await load('icue/icue-server');
const token = 'c'.repeat(64);
async function setup(t) {
  const f = icueBackend(), server = startIcueServer(f.backend, {token, tls, port:0});
  await once(server, 'listening');
  const url = `https://127.0.0.1:${server.address().port}`;
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));});
  const headers = {authorization:`Bearer ${token}`, origin:'null'};
  const command = (view, command, value) => fetch(url + '/command', {method:'POST', headers:{...headers, 'content-type':'application/json'}, body:JSON.stringify({view, command, value})});
  async function snapshot(media = 'auto', audio = 'master') {
    const response = await fetch(`${url}/events?${new URLSearchParams({media,audio})}`, {headers});
    const reader = response.body.getReader(), decoder = new TextDecoder(); let line = '';
    while (!line.includes('\n')) {const next = await reader.read(); assert.equal(next.done,false); line += decoder.decode(next.value);}
    await reader.cancel(); return JSON.parse(line.split('\n')[0]);
  }
  return {...f, server, url, headers, command, snapshot};
}
test('iCUE HTTPS requires auth, exact loopback Host and null origin; preflights do not authorize commands', async t => {
  const f = await setup(t);
  assert.equal((await fetch(f.url+'/events')).status,401);
  assert.equal((await fetch(f.url+'/events',{headers:{...f.headers,origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(f.url+'/events',{headers:{...f.headers,host:'127.0.0.1:1'}})).status,403);
  assert.equal((await fetch(f.url+'/events',{method:'OPTIONS',headers:{origin:'null','access-control-request-method':'GET','access-control-request-headers':'authorization'}})).status,204);
  assert.equal((await fetch(f.url+'/events',{method:'OPTIONS',headers:{origin:'null','access-control-request-method':'DELETE'}})).status,403);
  assert.equal((await f.command('bogus','play-pause')).status,409);
  const state = await f.snapshot();
  assert.equal(state.media.title,'Track A'); assert.equal(state.media.position >= 30,true);
  assert.equal(state.audio.volume,.5); assert.equal(state.sessions.length,2);
  assert.equal((await f.command(state.view+'x','play-pause')).status,409);
  const expired = JSON.parse(Buffer.from(state.view.split('.')[0],'base64url').toString());
  expired.expires = Date.now()-1;
  const body = Buffer.from(JSON.stringify(expired)).toString('base64url');
  const receipt = body+'.'+createHmac('sha256',token).update(body).digest('base64url');
  assert.equal((await f.command(receipt,'play-pause')).status,409);
  assert.equal(f.calls.length,0);
});
test('iCUE commands retain displayed media identity, reject track/session races and check current capabilities', async t => {
  const f = await setup(t); const state = await f.snapshot();
  assert.equal((await f.command(state.view,'play-pause')).status,200);
  assert.deepEqual(f.calls.pop(),{command:'play-pause',session_id:f.windows.session_id});
  f.windows.title = 'Track B';
  assert.equal((await f.command(state.view,'next')).status,409);
  const fresh = await f.snapshot();
  f.setCurrent(f.chrome);
  assert.equal((await f.command(fresh.view,'next')).status,409);
  f.setCurrent(f.windows); f.windows.controls.next = false;
  assert.equal((await f.command(fresh.view,'next')).status,409);
  const selected = await f.snapshot('disconnected');
  assert.equal(selected.media,null); assert.equal((await f.command(selected.view,'stop')).status,409);
  assert.equal(f.calls.length,0);
});

test('iCUE Qt file:// origin can preflight and authenticate; other file origins and remote sites remain rejected', async t => {
  const f = await setup(t);
  const preflight = await fetch(f.url+'/events',{method:'OPTIONS',headers:{origin:'file://',
    'access-control-request-method':'GET','access-control-request-headers':'authorization'}});
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('access-control-allow-origin'),'file://');
  assert.equal((await fetch(f.url+'/events',{headers:{origin:'file://'}})).status,401);
  const response = await fetch(f.url+'/events',{headers:{...f.headers,origin:'file://'}});
  assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),'file://');
  assert.equal(response.headers.get('vary'),'Origin');
  const reader=response.body.getReader();assert.equal((await reader.read()).done,false);await reader.cancel();
  for (const origin of ['file://evil.example','file:///some/page','https://evil.example','http://localhost:39762']) {
    const denied=await fetch(f.url+'/events',{headers:{...f.headers,origin}});
    assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
  }
});
test('iCUE seeks use absolute provider ranges and Chrome document identity, with no global fallback', async t => {
  const f = await setup(t); const state = await f.snapshot(f.chrome.session_id);
  assert.equal((await f.command(state.view,'seek',55)).status,200);
  assert.deepEqual(f.calls.pop(),{source:'chrome',session_id:f.chrome.session_id,command:'seek',position:70});
  assert.equal((await f.command(state.view,'next')).status,409);
  assert.equal((await f.command(state.view,'seek','55')).status,409);
  f.chrome.browser_media.target_id = 'replacement';
  assert.equal((await f.command(state.view,'seek',15)).status,409);
  assert.equal(f.calls.length,0);
});
test('iCUE volume and mute stay on the selected audio session and reject missing/unknown metadata', async t => {
  const f = await setup(t); const state = await f.snapshot('auto',f.audio.id);
  assert.equal((await f.command(state.view,'volume',.75)).status,200);
  assert.deepEqual(f.calls.pop(),{command:'volume',target:f.audio.id,value:.75});
  assert.equal((await f.command(state.view,'mute')).status,200);
  assert.equal(f.calls.pop().target,f.audio.id);
  assert.equal((await f.command(state.view,'volume',1.1)).status,409);
  f.audio.pid++;
  assert.equal((await f.command(state.view,'mute')).status,409);
  f.master.volume = null; f.master.muted = null;
  const unknown = await f.snapshot();
  assert.equal((await f.command(unknown.view,'volume',.5)).status,409);
  assert.equal((await f.command(unknown.view,'mute')).status,409);
  assert.equal(f.calls.length,0);
});
test('iCUE streams deliver large artwork intact, sanitize URLs, push changes and release subscribers', async t => {
  const f = await setup(t);
  f.windows.artwork_data_url = 'data:image/png;base64,'+'A'.repeat(200000);
  f.windows.favicon_data_url = 'https://untrusted.example/icon.png';
  const response = await fetch(f.url+'/events',{headers:f.headers}), reader = response.body.getReader();
  let pending = ''; const decoder = new TextDecoder();
  const next = async () => {
    while (!pending.includes('\n')) {const value = await reader.read(); pending += decoder.decode(value.value);}
    const end = pending.indexOf('\n'), line = pending.slice(0,end); pending = pending.slice(end+1); return JSON.parse(line);
  };
  const initial = await next();
  assert.equal(initial.media.artwork_data_url.length,200022); assert.equal(initial.media.favicon_data_url,undefined);
  f.windows.title = 'Updated'; f.emit(); f.emit();
  assert.equal((await next()).media.title,'Updated');
  await reader.cancel();
  await new Promise(resolve => setTimeout(resolve,30));
  assert.equal(f.listeners.size,0);
});
