import {mkdirSync,writeFileSync,copyFileSync,chmodSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
export function register(extensionId,node=process.execPath,home=homedir()) {
  if(!/^[a-p]{32}$/.test(extensionId)) throw Error('Invalid extension ID');
  const base=join(home,'Library','Application Support');
  const host=join(base,'StreamDeckMediaControls','native-host');
  mkdirSync(host,{recursive:true,mode:0o700});chmodSync(host,0o700);
  const source=join(host,'chrome-native-host.mjs'),launcher=join(host,'host.sh');
  copyFileSync(fileURLToPath(new URL('./chrome-native-host.mjs',import.meta.url)),source);
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
  writeFileSync(launcher,'#!/bin/sh\nexec '+quote(node)+' '+quote(source)+'\n',{mode:0o700});chmodSync(launcher,0o700);
  const directory=join(base,'Google','Chrome','NativeMessagingHosts');mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,'dev.n7s.media_controls.json'),JSON.stringify({name:'dev.n7s.media_controls',description:'Stream Deck Media Controls native bridge',path:launcher,type:'stdio',allowed_origins:[`chrome-extension://${extensionId}/`]},null,2),{mode:0o600});
}
if(process.argv[1]===fileURLToPath(import.meta.url)) register(process.argv[2]);
