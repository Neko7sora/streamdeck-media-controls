import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';

// Render the real property inspector with a fake Stream Deck socket. Never
// register a native host or change the user's installed plugin preferences.
const browser=await chromium.launch({headless:true});
try {
  for(const language of ['ja','en']) {
    const page=await browser.newPage({viewport:{width:360,height:900},locale:language});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      window.sent=[];
      window.WebSocket=class {
        static OPEN=1;readyState=0;
        constructor(){window.mockSocket=this;}
        send(raw){window.sent.push(JSON.parse(raw));}
      };
    });
    await page.goto(new URL('../dev.n7s.media-controls.sdPlugin/ui/settings.html',import.meta.url).href);
    await page.evaluate(language=>{
      window.connectElgatoStreamDeckSocket(1234,'context','registerPropertyInspector',JSON.stringify({application:{language}}),JSON.stringify({action:'dev.n7s.media-controls.now-playing',payload:{settings:{}}}));
      mockSocket.readyState=1;mockSocket.onopen();
      window.receive=payload=>mockSocket.onmessage({data:JSON.stringify({event:'sendToPropertyInspector',payload})});
      receive({protocol:2,chromeIntegration:{enabled:true,ready:true,state:'running',extensionId:'a'.repeat(32)},chromeConnection:{state:'connected',sessions:1},icueIntegration:{enabled:false,ready:true,state:'disabled'}});
    },language);
    await page.locator('#chrome-setup-link').click();
    assert.equal(await page.locator('#chrome-enabled').isEnabled(),true);
    assert.equal(await page.locator('#chrome-extension-id').inputValue(),'a'.repeat(32));
    await page.locator('#chrome-enabled').focus();await page.keyboard.press('Space');
    const request=await page.evaluate(()=>sent.at(-1).payload);
    assert.equal(request.request,'setChromeIntegration');assert.equal(request.enabled,false);
    assert.equal(await page.locator('#register-chrome').isDisabled(),true);
    await page.evaluate(requestId=>receive({response:'chromeIntegration',requestId,chromeIntegration:{enabled:false,ready:true,state:'disabled',extensionId:'a'.repeat(32)},chromeConnection:{state:'unavailable'}}),request.requestId);
    assert.equal(await page.locator('#chrome-enabled').isChecked(),false);
    assert.equal(await page.locator('#chrome-connection').getAttribute('data-state'),'disabled');
    await page.locator('#chrome-extension-id').fill('b'.repeat(32));
    await page.locator('#chrome-extension-id').press('Enter');
    const register=await page.evaluate(()=>sent.at(-1).payload);
    assert.equal(register.request,'registerChromeHost');assert.equal(register.extensionId,'b'.repeat(32));
    await page.evaluate(requestId=>receive({response:'chromeHostRegistration',requestId,status:'registered',message:'OK',chromeIntegration:{enabled:true,ready:true,state:'running',extensionId:'b'.repeat(32)},chromeConnection:{state:'disconnected'}}),register.requestId);
    assert.equal(await page.locator('#chrome-enabled').isChecked(),true);
    assert.equal(await page.locator('#chrome-enabled').isEnabled(),true);
    for(const width of [280,320,420]) {
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${language} ${width}: horizontal overflow`);
    }
    if(process.argv.includes('--screenshot')&&language==='ja') {
      await page.setViewportSize({width:360,height:1100});
      await page.locator('#chrome-setup').screenshot({path:fileURLToPath(new URL('.generated/chrome-settings.png',import.meta.url))});
    }
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('Settings Chromium: Japanese/English, keyboard disconnect, saved ID, re-registration and widths 280/320/420 passed.');
} finally {await browser.close();}
