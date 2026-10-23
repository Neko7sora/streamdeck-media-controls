import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from './load.mjs';
const {isSeekTouch}=await load('display-guidelines');

test('the entire bottom 35 px timeline is touchable, with a separate playback area',()=>{
  for(const x of [0,6,100,194,199]) {
    for(const y of [65,68,85,88,99]) assert.equal(isSeekTouch(x,y),true,`${x},${y}`);
    for(const y of [0,64,100]) assert.equal(isSeekTouch(x,y),false,`${x},${y}`);
  }
  assert.equal(isSeekTouch(-1,90),false);assert.equal(isSeekTouch(200,90),false);
});
