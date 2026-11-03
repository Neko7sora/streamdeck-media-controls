import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPackage} from '../node_modules/icuewidget-cli/src-node/zip.js';
import {validateIcueWidget} from './check-icue.mjs';
import {buildIcueHtml} from './icue-widget-html.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'icue-widget');
const generated = join(root, 'tests', '.generated');
const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid widget version');
const output = join(root, `icue-widget-${manifest.version}.icuewidget`);
await mkdir(generated, {recursive:true});
const staging = await mkdtemp(join(generated, 'icue-package-'));
try {
  // Ship only runtime files. In particular, the demo provider must never enter iCUE.
  for (const file of ['manifest.json', 'translation.json', 'scripts/widget.js', 'scripts/bridge.js', 'styles/style.css',
    'resources/icon.svg', 'resources/icon.png', 'resources/preview.png']) {
    const destination = join(staging, file);
    await mkdir(dirname(destination), {recursive:true});
    await copyFile(join(source, file), destination);
  }
  const html = await buildIcueHtml(source);
  await writeFile(join(staging, 'index.html'), html);
  for (const file of ['LICENSE-MIT', 'LICENSE-APACHE']) await copyFile(join(root, file), join(staging, file));
  await validateIcueWidget(staging);
  // Use the locked official ZIP writer with the original, runtime-compatible manifest.
  await createPackage(staging, output);
  console.log(`iCUE package: ${output}`);
} finally {
  // Verify the absolute deletion target stays inside this checkout's generated test output.
  const inside = relative(resolve(generated), resolve(staging));
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Unsafe staging cleanup path');
  await rm(staging, {recursive:true, force:true});
}
