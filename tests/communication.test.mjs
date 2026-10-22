import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {load} from './load.mjs';
const {ChromeWire}=await load('chrome-wire');
const {NativeWire}=await load('native-wire');
const {InspectorUpdates}=await load('inspector-updates');
const image='data:image/png;base64,AQ==',hash=createHash('sha256').update(image).digest('hex');
const packet={protocol:2,tab_id:1,frame_id:0,document_id:'doc',sequence:1,base:null,media:{title:'Track',artist:'Artist',artwork_data_url:{image:hash}},images:{[hash]:image}};

test('Chrome deltas preserve identity and images, reject forged hashes, and request lost bases and images',()=>{
  const wire=new ChromeWire();
  const initial=wire.decode(packet);assert.equal(initial.media.artwork_data_url,image);
  const delta={...packet,sequence:2,base:1,media:{playback_state:'paused'},images:{}};
  assert.deepEqual(wire.decode(delta).media,{title:'Track',artist:'Artist',artwork_data_url:image,playback_state:'paused'});
  assert.deepEqual(wire.decode({...delta,base:0}),{resync:true});
  wire.clear();assert.deepEqual(wire.decode(delta),{resync:true});
  assert.deepEqual(wire.decode({...packet,images:{}}),{missing:[hash]});
  assert.throws(()=>wire.decode({...packet,images:{[hash]:image+'AA'}}),/hash/);
  assert.equal(wire.decode(packet).media.artwork_data_url,image);
  assert.deepEqual(wire.decode({...packet,document_id:'next-doc',sequence:3,media:{title:'Next'},images:{}}).media,{title:'Next'});
  assert.equal(wire.decode({...packet,media:null}).media,null);
});

test('Windows wire shares current/session images, applies partial updates, heartbeats, and resets',()=>{
  const wire=new NativeWire();
  const first=wire.decode({reset:true,changes:{current:'a',sessions:[{session_id:'a',title:'Track',artwork_data_url:{image:'1'}}],audio:null},images:{1:image}});
  assert.equal(first.current.artwork_data_url,image);assert.equal(first.sessions[0].artwork_data_url,image);
  assert.equal(wire.decode({changes:{},images:{}}),undefined);
  const updated=wire.decode({changes:{audio:{master:{volume:0.5}}},images:{}});
  assert.equal(updated.current.title,'Track');assert.equal(updated.audio.master.volume,0.5);
  assert.equal(wire.decode({reset:true,changes:{current:null,sessions:[],audio:null},images:{}}).current,null);
  assert.throws(()=>wire.decode({changes:{sessions:[{artwork_data_url:{image:'1'}}]},images:{}}),/Missing/);
});

test('Chrome delta bases remain independent across profiles and navigation',()=>{
  const wire=new ChromeWire(),a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  wire.decode({...packet,client_id:a});
  wire.decode({...packet,client_id:b,media:{title:'Profile B'},images:{}});
  wire.decode({...packet,client_id:b,document_id:'next-doc',media:{title:'Navigated B'},images:{}});
  const delta={...packet,client_id:a,base:1,sequence:2,media:{playback_state:'paused'},images:{}};
  assert.deepEqual(wire.decode(delta).media,{title:'Track',artist:'Artist',artwork_data_url:image,playback_state:'paused'});
  wire.remove(1,b);
  assert.equal(wire.decode({...delta,base:2,sequence:3}).media.title,'Track');
  assert.deepEqual(wire.decode({...delta,client_id:b,document_id:'next-doc'}),{resync:true});
  assert.throws(()=>wire.decode({...packet,client_id:'invalid'}),/client ID/);
});

test('Chrome image eviction requests only missing content and navigation invalidates old delta bases',()=>{
  const wire=new ChromeWire();wire.decode(packet);
  for(let index=0;index<128;index++) {
    const data=`data:image/png;base64,${Buffer.from(String(index)).toString('base64')}`,id=createHash('sha256').update(data).digest('hex');
    wire.decode({...packet,tab_id:2,sequence:index+1,media:{title:'Other'},images:{[id]:data}});
  }
  const delta={...packet,sequence:2,base:1,media:{playback_state:'paused'},images:{}};
  assert.deepEqual(wire.decode(delta),{missing:[hash]});
  assert.equal(wire.decode({...delta,images:{[hash]:image}}).media.title,'Track');
  wire.decode({...packet,sequence:3,document_id:'replacement',media:{title:'Next'},images:{}});
  assert.deepEqual(wire.decode({...delta,sequence:4,base:2}),{resync:true});
});

test('inspector sends only changed collections, ignoring observation clocks but retaining metadata changes',()=>{
  const updates=new InspectorUpdates();
  const state={sessions:[{id:'a',details:JSON.stringify({title:'Track',observed_at:1})}],audio:[],chromeConnection:{state:'connected',lastSeen:1,sessions:1}};
  assert.deepEqual(Object.keys(updates.changes(state)),['sessions','audio','chromeConnection']);
  assert.deepEqual(updates.changes({...state,sessions:[{id:'a',details:JSON.stringify({title:'Track',observed_at:500})}],chromeConnection:{...state.chromeConnection,lastSeen:500}}),{});
  const changed=updates.changes({...state,sessions:[{id:'a',details:JSON.stringify({title:'Next',observed_at:501})}]});
  assert.deepEqual(Object.keys(changed),['sessions']);
  updates.reset();assert.equal(Object.keys(updates.changes(state)).length,3);
});
