import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

for(const script of ['page-main.js','bridge-isolated.js']) {
  const source=readFileSync(new URL(`../chrome-extension/${script}`,import.meta.url),'utf8');
  test(`${script} leaves opaque and mismatched frames untouched`,()=>{
    for(const [origin,urlOrigin] of [
      ['null','https://cdn.platform.openai.com'],
      ['null','null'],
      ['https://other.test','https://media.test'],
      [undefined,'https://media.test']
    ]) {
      // Any API wrapping, timer, listener or message would access missing APIs
      // and fail. Even with no media, the old MAIN script attempted a send.
      assert.doesNotThrow(()=>vm.runInNewContext(source,{
        window:{origin},location:{origin:urlOrigin}
      }),`${origin} / ${urlOrigin}`);
    }
  });
}
