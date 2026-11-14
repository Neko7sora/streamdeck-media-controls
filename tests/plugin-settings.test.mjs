import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from './load.mjs';

test('concurrent Chrome and iCUE saves merge into the latest global settings, and failures do not block later writes',async()=>{
  const driver={saved:{other:'keep'},reads:0,async read(){this.reads++;await new Promise(r=>setImmediate(r));return structuredClone(this.saved);},async write(value){if(this.fail) throw Error('save failed');this.saved=value;}};
  globalThis.__settingsTest=driver;
  const ports={name:'settings-ports',setup(build){
    build.onResolve({filter:/^@elgato\/streamdeck$/},()=>({path:'sdk',namespace:'test'}));
    build.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`const d=globalThis.__settingsTest;export default {settings:{getGlobalSettings:()=>d.read(),setGlobalSettings:v=>d.write(v)}};`}));
  }};
  try {
    const {updatePluginSettings}=await load('streamdeck/plugin-settings',[ports]);
    await Promise.all([updatePluginSettings({chromeBridgeEnabled:false}),updatePluginSettings({icueBridgeEnabled:false}),updatePluginSettings({chromeExtensionId:'a'.repeat(32)})]);
    assert.deepEqual(driver.saved,{other:'keep',chromeBridgeEnabled:false,icueBridgeEnabled:false,chromeExtensionId:'a'.repeat(32)});
    driver.fail=true;await assert.rejects(updatePluginSettings({chromeBridgeEnabled:true}),/save failed/);
    driver.fail=false;await updatePluginSettings({icueBridgeEnabled:true});
    assert.equal(driver.saved.chromeBridgeEnabled,false);assert.equal(driver.saved.icueBridgeEnabled,true);
  } finally {delete globalThis.__settingsTest;}
});
