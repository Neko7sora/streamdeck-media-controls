import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

export const reviewRequirements={
  identity:['marketplace'],
  rightsAndHumanContribution:['marketplace','chrome'],
  nativeRedistribution:['marketplace'],
  deviceAcceptance:['marketplace','chrome'],
  chromeAcceptance:['chrome'],
  publicLinks:['marketplace','chrome'],
  listingPreview:['marketplace','chrome'],
  publisherSettings:['marketplace','chrome']
};
const targets=['marketplace','chrome'];

export function sourceFingerprint() {
  const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8',windowsHide:true})
    .split('\0').filter(file=>file&&file!=='docs/release-review.json').sort();
  const hash=createHash('sha256');
  for(const file of files) {
    const bytes=readFileSync(file);
    hash.update(file+'\0');
    hash.update(/\.(?:png|ico)$/.test(file)?bytes:bytes.toString('utf8').replaceAll('\r\n','\n'));
    hash.update('\0');
  }
  return hash.digest('hex');
}
const text=value=>typeof value==='string'&&value.trim().length>0;
const https=value=>{
  try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;}
  catch {return false;}
};

export function releaseProblems(review,version,fingerprint,target='all') {
  if(target!=='all'&&!targets.includes(target)) throw new Error(`Unknown release target: ${target}`);
  const problems=[];
  if(review.version!==version) problems.push('Review version must match package.json');
  if(review.sourceFingerprint!==fingerprint) problems.push('Review evidence must refer to the current source fingerprint');
  for(const [key,appliesTo] of Object.entries(reviewRequirements)) {
    if(target!=='all'&&!appliesTo.includes(target)) continue;
    const item=review.checks?.[key];
    const timestamp=Date.parse(item?.reviewedOn);
    if(!item||!text(item.reviewer)||!/^\d{4}-\d{2}-\d{2}$/.test(item.reviewedOn??'')||
      !Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,10)!==item.reviewedOn||!text(item.evidence)) problems.push(`Review evidence required: ${key}`);
  }
  return problems;
}

export function releaseFailureMessage(problems,target='all') {
  const commands=target==='chrome'?['npm run chrome:pack']:target==='marketplace'?['npm run pack:review']:['npm run pack:review','npm run chrome:pack'];
  return 'Release is not ready:\n- '+problems.join('\n- ')+
    '\n\nTo create a local package for testing, use:\n  '+commands.join('\n  ')+
    '\n\nFor release packaging, complete the applicable reviews in docs/release-review.json.'+
    '\nRecord the reviewer, review date and evidence for each required check.'+
    '\nAfter reviewing the final source, record the output of node scripts/check-release.mjs --fingerprint as sourceFingerprint.'+
    '\nSee docs/guideline-audit.md for the review requirements.';
}

export function checkRelease(target='all') {
  const read=path=>JSON.parse(readFileSync(path,'utf8'));
  const version=read('package.json').version,review=read('docs/release-review.json');
  const problems=releaseProblems(review,version,sourceFingerprint(),target);
  const marketplace=read('docs/marketplace/listing.en.json');
  const manifest=read('dev.n7s.media-controls.sdPlugin/manifest.json');
  if(review.makerOrganization!==manifest.Author) problems.push('Maker organization must match manifest.Author');
  if(target!=='chrome') {
    const pricing=marketplace.pricing;
    if(pricing?.type!=='free'&&!(pricing?.type==='paid'&&Number.isFinite(pricing.amount)&&pricing.amount>0&&/^[A-Z]{3}$/.test(pricing.currency??''))) problems.push('Marketplace pricing must be specified');
    for(const key of ['privacy','support','setup']) if(!https(marketplace.links?.[key])) problems.push(`Marketplace HTTPS link required: ${key}`);
  }
  if(target!=='marketplace') for(const language of ['en','ja']) {
    const listing=read(`docs/chrome-web-store/listing.${language}.json`);
    if(!https(listing.privacyPolicyUrl)) problems.push(`${language}: public HTTPS privacy policy URL required`);
    if(!https(listing.supportUrl)) problems.push(`${language}: support URL required`);
  }
  if(problems.length) throw new Error(releaseFailureMessage(problems,target));
  console.log(`Release review: ${target} ready for publisher submission (store approval is separate)`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if(process.argv.includes('--fingerprint')) console.log(sourceFingerprint());
    else checkRelease(process.argv[2]??'all');
  } catch(error) {
    console.error(error.message);
    process.exitCode=1;
  }
}
