import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {assembleUniversal,bundleTargets,checkUniversalBundle} from '../scripts/assemble-universal.mjs';

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'sdmc-universal-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const input=join(root,'input'),output=join(root,'output','dev.n7s.media-controls.sdPlugin');
  const lock={packages:{}};
  function write(path,text) {mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);}
  for(const target of bundleTargets) {
    const directory=join(input,target,'dev.n7s.media-controls.sdPlugin');
    write(join(directory,'bin/plugin.js'),'shared runtime');
    write(join(directory,'manifest.json'),'shared manifest');
    for(const file of target==='win32-x64'?['media-info.exe','media-keys.exe']:['media-info.mjs','media.js']) write(join(directory,'native',file),file);
    const packages=[`@img/sharp-${target}`,...(target.startsWith('darwin-')?[`@img/sharp-libvips-${target}`]:[])];
    for(const name of packages) {
      const pkg={name,version:'1.2.3'};
      lock.packages[`node_modules/${name}`]=pkg;
      write(join(directory,'node_modules',name,'package.json'),JSON.stringify(pkg));
      write(join(directory,'node_modules',name,name.includes('libvips')?'lib/example.dylib':'lib/example.node'),'native binary');
    }
    write(join(directory,target==='win32-x64'?'THIRD_PARTY_NOTICES.txt':'THIRD_PARTY_NOTICES.macos.txt'),packages.map(name=>`npm: ${name}@1.2.3\nLicense text\n`).join('\n'));
    // Tracked notices for the other OS must not overwrite freshly generated ones.
    write(join(directory,target==='win32-x64'?'THIRD_PARTY_NOTICES.macos.txt':'THIRD_PARTY_NOTICES.txt'),'stale tracked notice');
  }
  return {input,output,lock,write};
}

test('universal packaging preserves all three native runtimes, helpers and license inventories',t=>{
  const {input,output,lock}=fixture(t);
  assembleUniversal(input,output,lock);
  checkUniversalBundle(output,lock);
  assert.equal(readFileSync(join(output,'bin/plugin.js'),'utf8'),'shared runtime');
  assert.equal(existsSync(join(output,'THIRD_PARTY_NOTICES.macos.txt')),false);
  assert.match(readFileSync(join(output,'THIRD_PARTY_NOTICES.macos-x64.txt'),'utf8'),/sharp-darwin-x64/);
  assert.throws(()=>assembleUniversal(input,output,lock),/Output already exists/);
  assert.equal(readFileSync(join(output,'bin/plugin.js'),'utf8'),'shared runtime');
});

test('Windows Git checkout settings preserve identical shared bundle files',t=>{
  const {input,output,lock,write}=fixture(t);
  const repository=join(dirname(input),'repository');
  const contents=new Map(['LICENSE','LICENSE-MIT','LICENSE-APACHE']
    .map(file=>[file,readFileSync(new URL(`../${file}`,import.meta.url))]));
  contents.set('bin/plugin.js',Buffer.from('export const shared = true;\n'));
  contents.set('manifest.json',Buffer.from('{"shared":true}\n'));
  // A binary containing CRLF must remain byte-identical, too.
  contents.set('imgs/example.png',Buffer.from([0,137,80,78,71,13,10,26,10]));
  write(join(repository,'.gitattributes'),readFileSync(new URL('../.gitattributes',import.meta.url)));
  for(const [file,content] of contents) write(join(repository,file),content);
  const git=(...args)=>execFileSync('git',['-C',repository,...args],{windowsHide:true,stdio:'pipe'});
  git('init','--template=');
  git('-c','core.autocrlf=false','add','.');
  for(const target of bundleTargets) {
    const directory=join(input,target,'dev.n7s.media-controls.sdPlugin');
    const windows=target==='win32-x64';
    git('-c',`core.autocrlf=${windows}`,'-c',`core.eol=${windows?'crlf':'lf'}`,
      'checkout-index','--all','--force',`--prefix=${directory.replaceAll('\\','/')}/`);
    for(const [file,content] of contents) assert.deepEqual(readFileSync(join(directory,file)),content,`${target}: ${file}`);
  }
  assembleUniversal(input,output,lock);
  for(const [file,content] of contents) assert.deepEqual(readFileSync(join(output,file)),content,file);
});

test('conflicting shared code or license text fails packaging and removes incomplete output',async t=>{
  for(const file of ['bin/plugin.js','LICENSE']) {
    await t.test(file,t=>{
      const {input,output,lock,write}=fixture(t);
      write(join(input,'win32-x64/dev.n7s.media-controls.sdPlugin',file),'original content\n');
      write(join(input,'darwin-x64/dev.n7s.media-controls.sdPlugin',file),'different content\n');
      assert.throws(()=>assembleUniversal(input,output,lock),/Conflicting bundle file/);
      assert.equal(existsSync(output),false);
    });
  }
});

test('missing architectures, native binaries or licenses cannot produce a universal package',async t=>{
  for(const missing of ['node_modules/@img/sharp-darwin-x64','node_modules/@img/sharp-libvips-darwin-x64/lib/example.dylib','native/media-info.exe','THIRD_PARTY_NOTICES.macos.txt']) {
    await t.test(missing,t=>{
      const {input,output,lock}=fixture(t);
      const target=missing.endsWith('.exe')?'win32-x64':'darwin-x64';
      rmSync(join(input,target,'dev.n7s.media-controls.sdPlugin',missing),{recursive:true});
      assert.throws(()=>assembleUniversal(input,output,lock));
      assert.equal(existsSync(output),false);
    });
  }
});

test('runtime versions and their license inventories must match the locked dependencies',t=>{
  const {input,output,lock,write}=fixture(t);
  lock.packages['node_modules/@img/sharp-darwin-x64'].version='9.9.9';
  assert.throws(()=>assembleUniversal(input,output,lock),/Unexpected image runtime/);
  lock.packages['node_modules/@img/sharp-darwin-x64'].version='1.2.3';
  write(join(input,'darwin-x64/dev.n7s.media-controls.sdPlugin/THIRD_PARTY_NOTICES.macos.txt'),'incomplete licenses');
  assert.throws(()=>assembleUniversal(input,output,lock),/Missing license inventory/);
});
