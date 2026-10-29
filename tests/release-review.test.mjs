import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewRequirements,releaseProblems,releaseFailureMessage} from '../scripts/check-release.mjs';
import {noticeFiles} from '../scripts/build-notices.mjs';

const complete=()=>({version:'0.4.7',sourceFingerprint:'current',checks:Object.fromEntries(
  Object.keys(reviewRequirements).map(key=>[key,{reviewedOn:'2026-10-26',reviewer:'Publisher',evidence:'Acceptance report with environment and results'}]))});

test('release review rejects missing evidence, stale versions and changes after review',()=>{
  assert.deepEqual(releaseProblems(complete(),'0.4.7','current'),[]);
  assert.ok(releaseProblems(complete(),'0.4.8','current').some(message=>message.includes('version')));
  assert.ok(releaseProblems(complete(),'0.4.7','changed').some(message=>message.includes('fingerprint')));
  for(const key of Object.keys(reviewRequirements)) {
    for(const value of [null,{reviewedOn:'2026-10-26',reviewer:'Publisher',evidence:' '},
      {reviewedOn:'2026-02-31',reviewer:'Publisher',evidence:'Report'},
      {reviewedOn:'not a date',reviewer:'Publisher',evidence:'Report'}]) {
      const review=complete();review.checks[key]=value;
      assert.ok(releaseProblems(review,'0.4.7','current').includes(`Review evidence required: ${key}`));
    }
  }
});

test('each store requires its own applicable reviews',()=>{
  const review=complete();review.checks.chromeAcceptance=null;
  assert.deepEqual(releaseProblems(review,'0.4.7','current','marketplace'),[]);
  assert.ok(releaseProblems(review,'0.4.7','current','chrome').some(message=>message.includes('chromeAcceptance')));
  assert.throws(()=>releaseProblems(review,'0.4.7','current','typo'),/Unknown release target/);
});

test('release failures explain local packaging and how to complete the release review',()=>{
  for(const [target,commands] of [
    ['marketplace',['npm run pack:review']],
    ['chrome',['npm run chrome:pack']],
    ['all',['npm run pack:review','npm run chrome:pack']]
  ]) {
    const message=releaseFailureMessage(['Review evidence required: deviceAcceptance'],target);
    assert.match(message,/Review evidence required: deviceAcceptance/);
    for(const command of ['npm run pack:review','npm run chrome:pack']) assert.equal(message.includes(command),commands.includes(command));
    assert.match(message,/docs\/release-review\.json/);
    assert.match(message,/--fingerprint/);
    assert.match(message,/reviewer, review date and evidence/);
  }
});

test('license collection preserves bundled SDK and native image runtime notices',()=>{
  assert.ok(noticeFiles('node_modules/@elgato/streamdeck').includes('LICENSE'));
  assert.ok(noticeFiles('node_modules/@img/sharp-win32-x64').includes('LICENSE'));
});
