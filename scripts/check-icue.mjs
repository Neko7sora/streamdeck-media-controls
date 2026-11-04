import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {checkIcuePresentation} from './check-icue-presentation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const generated = join(root, 'tests/.generated');

export function cliValidationManifest(manifest) {
  const copy = structuredClone(manifest);
  if (Array.isArray(copy.permissions)) for (const permission of copy.permissions) {
    // iCUE 5.52.93's importer uses self-signed-certificate/domain. Its internal
    // store and the docs / CLI 0.5.1 use self_signed_certificate/host.
    if (permission?.type === 'self_signed_certificate') {
      throw new Error('iCUE manifest must use self-signed-certificate (hyphens); the underscore spelling fails import in iCUE 5.52.93');
    }
    if (permission?.type === 'self-signed-certificate') {
      if (Object.hasOwn(permission, 'host')) throw new Error('iCUE certificate permission must use domain, not host');
      permission.type = 'self_signed_certificate';
      if (Object.hasOwn(permission, 'domain')) {
        permission.host = permission.domain;
        delete permission.domain;
      }
    }
  }
  return copy;
}

export async function validateIcueWidget(source) {
  await mkdir(generated, {recursive:true});
  const staging = await mkdtemp(join(generated, 'icue-validation-'));
  try {
    // Validate an isolated copy, leaving runtime source and package bytes intact.
    await cp(source, staging, {recursive:true});
    const manifest = JSON.parse(await readFile(join(staging, 'manifest.json'), 'utf8'));
    await writeFile(join(staging, 'manifest.json'), JSON.stringify(cliValidationManifest(manifest), null, 2) + '\n');
    const result = spawnSync(process.execPath, [join(root, 'node_modules/icuewidget-cli/node-bin/icuewidget.js'),
      'validate', staging], {cwd:root, stdio:'inherit', windowsHide:true,
      env:{...process.env, ICUEWIDGET_NO_UPDATE_CHECK:'1'}});
    if (result.error || result.status !== 0) throw result.error ?? new Error(`iCUE validation failed (${result.status})`);
    await checkIcuePresentation(staging);
    console.log('iCUE validation: CLI 0.5.1 certificate type/domain adapted on a temporary copy; runtime permissions preserved.');
  } finally {
    const inside = relative(resolve(generated), resolve(staging));
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Unsafe validation cleanup path');
    await rm(staging, {recursive:true, force:true, maxRetries:5, retryDelay:100});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await validateIcueWidget(resolve(process.argv[2] ?? join(root, 'icue-widget')));
}
