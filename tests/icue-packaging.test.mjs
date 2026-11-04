import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {isAbsolute, join, relative, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {cliValidationManifest} from '../scripts/check-icue.mjs';
import {buildIcueHtml} from '../scripts/icue-widget-html.mjs';
import {checkIcuePresentation} from '../scripts/check-icue-presentation.mjs';
import sharp from 'sharp';

test('iCUE presentation rejects oversized previews, missing English labels and invalid property references', async () => {
  const generated = fileURLToPath(new URL('.generated/', import.meta.url));
  await mkdir(generated, {recursive:true});
  const directory = await mkdtemp(join(generated, 'icue-presentation-test-'));
  try {
    await mkdir(join(directory, 'resources'));
    for (const file of ['index.html', 'translation.json', 'resources/preview.png']) {
      await copyFile(new URL(`../icue-widget/${file}`, import.meta.url), join(directory, file));
    }
    const html = await readFile(join(directory, 'index.html'), 'utf8');
    const translation = await readFile(join(directory, 'translation.json'), 'utf8');
    await checkIcuePresentation(directory);
    await sharp({create:{width:840,height:344,channels:3,background:'#000000'}}).png().toFile(join(directory, 'resources/preview.png'));
    await assert.rejects(checkIcuePresentation(directory), /128 × 56.*840 × 344/);
    await copyFile(new URL('../icue-widget/resources/preview.png', import.meta.url), join(directory, 'resources/preview.png'));
    await writeFile(join(directory, 'index.html'), html.replace('content="resources/preview.png"', 'content="../preview.png"'));
    await assert.rejects(checkIcuePresentation(directory), /must stay inside/);
    await writeFile(join(directory, 'index.html'), html.replace('content="bridgeToken"', 'content="useBridge"'));
    await assert.rejects(checkIcuePresentation(directory), /Duplicate iCUE property ID/);
    await writeFile(join(directory, 'index.html'), html.replace('"properties":["useBridge","bridgeToken"]', '"properties":["missingProperty"]'));
    await assert.rejects(checkIcuePresentation(directory), /Undeclared iCUE property/);
    await writeFile(join(directory, 'index.html'), html);
    const translations = JSON.parse(translation);
    delete translations.en.translation['Bridge Token'];
    await writeFile(join(directory, 'translation.json'), JSON.stringify(translations));
    await assert.rejects(checkIcuePresentation(directory), /Missing iCUE English translation: Bridge Token/);
    // A partial Japanese catalog is supported: missing keys use English.
    translations.en.translation['Bridge Token'] = 'Bridge Token';
    translations.ja.translation = {};
    await writeFile(join(directory, 'translation.json'), JSON.stringify(translations));
    await checkIcuePresentation(directory);
    delete translations.en;
    await writeFile(join(directory, 'translation.json'), JSON.stringify(translations));
    await assert.rejects(checkIcuePresentation(directory), /English fallback/);
  } finally {
    const inside = relative(resolve(generated), resolve(directory));
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Unsafe presentation test cleanup path');
    await rm(directory, {recursive:true, force:true, maxRetries:5, retryDelay:100});
  }
});

test('iCUE package evaluates runtime scripts in the host property scope without the demo', async () => {
  const source = fileURLToPath(new URL('../icue-widget/',import.meta.url));
  const html = await buildIcueHtml(source);
  assert.equal(/<script\s+src=/.test(html),false);
  assert.equal(html.includes('demo-provider.js'),false);
  for (const name of ['bridge','widget']) assert.ok(html.includes(await readFile(join(source,`scripts/${name}.js`),'utf8')));
  const head = html.split('</head>')[0];
  assert.equal(/<script(?! type="application\/json")/.test(head),false,'runtime code must stay in the body');
});

test('iCUE certificate compatibility preserves the permission scope and rejects the import-breaking spelling', () => {
  const runtime = {permissions:[{type:'url',domain:'127.0.0.1',port:39762},
    {type:'self-signed-certificate',domain:'127.0.0.1'}]};
  const before = structuredClone(runtime);
  assert.deepEqual(cliValidationManifest(runtime), {permissions:[{type:'url',domain:'127.0.0.1',port:39762},
    {type:'self_signed_certificate',host:'127.0.0.1'}]});
  assert.deepEqual(runtime,before,'validation must never change the runtime manifest');
  assert.throws(() => cliValidationManifest({permissions:[{type:'self_signed_certificate',host:'127.0.0.1'}]}), /fails import/);
  assert.throws(() => cliValidationManifest({permissions:[{type:'self-signed-certificate',host:'127.0.0.1'}]}), /must use domain/);
});

test('iCUE compatibility still runs the official host, schema and permission-usage checks', async () => {
  const generated = fileURLToPath(new URL('.generated/',import.meta.url));
  await mkdir(generated,{recursive:true});
  const directory = await mkdtemp(join(generated,'icue-compat-test-'));
  try {
    await cp(new URL('../icue-widget/',import.meta.url),directory,{recursive:true});
    const path = join(directory,'manifest.json');
    const original = await readFile(path,'utf8');
    const check = () => spawnSync(process.execPath,['scripts/check-icue.mjs',directory],{encoding:'utf8',windowsHide:true});
    assert.equal(check().status,0);
    assert.equal(await readFile(path,'utf8'),original);
    const invalidHost = JSON.parse(original);
    invalidHost.permissions.find(p=>p.type==='self-signed-certificate').domain = 'https://127.0.0.1:39762';
    await writeFile(path,JSON.stringify(invalidHost));
    const hostResult = check();
    assert.notEqual(hostResult.status,0); assert.match(hostResult.stdout+hostResult.stderr,/bare hostname/);
    const unknown = JSON.parse(original); unknown.permissions.push({type:'invented_permission'});
    await writeFile(path,JSON.stringify(unknown));
    assert.notEqual(check().status,0);
    await writeFile(path,original);
    await writeFile(join(directory,'scripts/bridge.js'), 'fetch("https://undeclared.example/state");');
    const network = check();
    assert.notEqual(network.status,0); assert.match(network.stdout+network.stderr,/undeclared\.example/);
  } finally {
    const inside = relative(resolve(generated),resolve(directory));
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Unsafe compatibility test cleanup path');
    await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
