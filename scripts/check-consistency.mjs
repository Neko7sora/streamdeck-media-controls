import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));

export function checkMetadata(pkg,lock,plugin,chrome,review) {
  assert.equal(lock.name,pkg.name,'Lockfile name must match package.json');
  assert.equal(lock.version,pkg.version,'Lockfile version must match package.json');
  for(const field of ['name','version','license','engines','dependencies','devDependencies','optionalDependencies']) {
    assert.deepEqual(lock.packages?.['']?.[field],pkg[field],`Lockfile root ${field} must match package.json`);
  }
  assert.match(pkg.version,/^\d+\.\d+\.\d+$/,'Use a three-part release version');
  assert.equal(plugin.Version,`${pkg.version}.0`,'Plugin version must match package.json');
  assert.equal(chrome.version,pkg.version,'Chrome version must match package.json');
  assert.equal(review.version,pkg.version,'Review version must match package.json');
  assert.equal(review.makerOrganization,plugin.Author,'Review organization must match the plugin author');
  assert.equal(pkg.engines?.node,`>=${plugin.Nodejs?.Version}.0.0`,'Build and plugin Node.js requirements must match');
}

export function documentProblems(file,source,scripts,exists=existsSync) {
  const problems=[];
  // Fenced samples can illustrate Markdown links without referencing real files.
  // npm commands are checked even in samples, since readers run those commands.
  const prose=source.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm,'');
  for(const match of prose.matchAll(/\]\(([^)]+)\)/g)) {
    const link=match[1];
    if(/^[a-z][a-z\d+.-]*:|^#|^\/\//i.test(link)) continue;
    const path=link.split('#')[0];
    if(!path) continue;
    try {
      if(!exists(resolve(dirname(file),decodeURIComponent(path)))) problems.push(`Missing document link: ${file}: ${link}`);
    } catch {problems.push(`Invalid document link: ${file}: ${link}`);}
  }
  for(const match of source.matchAll(/\bnpm run ([\w:-]+)/g)) {
    if(!Object.hasOwn(scripts,match[1])) problems.push(`Unknown npm script: ${file}: ${match[1]}`);
  }
  return problems;
}

export function checkConsistency() {
  const read=path=>readFileSync(join(root,path),'utf8');
  const json=path=>JSON.parse(read(path));
  const pkg=json('package.json');
  checkMetadata(pkg,json('package-lock.json'),json('dev.n7s.media-controls.sdPlugin/manifest.json'),
    json('chrome-extension/manifest.json'),json('docs/release-review.json'));
  const documents=readdirSync(root).filter(file=>file.endsWith('.md'));
  for(const directory of ['docs','locales']) {
    for(const file of readdirSync(join(root,directory),{recursive:true})) {
      if(file.endsWith('.md')) documents.push(join(directory,file));
    }
  }
  const problems=documents.flatMap(file=>documentProblems(join(root,file),read(file),pkg.scripts));
  assert.deepEqual(problems,[],problems.join('\n'));
  console.log(`Repository consistency: metadata, links and npm references OK (${documents.length} documents)`);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) checkConsistency();
