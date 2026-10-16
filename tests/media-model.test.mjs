import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const ts=require('typescript');
const source = readFileSync(new URL('../src/media-model.ts',import.meta.url),'utf8');
const js = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const model=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('matches exact music with normalized names',()=>{
 assert.equal(model.sameTrack({source:'windows',title:' Song ',artist:'Artist'},{source:'chrome',title:'song',artist:'artist'}),true);
 assert.equal(model.sameTrack({source:'windows',title:'Song A'},{source:'chrome',title:'Song B'}),false);
});
test('does not mix different Windows and Chrome tracks',()=>{
 const windows={source:'windows',app_id:'Chrome',title:'Song A',artist:'Someone',artwork_data_url:'windows'};
 const chrome={source:'chrome',title:'Song B',artwork_data_url:'chrome'};
 assert.equal(model.mergedCurrent(windows,chrome),windows);
});
test('Chrome metadata enriches same playing Chrome track only',()=>{
 const windows={source:'windows',app_id:'chrome.exe',title:'Song',artist:'Artist',artwork_data_url:'old'};
 const chrome={source:'chrome',title:'song',artist:'Artist',album:'Album',artwork_data_url:'new'};
 const actual=model.mergedCurrent(windows,chrome);
 assert.equal(actual.album,'Album');
 assert.equal(actual.artwork_data_url,'new');
 assert.equal(actual.source,'windows');
});
test('never merges into non-Chrome media player',()=>{
 const windows={source:'windows',app_id:'Spotify',title:'Song'};
 const chrome={source:'chrome',title:'Song',album:'From browser'};
 assert.equal(model.mergedCurrent(windows,chrome),windows);
});
test('image validation only permits bounded safe formats',()=>{
 assert.equal(model.safeImage('data:image/png;base64,AAAA'),'data:image/png;base64,AAAA');
 assert.equal(model.safeImage('data:image/svg+xml;base64,AAAA'),undefined);
 assert.equal(model.safeImage('https://example.org/image.png'),undefined);
 assert.equal(model.safeImage('data:image/png;base64,AAAA?'),undefined);
});
