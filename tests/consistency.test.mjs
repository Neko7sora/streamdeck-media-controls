import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkMetadata,documentProblems} from '../scripts/check-consistency.mjs';

const metadata=()=>{
  const pkg={name:'media-controls',version:'1.0.0',license:'(MIT OR Apache-2.0)',engines:{node:'>=24.0.0'},dependencies:{runtime:'^1.0.0'}};
  return [pkg,{name:pkg.name,version:pkg.version,packages:{'':structuredClone(pkg)}},
    {Version:'1.0.0.0',Author:'Maker',Nodejs:{Version:'24'}},{version:'1.0.0'},{version:'1.0.0',makerOrganization:'Maker'}];
};

test('shared release metadata rejects drift across lockfile, manifests and review record',()=>{
  assert.doesNotThrow(()=>checkMetadata(...metadata()));
  for(const change of [
    values=>{values[1].version='0.9.0';},
    values=>{values[1].packages[''].dependencies.runtime='^2.0.0';},
    values=>{values[1].packages[''].license='MIT';},
    values=>{values[2].Version='0.9.0.0';},
    values=>{values[3].version='0.9.0';},
    values=>{values[4].version='0.9.0';},
    values=>{values[4].makerOrganization='Other';},
    values=>{values[2].Nodejs.Version='22';}
  ]) {
    const values=metadata();change(values);
    assert.throws(()=>checkMetadata(...values));
  }
});

test('document references report broken local links and unknown npm commands',()=>{
  const source='[Guide](guide.md#setup) [Missing](missing.md) [Space](a%20b.md) [Web](https://example.test/) [Anchor](#setup)\n`npm run check` `npm run typo`';
  const problems=documentProblems('/repo/README.md',source,{check:'node check.mjs'},path=>!path.endsWith('missing.md'));
  assert.equal(problems.length,2);
  assert.match(problems[0],/Missing document link: .*missing\.md/);
  assert.match(problems[1],/Unknown npm script: .*typo/);
  assert.deepEqual(documentProblems('/repo/README.md','```markdown\n[Example](not-a-real-file.md)\n```',{},()=>false),[]);
  assert.match(documentProblems('/repo/README.md','```sh\nnpm run missing\n```',{})[0],/Unknown npm script/);
});
