import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
const host=new URL('../scripts/chrome-native-host.mjs',import.meta.url);
function frame(message) {
  const body=Buffer.from(JSON.stringify(message)),header=Buffer.alloc(4);
  header.writeUInt32LE(body.length);return Buffer.concat([header,body]);
}
test('native host handles fragmented UTF-8 frames and coalesced requests without stdout logs',async()=>{
  const child=spawn(process.execPath,[fileURLToPath(host)],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  try {
    const messages=[];let buffer=Buffer.alloc(0);
    const complete=new Promise(resolve=>child.stdout.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      while(buffer.length>=4&&buffer.length>=4+buffer.readUInt32LE(0)) {
        const size=buffer.readUInt32LE(0);assert.ok(size<=1024*1024);
        messages.push(JSON.parse(buffer.subarray(4,4+size)));buffer=buffer.subarray(4+size);
        if(messages.length===2) resolve();
      }
    }));
    // Invalid paths must be rejected locally, without reading credentials or networking.
    const first=frame({id:1,path:'/invalid',body:{title:'日本語🎵'}});
    child.stdin.write(first.subarray(0,2));
    child.stdin.write(Buffer.concat([first.subarray(2),frame({id:2,path:'/invalid',body:{}})]));
    await complete;
    assert.deepEqual(messages.map(m=>m.id),[1,2]);assert.ok(messages.every(m=>m.error));
    const exited=once(child,'exit');child.stdin.end();assert.equal((await exited)[0],0);
  } finally {child.kill();}
});
test('native host rejects oversized and truncated frames',async()=>{
  for(const bytes of [Buffer.from([255,255,255,127]),Buffer.from([5,0,0,0,123])]) {
    const child=spawn(process.execPath,[fileURLToPath(host)],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    const exited=once(child,'exit');child.stdin.end(bytes);
    assert.equal((await exited)[0],1);
  }
});
