import {test} from 'node:test';
import assert from 'node:assert/strict';
import {linkSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {marketplaceImagePaths,marketplaceOutputPaths} from '../scripts/marketplace-paths.mjs';

test('marketplace image paths stay inside the generated PNG directory', () => {
  const listing=JSON.parse(readFileSync(fileURLToPath(new URL('../docs/marketplace/listing.en.json',import.meta.url))));
  assert.deepEqual(marketplaceImagePaths(listing),[listing.appIcon,listing.thumbnail,...listing.gallery]);
  for(const path of [
    'docs/marketplace/sentinel.png',
    'assets/marketplace/../../docs/marketplace/sentinel.png',
    'assets\\marketplace\\thumbnail.png',
    'C:\\outside\\sentinel.png',
    '//server/share/sentinel.png',
    'assets/marketplace/not-a-png.svg'
  ]) {
    const changed=structuredClone(listing);
    changed.gallery[2]=path;
    assert.throws(()=>marketplaceImagePaths(changed),/Marketplace media must be local PNG assets/,path);
  }
  assert.throws(()=>marketplaceImagePaths({...listing,gallery:[]}),/Provide 3–10 gallery items/);
  assert.throws(()=>marketplaceImagePaths({...listing,thumbnail:listing.appIcon}),/Provide separate/);
});

test('marketplace output rejects linked files and directories', t => {
  const root=mkdtempSync(join(tmpdir(),'marketplace-paths-'));
  const directory=join(root,'assets/marketplace');
  const target=join(directory,'image.png');
  const outside=join(root,'outside.png');
  const image='assets/marketplace/image.png';
  try {
    mkdirSync(directory,{recursive:true});
    writeFileSync(outside,'untouched');
    assert.deepEqual(marketplaceOutputPaths(root,[image]),[target]);
    linkSync(outside,target);
    assert.throws(()=>marketplaceOutputPaths(root,[image]),/unlinked regular file/);
    unlinkSync(target);
    try {
      symlinkSync(outside,target,'file');
      assert.throws(()=>marketplaceOutputPaths(root,[image]),/unlinked regular file/);
      unlinkSync(target);
    } catch(error) {
      if(error.code!=='EPERM'&&error.code!=='EACCES') throw error;
      t.diagnostic(`File symlink setup unavailable: ${error.code}`);
    }
    try {
      rmSync(directory,{recursive:true});
      const other=join(root,'other');
      mkdirSync(other);
      symlinkSync(other,directory,'junction');
      assert.throws(()=>marketplaceOutputPaths(root,[image]),/output directory must not be a link/);
      unlinkSync(directory);
    } catch(error) {
      if(error.code!=='EPERM'&&error.code!=='EACCES') throw error;
      t.diagnostic(`Directory junction setup unavailable: ${error.code}`);
    }
    assert.equal(readFileSync(outside,'utf8'),'untouched');
  } finally {
    rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
