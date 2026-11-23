import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from './load.mjs';
const {receiveChromeDeepLink,takeChromeDeepLink}=await load('chrome/chrome-deep-link');
const id='a'.repeat(32);
function link(href) {
  const url=new URL(href,'https://local.invalid');
  return {href,path:url.pathname,fragment:url.hash.slice(1),queryParameters:url.searchParams};
}
test('setup links stage an ID once without registering a native host',()=>{
  assert.equal(receiveChromeDeepLink(link(`/chrome/setup?extensionId=${id}`)),true);
  assert.equal(takeChromeDeepLink(),id);
  assert.equal(takeChromeDeepLink(),undefined);
});
test('rejects unknown routes, duplicate IDs, arbitrary parameters and oversized links',()=>{
  for(const href of [`/other?extensionId=${id}`, '/chrome/setup', '/chrome/setup?extensionId=invalid',`/chrome/setup?extensionId=${id}&extensionId=${id}`,`/chrome/setup?extensionId=${id}&callback=https://evil.test`,`/chrome/setup?extensionId=${id}#fragment`,`/chrome/setup?extensionId=${'a'.repeat(2000)}`]) {
    assert.equal(receiveChromeDeepLink(link(href)),false,href);
    assert.equal(takeChromeDeepLink(),undefined);
  }
});
