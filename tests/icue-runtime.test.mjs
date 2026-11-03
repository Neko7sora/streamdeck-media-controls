import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir, mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join, relative, isAbsolute} from 'node:path';
import {load} from './load.mjs';
import {tls, httpsFetch as fetch} from './tls-fixture.mjs';
import {icueBackend} from './icue-backend.mjs';

async function setup(t) {
  const root = fileURLToPath(new URL('.generated/', import.meta.url));
  await mkdir(root, {recursive:true});
  const directory = await mkdtemp(join(root, 'icue-runtime-'));
  await mkdir(join(directory, 'StreamDeckMediaControls'));
  const previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = directory;
  const fixture = icueBackend();
  globalThis.__icueRuntime = {...fixture, tls, credentialLoads:0, chromeCalls:[]};
  t.after(async () => {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
    delete globalThis.__icueRuntime;
    const inside = relative(root, directory);
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Unsafe test cleanup path');
    await rm(directory, {recursive:true, force:true, maxRetries:5, retryDelay:100});
  });
  const mocks = {
    state:`const b=globalThis.__icueRuntime.backend;export const currentMedia=b.media,availableSessions=b.sessions,audioTarget=b.audio,audioTargets=b.audioTargets,subscribeChanges=b.subscribe;`,
    native:`export const nativeCommand=globalThis.__icueRuntime.backend.native;`,
    chrome:`const d=globalThis.__icueRuntime;export function loadCredentials(){d.credentialLoads++;return {token:'a'.repeat(64),tls:d.tls};}export const chromeConnectionStatus=d.backend.chromeStatus;export async function chromeCommand(...args){d.chromeCalls.push(args);}`
  };
  const ports = {name:'runtime-ports', setup(build) {
    build.onResolve({filter:/\.\/(media-state|native-client|chrome-server)\.js$/}, args => ({
      path:args.path.includes('media-state')?'state':args.path.includes('native-client')?'native':'chrome', namespace:'test'}));
    build.onLoad({filter:/.*/, namespace:'test'}, args => ({contents:mocks[args.path], loader:'js'}));
  }};
  const runtime = await load('icue-runtime', [ports]);
  const servers = [];
  t.after(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
  const start = options => {const result = runtime.startIcueBridge(options); servers.push(result.server); return result;};
  return {...fixture, start, driver:globalThis.__icueRuntime,
    tokenFile:join(directory, 'StreamDeckMediaControls', 'icue-token.txt')};
}

test('embedded iCUE bridge reuses the shared media/Chrome backend and the standalone token', async t => {
  const f = await setup(t);
  const token = 'c'.repeat(64);
  await writeFile(f.tokenFile, token+'\n');
  const {server, tokenFile} = f.start({port:0});
  assert.equal(tokenFile, f.tokenFile);
  await once(server, 'listening');
  const url = `https://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url+'/events')).status, 401);
  const response = await fetch(url+'/events?media='+encodeURIComponent(f.chrome.session_id), {
    headers:{authorization:`Bearer ${token}`, origin:'null'}});
  const reader = response.body.getReader();
  let data = '';
  while (!data.includes('\n')) data += new TextDecoder().decode((await reader.read()).value);
  const state = JSON.parse(data.split('\n')[0]);
  assert.equal(state.media.title, f.chrome.title);
  assert.deepEqual(state.chrome, {state:'connected'});
  const result = await fetch(url+'/command', {method:'POST',
    headers:{authorization:`Bearer ${token}`, origin:'null', 'content-type':'application/json'},
    body:JSON.stringify({view:state.view, command:'play-pause'})});
  assert.equal(result.status, 200);
  assert.deepEqual(f.driver.chromeCalls, [[1, 0, 'doc', 'Browser Track', 'play-pause', undefined, 'media-1', undefined]]);
  await reader.cancel();
  assert.equal(await readFile(f.tokenFile, 'utf8'), token+'\n');
  const duplicate = f.start({port:server.address().port});
  const [error] = await once(duplicate.server, 'error');
  assert.equal(error.code, 'EADDRINUSE');
  assert.equal(f.driver.credentialLoads, 2);
  assert.equal(await readFile(f.tokenFile, 'utf8'), token+'\n');
});

test('embedded iCUE bridge creates a separate token and fails closed on a damaged existing token', async t => {
  const f = await setup(t);
  const {server} = f.start({port:0});
  await once(server, 'listening');
  const token = (await readFile(f.tokenFile, 'utf8')).trim();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.notEqual(token, 'a'.repeat(64), 'Chrome and iCUE must use different tokens');
  await writeFile(f.tokenFile, 'damaged');
  assert.throws(() => f.start({port:0}), /Invalid iCUE token/);
  assert.equal(await readFile(f.tokenFile, 'utf8'), 'damaged');
});
