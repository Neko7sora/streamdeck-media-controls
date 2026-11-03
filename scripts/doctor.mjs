import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

let failures = 0;
function report(ok, label, advice) {
  console.log(`${ok ? 'OK' : 'MISSING'} ${label}${ok ? '' : ` — ${advice}`}`);
  if (!ok) failures++;
}
report(Number(process.versions.node.split('.')[0]) >= 24, `Node ${process.versions.node}`, 'Install Node.js 24 or later.');
for (const name of ['typescript', 'esbuild', 'sharp', 'icuewidget-cli']) {
  report(existsSync(new URL(`../node_modules/${name}/package.json`, import.meta.url)), name, 'Run npm ci from the repository root.');
}
const git = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true });
report(git.status === 0, 'Git', 'Install Git and add it to PATH.');
const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8', windowsHide: true });
console.log(`INFO Native build: platform=${process.platform}, arch=${process.arch}, cargo=${cargo.status === 0 ? 'available' : 'missing'}. Requires Windows x64 and Visual Studio C++ build tools.`);
console.log('INFO Browser E2E requires npm run test:chrome:install. Hardware acceptance requires Stream Deck.');
console.log('INFO This checks prerequisites only; run node scripts/check-fast.mjs to verify source.');
process.exitCode = failures ? 1 : 0;
