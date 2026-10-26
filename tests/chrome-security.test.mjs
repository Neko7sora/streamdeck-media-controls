import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkChromeSecurity,readChromePackage} from '../scripts/check-chrome-security.mjs';

const packaged=await readChromePackage();
function check({code,html,css,csp,manifest={}}={}) {
  const files=new Map(packaged.files);
  if(code!==undefined) files.set('background.js',code);
  if(html!==undefined) files.set('options.html',html);
  if(css!==undefined) files.set('options.css',css);
  const settings={...structuredClone(packaged.manifest),...manifest};
  if(csp!==undefined) settings.content_security_policy.extension_pages=csp;
  return checkChromeSecurity(settings,files);
}

test('the shipped extension uses only packaged code and a restrictive MV3 CSP',()=>check());

test('rejects invalid JavaScript and TypeScript-only syntax',()=>{
  for(const code of ['const broken = ;','const value: string = "text";']) {
    assert.throws(()=>check({code}),/invalid JavaScript/,code);
  }
});

test('rejects string execution, aliases, string timers and remote code loaders',()=>{
  for(const code of [
    'eval(remote)', '(0,eval)(remote)', 'const run=globalThis["eval"];run(remote)',
    'new Function(remote)', 'const build=window.Function;build(remote)',
    'const {eval:run}=globalThis;run(remote)',
    'setTimeout("run()",10)', 'window.setInterval(`run()`,10)',
    'importScripts("https://cdn.test/library.js")', 'importScripts(url)',
    'import("//cdn.test/library.js")', 'import(url)',
    'import lib from "https://cdn.test/library.js"',
    'export * from "https://cdn.test/library.js"',
    'new Worker("data:text/javascript,run()")', 'new SharedWorker(url)',
    'WebAssembly.instantiateStreaming(fetch(url))',
    'chrome.tabs.executeScript({code:remote})',
    'document.createElement("script")',
    'importScripts("missing.js")', 'importScripts("../outside.js")'
  ]) assert.throws(()=>check({code}),undefined,code);
});

test('allows packaged imports, function timers, image fetches and code-like data',()=>{
  assert.doesNotThrow(()=>check({code:`
    importScripts("localization.js");
    import("./localization.js");
    setTimeout(()=>{},10);setInterval(tick,10);
    fetch("https://images.test/cover.png");
    const label="eval() new Function() https://example.test/code.js";
    // eval(remote); importScripts("https://cdn.test/library.js");
  `}));
});

test('rejects remote, inline and missing HTML resources while allowing support links',()=>{
  for(const html of [
    '<script src="//cdn.test/code.js"></script>',
    '<script src=data:text/javascript,run()></script>',
    '<script>run()</script>', '<script src="options.js">run()</script>',
    '<script src="https://cdn.test/code.js">',
    '<script data-src="options.js" src="https://cdn.test/code.js"></script>',
    '<button onclick = "run()">Run</button>', '<a href="javascript:run()">Run</a>',
    '<script src="missing.js"></script>',
    '<link rel="stylesheet" href="https://cdn.test/style.css">',
    '<link rel="stylesheet" data-href="options.css" href="https://cdn.test/style.css">',
    '<iframe src="https://cdn.test/"></iframe>'
  ]) assert.throws(()=>check({html}),undefined,html);
  assert.doesNotThrow(()=>check({html:'<link rel="stylesheet" href="options.css"><script src="options.js"></script><a href="https://github.com/">Support</a>'}));
});

test('rejects imported and remote CSS resources',()=>{
  for(const css of ['@import "https://cdn.test/style.css";','a {background:url(//cdn.test/style.css)}']) assert.throws(()=>check({css}));
  assert.doesNotThrow(()=>check({css:'a {background:url("icons/icon-16.png")}'}));
});

test('rejects CSP relaxations including overriding directives and sandbox escapes',()=>{
  const csp=packaged.manifest.content_security_policy.extension_pages;
  for(const unsafe of [
    csp.replace("script-src 'self'","script-src 'self' 'unsafe-eval'"),
    csp.replace("script-src 'self'","script-src https:"),
    csp.replace("object-src 'none'","object-src https:"),
    csp+"; script-src-elem https:",csp+"; script-src-attr 'unsafe-inline'",
    csp+"; worker-src blob:",csp+"; child-src https:",csp+"; script-src 'none'"
  ]) assert.throws(()=>check({csp:unsafe}),undefined,unsafe);
  assert.throws(()=>check({manifest:{content_security_policy:csp}}));
  assert.throws(()=>check({manifest:{sandbox:{pages:['options.html']}}}));
  assert.throws(()=>check({manifest:{background:{service_worker:'https://cdn.test/worker.js'}}}));
  assert.throws(()=>check({manifest:{content_scripts:[{js:['missing.js']}]}}));
});
