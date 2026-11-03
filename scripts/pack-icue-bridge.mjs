import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {buildIcueBridge} from './build-icue-bridge.mjs';
const directory = await buildIcueBridge();
const manifest = JSON.parse(readFileSync('icue-widget/manifest.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid widget version');
const output = resolve(`icue-bridge-${manifest.version}.zip`);
// Windows 11 ships bsdtar; use its ZIP writer without PowerShell module autoloading.
execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/tar.exe'),
  ['-a', '-c', '-f', output, '-C', directory, '.'], {stdio:'inherit', windowsHide:true});
console.log(`iCUE bridge package: ${output}`);
