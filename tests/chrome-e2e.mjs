import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

// Uses a disposable profile. It never registers a native host or operates Stream
// Deck. Native messaging and physical device behavior have separate manual checks.
const extension=resolve('chrome-extension'),output=resolve('assets/chrome-web-store');
const capture=process.argv.includes('--screenshots');
if(capture) await mkdir(output,{recursive:true});
const images={};
for(const language of ['en','ja']) {
  const profile=await mkdtemp(join(tmpdir(),'media-bridge-e2e-'));
  let context;
  try {
    context=await chromium.launchPersistentContext(profile,{
      channel:'chromium',headless:true,locale:language,viewport:{width:1280,height:800},
      args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,`--lang=${language}`]
    });
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker',{timeout:15000});
    // Host registrations are per Windows user, not per browser profile. Block
    // native calls so this test cannot reach a host registered by the user.
    await worker.evaluate(()=>{
      globalThis.__nativeAttempts=0;
      chrome.runtime.connectNative=()=>{globalThis.__nativeAttempts++;throw new Error('E2E: native host unavailable');};
    });
    const id=new URL(worker.url()).host,base=`chrome-extension://${id}/`;
    const page=await context.newPage(),errors=[],violations=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
    page.setDefaultTimeout(10000);
    await page.addInitScript(()=>document.addEventListener('securitypolicyviolation',event=>{
      console.error(`CSP violation: ${event.effectiveDirective}`);
    }));
    context.on('request',request=>{if(/^https?:/.test(request.url())) violations.push(request.url());});
    await page.goto(base+'options.html');
    await page.waitForFunction(()=>!document.getElementById('enabled').disabled).catch(async error=>{throw new Error(`${error.message}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`);});
    await page.waitForFunction(()=>document.getElementById('connection').dataset.state==='disabled');
    assert.equal(await page.locator('#enabled').isChecked(),false);
    assert.equal(await page.locator('#save').isDisabled(),true);
    assert.equal(await page.locator('html').getAttribute('lang'),language);
    assert.equal(await page.evaluate(()=>chrome.runtime.getManifest().name),'Stream Deck Media Metadata Bridge (Local)');
    assert.equal(await page.locator('#sharing-data').isVisible(),true);
    assert.equal(await page.evaluate(()=>document.querySelector('#enabled').getAttribute('aria-describedby').split(' ').every(id=>!!document.getElementById(id))),true);
    // These are real browser screenshots of the disabled first-run state.
    if(capture) {
      const name=`setup-${language}.png`;
      await page.screenshot({path:join(output,name)});
      images[name]=createHash('sha256').update(await readFile(join(output,name))).digest('hex');
    }
    for(const colorScheme of ['light','dark']) {
      await page.emulateMedia({colorScheme});
      for(const width of [320,420,1280]) {
        await page.setViewportSize({width,height:800});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${language} ${width} ${colorScheme}: horizontal overflow`);
      }
    }
    await page.emulateMedia({colorScheme:'light'});
    await page.setViewportSize({width:1280,height:800});
    const [privacy]=await Promise.all([context.waitForEvent('page'),page.locator('a[href="privacy.html"]').click()]);
    privacy.on('pageerror',error=>errors.push(error.message));
    privacy.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
    await privacy.waitForLoadState();
    assert.equal(await privacy.locator('html').getAttribute('lang'),language);
    assert.equal(await privacy.locator('#policy-network').isVisible(),true);
    assert.equal(await privacy.locator('script[src^="http"]').count(),0);
    await privacy.close();
    // Exercise saving without a registered host: the error is presented as a
    // disconnected state and disabling remains available.
    await page.locator('#enabled').check();
    await page.locator('#save').click();
    await page.waitForFunction(()=>document.getElementById('connection').dataset.state==='disconnected');
    assert.ok(await worker.evaluate(()=>globalThis.__nativeAttempts>0));
    assert.equal(await page.evaluate(async()=>(await chrome.storage.local.get('enabled')).enabled),true);
    await page.locator('#enabled').uncheck();await page.locator('#save').click();
    await page.waitForFunction(()=>document.getElementById('connection').dataset.state==='disabled');
    await page.reload();await page.waitForFunction(()=>!document.getElementById('enabled').disabled);
    assert.equal(await page.locator('#enabled').isChecked(),false);
    assert.deepEqual(errors,[],`${language}: script or CSP errors`);
    assert.deepEqual(violations,[],`${language}: no network requests expected`);
    console.log(`${language}: extension load, default-off, privacy, save/reload, host-unavailable, narrow layout and color schemes OK`);
  } finally {
    await context?.close();
    // mkdtemp returned this exact disposable directory; no user profile is used.
    assert.equal(dirname(profile),resolve(tmpdir()));
    assert.ok(basename(profile).startsWith('media-bridge-e2e-'));
    await rm(profile,{recursive:true,force:true});
  }
}
if(capture) {
  const sources={};
  for(const path of ['chrome-extension/manifest.json','chrome-extension/options.html','chrome-extension/options.css','chrome-extension/options.js','chrome-extension/localization.js','tests/chrome-e2e.mjs']) {
    sources[path]=createHash('sha256').update((await readFile(path,'utf8')).replaceAll('\r\n','\n')).digest('hex');
  }
  await writeFile(join(output,'screenshots.json'),JSON.stringify({
    method:'Playwright Chromium; real extension first-run options page; sending disabled; native host calls stubbed to fail so no user host is contacted',
    sources,images
  },null,2)+'\n');
}
