import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {copyFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';

export const bridgeOutput = fileURLToPath(new URL('../tests/.generated/icue-bridge/', import.meta.url));
export async function buildIcueBridge() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64 is required');
  execFileSync('cargo', ['build', '--locked', '--release', '--manifest-path', resolve('native/media-info/Cargo.toml')],
    {stdio:'inherit', windowsHide:true});
  mkdirSync(join(bridgeOutput, 'bin'), {recursive:true});
  mkdirSync(join(bridgeOutput, 'native'), {recursive:true});
  await build({entryPoints:['src/icue-bridge.ts'], bundle:true, platform:'node', format:'esm', target:'node24',
    outfile:join(bridgeOutput, 'bin/icue-bridge.mjs')});
  copyFileSync('native/media-info/target/release/media-info.exe', join(bridgeOutput, 'native/media-info.exe'));
  for (const file of ['register-chrome-native-host.ps1', 'chrome-native-host.mjs']) copyFileSync(join('scripts', file), join(bridgeOutput, file));
  for (const file of ['LICENSE-MIT', 'LICENSE-APACHE']) copyFileSync(file, join(bridgeOutput, file));
  copyFileSync('icue-widget/README.md', join(bridgeOutput, 'README.md'));
  writeFileSync(join(bridgeOutput, 'run-bridge.cmd'), '@echo off\r\nnode "%~dp0bin\\icue-bridge.mjs" %*\r\npause\r\n');
  console.log(`iCUE bridge built: ${bridgeOutput}`);
  return bridgeOutput;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildIcueBridge();
