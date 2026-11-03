import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const steps = [
  ['repository consistency', ['scripts/check-consistency.mjs']],
  ['generated translations', ['scripts/build-locales.mjs', '--check']],
  ...['chrome-extension', 'dev.n7s.media-controls.sdPlugin/ui', 'icue-widget/scripts'].flatMap(directory =>
    readdirSync(new URL(`../${directory}/`, import.meta.url))
      .filter(file => file.endsWith('.js')).sort()
      .map(file => [`syntax: ${directory}/${file}`, ['--check', `${directory}/${file}`]])),
  ['iCUE widget', ['scripts/check-icue.mjs']],
  ['TypeScript', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['unit tests', ['--test', '--test-timeout=120000', ...readdirSync(new URL('../tests/', import.meta.url))
    .filter(file => file.endsWith('.test.mjs')).sort().map(file => `tests/${file}`)]],
];

for (const [label, args] of steps) {
  console.log(`\n[check:fast] ${label}`);
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, ICUEWIDGET_NO_UPDATE_CHECK: '1' } });
  if (result.error || result.status !== 0) {
    console.error(`[check:fast] Failed: ${label}`, result.error?.message ?? result.signal ?? '');
    process.exit(result.status || 1);
  }
}
console.log('\n[check:fast] Passed. Native builds, browser E2E and release checks are separate.');
