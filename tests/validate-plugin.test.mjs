import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertValidationResult} from '../scripts/validate-plugin.mjs';

test('CLI success cannot hide an unavailable manifest or layout schema',()=>{
  for(const stream of ['stdout','stderr']) for(const schema of ['manifest','layout']) {
    const result={status:0,stdout:'√ Validation successful\n',stderr:''};
    result[stream]+=`Failed to load remote schema from https://schemas.elgato.com/streamdeck/plugins/${schema}.json\n`;
    assert.throws(()=>assertValidationResult(result),/validation is incomplete/);
  }
  assert.doesNotThrow(()=>assertValidationResult({status:0,stdout:'\u001b[32m√ Validation successful\u001b[0m',stderr:''}));
});

test('validation requires a completed successful CLI process and explicit confirmation',()=>{
  for(const result of [{status:1,stdout:'Validation successful'},{status:null,signal:'SIGTERM'},
    {status:0,stdout:'Starting validation'},{status:0,error:new Error('spawn failed')}]) {
    assert.throws(()=>assertValidationResult(result));
  }
});
