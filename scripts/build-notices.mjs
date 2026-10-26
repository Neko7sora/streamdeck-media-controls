import {readFileSync,readdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const root=resolve(import.meta.dirname,'..');
const output=join(root,'dev.n7s.media-controls.sdPlugin/THIRD_PARTY_NOTICES.txt');
const normalize=text=>text.replaceAll('\r\n','\n').trimEnd();
const read=path=>normalize(readFileSync(path,'utf8'));

export function noticeFiles(directory) {
  return readdirSync(directory,{withFileTypes:true}).filter(entry=>entry.isFile()&&
    /^(?:licen[sc]e|copying|copyright|notice|third.party.notices)(?:$|[-_.])/i.test(entry.name))
    .map(entry=>entry.name).sort();
}

export function generateNotices() {
  const sections=[`Media Controls: third-party notices

Generated from installed npm runtime dependencies and locked Cargo dependencies.
Includes build dependencies conservatively. Development tools are not distributed.
These notices do not grant a license to Media Controls itself.
System fonts and the Stream Deck-provided Node.js runtime are not bundled here.

The sharp Windows runtime also includes native libraries listed in its upstream
README and versions.json below. Their source/redistribution review is tracked in
docs/release-review.json; this inventory alone does not certify those obligations.`];
  const packages=new Set();
  function npmPackage(name,from=root) {
    const require=createRequire(join(from,'package.json'));
    let manifest;
    try {manifest=require.resolve(`${name}/package.json`);}
    catch {
      manifest=(require.resolve.paths(name)??[]).map(directory=>join(directory,name,'package.json')).find(existsSync);
      if(!manifest) throw new Error(`Missing package metadata: ${name}`);
    }
    if(packages.has(manifest)) return;
    packages.add(manifest);
    const directory=dirname(manifest),pkg=JSON.parse(readFileSync(manifest,'utf8'));
    const files=noticeFiles(directory);
    if(!pkg.license||!files.length) throw new Error(`Missing license for ${pkg.name}`);
    sections.push(`npm: ${pkg.name}@${pkg.version}\nDeclared license: ${pkg.license}`);
    for(const file of files) sections.push(`${pkg.name}/${file}\n\n${read(join(directory,file))}`);
    if(pkg.name.startsWith('@img/sharp-')) for(const file of ['README.md','versions.json']) {
      if(existsSync(join(directory,file))) sections.push(`${pkg.name}/${file}\n\n${read(join(directory,file))}`);
    }
    for(const dependency of Object.keys(pkg.dependencies??{}).sort()) npmPackage(dependency,directory);
    for(const dependency of Object.keys(pkg.optionalDependencies??{}).sort()) {
      // Match the image-runtime build's installed optional packages.
      if(existsSync(join(root,'node_modules',dependency,'package.json'))) npmPackage(dependency,directory);
    }
  }
  for(const name of ['@elgato/streamdeck','sharp']) npmPackage(name);
  for(const project of ['media-info','media-keys']) {
    const metadata=JSON.parse(execFileSync('cargo',['metadata','--locked','--offline','--format-version','1',
      '--manifest-path',join(root,`native/${project}/Cargo.toml`)],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024}));
    for(const pkg of metadata.packages.filter(pkg=>pkg.source).sort((a,b)=>a.id.localeCompare(b.id,'en'))) {
      if(packages.has(pkg.id)) continue;
      packages.add(pkg.id);
      const directory=dirname(pkg.manifest_path),files=noticeFiles(directory);
      if(pkg.license_file&&!files.includes(pkg.license_file)) files.push(pkg.license_file);
      if(!files.length) throw new Error(`Missing license text for ${pkg.name}@${pkg.version}`);
      sections.push(`Cargo: ${pkg.name}@${pkg.version}\nDeclared license: ${pkg.license??'see license file'}\nSource: https://crates.io/crates/${pkg.name}/${pkg.version}`);
      for(const file of files) sections.push(`${pkg.name}/${file}\n\n${read(join(directory,file))}`);
    }
  }
  return sections.join('\n\n'+'='.repeat(72)+'\n\n')+'\n';
}

export function buildNotices(check=false) {
  const expected=generateNotices();
  if(check) {
    if(!existsSync(output)||normalize(readFileSync(output,'utf8'))!==normalize(expected)) throw new Error('Stale third-party notices; run npm run notices:build');
  } else writeFileSync(output,expected);
  console.log(`Third-party notices: ${check?'verified':'generated'}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) buildNotices(process.argv.includes('--check'));
