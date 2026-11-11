import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {register} from '../scripts/register-chrome-native-host-macos.mjs';
test('macOS registration scopes origins and quotes executable paths',async t=>{
  const home=await mkdtemp(join(tmpdir(),"sdmc-'mac-"));t.after(()=>rm(home,{recursive:true,force:true}));
  assert.throws(()=>register('../bad',process.execPath,home));
  const first='a'.repeat(32),second='b'.repeat(32);
  register(first,"/Applications/Node's runtime/node",home);
  const path=join(home,'Library/Application Support/Google/Chrome/NativeMessagingHosts/dev.n7s.media_controls.json');
  const manifest=JSON.parse(await readFile(path,'utf8'));
  assert.deepEqual(manifest.allowed_origins,[`chrome-extension://${first}/`]);
  assert.match(await readFile(manifest.path,'utf8'),/Node'\\''s runtime/);
  assert.equal((await stat(manifest.path)).mode&0o777,0o700);
  register(second,process.execPath,home);
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')).allowed_origins,[`chrome-extension://${second}/`]);
});

test('macOS credentials are private, persistent and usable by TLS', {skip:process.platform!=='darwin'}, async t=>{
  const {load}=await import('./load.mjs');
  const {createSecureContext}=await import('node:tls');
  const root=await mkdtemp(join(tmpdir(),'sdmc-mac-tls-'));
  const previous=process.env.LOCALAPPDATA;process.env.LOCALAPPDATA=root;
  t.after(async()=>{if(previous===undefined) delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=previous;await rm(root,{recursive:true,force:true});});
  const {loadCredentials}=await load('chrome-server');
  const first=loadCredentials();assert.match(first.token,/^[a-f0-9]{64}$/);
  createSecureContext(first.tls);
  assert.equal(loadCredentials().token,first.token);
  for(const file of ['chrome-token.txt','chrome-server.pem','chrome-server.pfx']) assert.equal((await stat(join(root,'StreamDeckMediaControls',file))).mode&0o777,0o600);
  await rm(join(root,'StreamDeckMediaControls/chrome-server.pem'));
  assert.throws(loadCredentials); // A partial identity never regenerates silently.
});
