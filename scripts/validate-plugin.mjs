import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// The CLI can print success and exit 0 after failing to fetch its schemas.
// Never allow that result to authorize packaging a release.
export function assertValidationResult(result) {
  const output=[result.stdout??'',result.stderr??''].join('\n').replace(/\x1b\[[0-9;]*m/g,'');
  if(result.error) throw result.error;
  if(result.status!==0||result.signal) throw new Error('Elgato validation did not finish successfully');
  if(/failed to load remote schema/i.test(output)) throw new Error('Elgato schemas were unavailable; validation is incomplete');
  if(!/Validation successful/i.test(output)) throw new Error('Elgato CLI did not confirm validation');
}

export function validatePlugin() {
  const result=spawnSync(process.execPath,[resolve('node_modules/@elgato/cli/bin/streamdeck.mjs'),'validate',resolve('dev.n7s.media-controls.sdPlugin')],{
    encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:10*1024*1024
  });
  process.stdout.write(result.stdout??'');
  process.stderr.write(result.stderr??'');
  assertValidationResult(result);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) validatePlugin();
