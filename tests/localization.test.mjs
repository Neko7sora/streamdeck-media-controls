import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from './load.mjs';
import {inspector} from './settings-harness.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {validateCatalogs,buildLocales} from '../scripts/build-locales.mjs';

test('adding a catalog enables regional fallback and interpolation in Node and browser runtimes',async()=>{
  const node=await load('localization'),browser={};
  vm.runInNewContext(readFileSync(new URL('../chrome-extension/localization.js',import.meta.url),'utf8'),browser);
  const catalogs={en:{greeting:'Hello {name}',fallback:'English'},fr:{greeting:'Bonjour {name}'},'fr-CA':{local:'Québec'}};
  for(const runtime of [node,browser.MediaI18n]) {
    const translator=runtime.createTranslator(catalogs,'FR_ca');
    assert.equal(translator.t('local'),'Québec');
    assert.equal(translator.t('greeting',{name:'<b>Music</b>'}),'Bonjour <b>Music</b>');
    assert.equal(translator.t('fallback'),'English');
    assert.equal(translator.t('unknown'),'unknown');
    const element={dataset:{i18n:'greeting'},textContent:''},document={documentElement:{},querySelectorAll:()=>[element]};
    translator.localizePage(document);
    assert.equal(document.documentElement.lang,'fr-CA');
    assert.equal(element.textContent,'Bonjour {name}');
    translator.setLanguage('ja');translator.localizePage(document);
    assert.equal(document.documentElement.lang,'en');
    assert.equal(element.textContent,'Hello {name}');
  }
});

test('catalog validation rejects typos and mismatched variables but permits partial translations',()=>{
  const en={message:'Received {count} sessions'};
  assert.doesNotThrow(()=>validateCatalogs({en,fr:{}}));
  assert.throws(()=>validateCatalogs({en,fr:{message:'Reçu {total}'}}),/Placeholder mismatch/);
  assert.throws(()=>validateCatalogs({en,fr:{typo:'Texte'}}),/Unknown translation key/);
  assert.throws(()=>validateCatalogs({en,fr:{message:''}}),/Invalid translation/);
  assert.throws(()=>validateCatalogs({en,'fr-ca':{}}),/canonical language tag/);
});

test('display updates reuse resolved translations and language changes rebuild them',async()=>{
  const {createTranslator}=await load('localization');
  let reads=0;
  const catalogs={en:{get label(){reads++;return 'Default';},value:'{count} / {count} {unit}'},fr:{get label(){reads++;return 'Français';}}};
  const translator=createTranslator(catalogs,'fr-CA');
  const initialReads=reads;
  for(let index=0;index<100;index++) {
    assert.equal(translator.t('label'),'Français');
    assert.equal(translator.t('value',{count:0}),'0 / 0 {unit}');
    assert.equal(translator.t('value',{count:'$&',unit:'{count}'}),'$& / $& {count}');
    translator.setLanguage('FR_fr');
  }
  assert.equal(reads,initialReads,'updates and equivalent locales must not reread the catalogs');
  assert.equal(translator.t('toString'),'toString','unknown keys must not resolve inherited properties');
  translator.setLanguage('en');
  assert.equal(translator.t('label'),'Default');
  assert.ok(reads>initialReads);
  translator.setLanguage('fr');
  assert.equal(translator.t('label'),'Français');
});

test('checked-in localization bundles match their source catalogs',async()=>{await buildLocales({check:true});});

test('display language supports Japanese variants and falls back to English',async()=>{
  const {setLanguage,t}=await load('localization');
  for(const language of ['ja','ja-JP','JA-jp']) {setLanguage(language);assert.equal(t('no.target'),'対象なし');}
  for(const language of ['en','en-US','de','']) {setLanguage(language);assert.equal(t('no.target'),'No target');}
});

test('inspector uses Stream Deck language for dynamic states and controls',()=>{
  for(const language of ['en','en-GB','fr']) {
    const pi=inspector({},{language});
    assert.equal(pi.elements.get('media').children[0].textContent,'Automatic (prefer playing)');
    assert.equal(pi.elements.get('seek-step').children[1].textContent,'5 s');
    pi.receive('sendToPropertyInspector',{chromeConnection:{state:'connected',sessions:2}});
    assert.equal(pi.elements.get('chrome-connection-detail').textContent,'Receiving media (2 sessions)');
    pi.close();assert.equal(pi.elements.get('status').textContent,'Disconnected from the plugin');
  }
});
