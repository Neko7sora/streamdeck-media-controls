import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {buildIcueBridge} from './build-icue-bridge.mjs';
const directory = await buildIcueBridge();
const child = spawn(process.execPath, [join(directory, 'bin/icue-bridge.mjs'), ...process.argv.slice(2)],
  {stdio:'inherit', windowsHide:true});
child.on('error', error => {console.error(error.message); process.exitCode = 1;});
child.on('exit', code => {process.exitCode = code ?? 1;});
