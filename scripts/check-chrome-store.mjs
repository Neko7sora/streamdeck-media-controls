import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {checkChromeSecurity,readChromePackage} from './check-chrome-security.mjs';

const root=resolve('chrome-extension');
const read=path=>readFile(path,'utf8');
const manifest=JSON.parse(await read(join(root,'manifest.json')));
const {files}=await readChromePackage(root);
checkChromeSecurity(manifest,files);
assert.equal(manifest.manifest_version,3);
assert.equal(manifest.version,JSON.parse(await read('package.json')).version);
assert.deepEqual([...manifest.permissions].sort(),['nativeMessaging','storage']);
assert.deepEqual(manifest.host_permissions,['https://*/*']);
assert.equal(manifest.default_locale,'en');
assert.equal(manifest.incognito??'spanning','spanning');
for(const field of ['web_accessible_resources','externally_connectable','update_url']) assert.equal(manifest[field],undefined,`${field} needs a fresh publication review`);
const csp=manifest.content_security_policy.extension_pages;
for(const directive of ["script-src 'self'","object-src 'none'","base-uri 'none'","form-action 'none'","connect-src https:"]) assert.ok(csp.split(';').map(x=>x.trim()).includes(directive));
assert.equal(/unsafe-inline|unsafe-eval|http:|\*/.test(csp),false);
for(const size of [16,32,48,128]) {
  const icon=join(root,manifest.icons[size]),meta=await sharp(icon).metadata();
  assert.equal(meta.format,'png');assert.equal(meta.width,size);assert.equal(meta.height,size);assert.equal(meta.hasAlpha,true);
}
// Catch accidental inclusion of archives, credentials, dependencies or native
// executables in the extension ZIP. A changed package layout requires review.
const allowed=/^(?:manifest\.json|(?:background|bridge-isolated|page-main|options|localization|privacy)\.js|(?:options|privacy)\.html|options\.css|icons\/icon-(?:16|32|48|128)\.png|_locales\/[a-zA-Z_]+\/messages\.json)$/;
for(const path of await readdir(root,{recursive:true,withFileTypes:true})) {
  if(!path.isFile()) continue;
  const relative=join(path.parentPath,path.name).slice(root.length+1).replaceAll('\\','/');
  assert.ok(allowed.test(relative),`Unexpected extension package file: ${relative}`);
}
for(const file of ['options.html','privacy.html']) {
  const html=await read(join(root,file));
  assert.equal(/<script\b(?![^>]*\bsrc=)|<script[^>]+src=["']https?:|\son\w+=/i.test(html),false,`${file}: packaged external JS only`);
}
for(const file of ['page-main.js','bridge-isolated.js']) {
  const source=await read(join(root,file));
  assert.equal(/\bunload\b|\b(?:WebSocket|RTCPeerConnection)\s*\(/.test(source),false,`${file}: avoid known bfcache blockers`);
}
const pending=new Set();
const publicPolicy=await read('docs/marketplace/privacy.md');
assert.match(publicPolicy,/adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements/,'Public policy must affirm Limited Use compliance');
assert.match(await read('README.md'),/\]\(docs\/marketplace\/privacy\.md\)/,'Privacy policy must be one click from the project homepage');
const privacyPage=await read(join(root,'privacy.html'));
assert.ok(privacyPage.includes('data-i18n="extension.policy.limitedUse"'),'Packaged privacy page must expose the Limited Use statement');
let publicationMetadata;
const records=JSON.parse(await read('assets/chrome-web-store/screenshots.json'));
for(const path of ['chrome-extension/manifest.json','chrome-extension/options.html','chrome-extension/options.css','chrome-extension/options.js','chrome-extension/localization.js','tests/chrome-e2e.mjs']) {
  const hash=createHash('sha256').update((await read(path)).replaceAll('\r\n','\n')).digest('hex');
  assert.equal(records.sources?.[path],hash,`Stale screenshot source: ${path}. Run npm run test:chrome:e2e -- --screenshots and review images.`);
}
for(const language of ['en','ja']) {
  const listing=JSON.parse(await read(`docs/chrome-web-store/listing.${language}.json`));
  const messages=JSON.parse(await read(join(root,`_locales/${language}/messages.json`)));
  const catalog=JSON.parse(await read(`locales/${language}.json`));
  assert.match(catalog['extension.policy.limitedUse'],/Chrome Web Store User Data Policy/);
  assert.match(catalog['extension.policy.limitedUse'],/Limited Use/);
  const metadata={privacyPolicyUrl:listing.privacyPolicyUrl,privateContact:listing.privateContact};
  if(publicationMetadata) assert.deepEqual(metadata,publicationMetadata,'Localized listings must use the same policy URL and private contact');
  publicationMetadata=metadata;
  assert.equal(listing.name,messages.extensionName.message);
  assert.equal(listing.summary,messages.extensionDescription.message);
  assert.ok(listing.name.length<=75&&listing.summary.length<=132&&listing.description.length<=16000);
  assert.equal(listing.category,'Tools');
  for(const field of ['supportUrl','homepageUrl']) assert.equal(new URL(listing[field]).protocol,'https:');
  if(!listing.privacyPolicyUrl) pending.add('Public HTTPS privacy policy URL');
  else assert.equal(new URL(listing.privacyPolicyUrl).protocol,'https:');
  if(typeof listing.privateContact!=='string'||!listing.privateContact.trim()) pending.add('Private support/privacy contact');
  assert.ok(listing.screenshots.length>=1&&listing.screenshots.length<=5);
  for(const path of listing.screenshots) {
    const meta=await sharp(path).metadata();
    assert.equal(meta.format,'png');assert.equal(meta.width,1280);assert.equal(meta.height,800);
    assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),records.images[path.split('/').at(-1)]);
  }
}
console.log('Chrome Web Store: local manifest, permissions, CSP, locales, package files, icons, privacy disclosures and listing assets OK.');
if(pending.size) console.log('Publication pending: '+[...pending].join('; ')+'. See docs/chrome-web-store.md for manual acceptance checks.');
if(process.argv.includes('--release')) assert.equal(pending.size,0,'Finish publication metadata before release; device tests and dashboard review are also required.');
