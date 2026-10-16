import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {load} from './load.mjs';
const {ScrollingText,SCROLL_HOLD_MS:HOLD,SCROLL_PIXELS_PER_SECOND:SPEED,ANIMATION_INTERVAL_MS:INTERVAL}=await load('scrolling-text');
const {nowPlayingImage}=await load('now-playing-image');
const style={width:60,height:22,fontSize:14};
const text='春夏秋冬東西南北朝昼夕夜';
const pixels=image=>sharp(Buffer.from(image.split(',')[1],'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});

test('short and empty text stay still without enabling the animation clock',async()=>{
 const scrolling=new ScrollingText(),wide={...style,width:188};
 const a=await scrolling.frame('key','title',' Hello\nworld ',wide,'A',0);
 const b=await scrolling.frame('key','title',' Hello\nworld ',wide,'A',50000);
 assert.equal(a.distance,0);assert.equal(a.image,b.image);assert.equal(scrolling.active,false);
 const empty=await pixels((await scrolling.frame('key','artist','',style,'A',0)).image);
 assert.equal(empty.info.width,style.width);assert.equal(empty.info.height,style.height);
 assert.ok(empty.data.every(value=>value===0));
});

test('long text holds both ends and reaches the entire suffix before looping',async()=>{
 const scrolling=new ScrollingText();
 const frame=now=>scrolling.frame('dial','title',text,style,'A',now);
 const first=await frame(0);
 assert.ok(first.distance>30);assert.equal(first.offset,0);assert.equal(scrolling.active,true);
 assert.equal((await frame(HOLD-1)).image,first.image);
 const end=HOLD+first.distance/SPEED*1000;
 const last=await frame(end+1);
 assert.equal(last.offset,first.distance);
 assert.equal((await frame(end+HOLD-1)).image,last.image);
 assert.equal((await frame(end+HOLD+1)).image,first.image);
});

test('successive 30fps frames advance one pixel, keeping the same shaped glyphs',async()=>{
 const scrolling=new ScrollingText();
 const frame=now=>scrolling.frame('dial','title',text,style,'A',now);
 const first=await frame(0),next=await frame(HOLD+INTERVAL);
 assert.equal(next.offset,1);assert.notEqual(first.image,next.image);
 const a=await pixels(first.image),b=await pixels(next.image);
 for(let y=0;y<style.height;y++) {
  const row=y*style.width*4;
  assert.deepEqual(b.data.subarray(row,row+(style.width-1)*4),a.data.subarray(row+4,row+style.width*4));
 }
 for(let i=2;i<=20;i++) assert.equal((await frame(HOLD+i*INTERVAL)).offset,i);
});

test('fields and actions have independent clocks; changes and disappearance reset and release animation',async()=>{
 const scrolling=new ScrollingText();
 const frame=(id,field,identity,now)=>scrolling.frame(id,field,text,style,identity,now);
 await frame('one','title','A',0);await frame('one','artist','A',500);await frame('two','title','A',1000);
 assert.equal((await frame('one','title','A',HOLD+500)).offset,15);
 assert.equal((await frame('one','artist','A',HOLD+500)).offset,0);
 assert.equal((await frame('two','title','A',HOLD+500)).offset,0);
 assert.equal((await frame('one','title','B',HOLD+1000)).offset,0);
 scrolling.clear('one');scrolling.clear('two');assert.equal(scrolling.active,false);
 const pending=frame('gone','title','A',0);scrolling.clear('gone');await pending;
 assert.equal(scrolling.active,false);
});

test('markup, Japanese, combining characters and emoji render as a bounded PNG',async()=>{
 const scrolling=new ScrollingText();
 const frame=await scrolling.frame('dial','title','<b>A&B</b> か\u3099 👨‍👩‍👧‍👦 🇯🇵 🎵 終点',style,'A',0);
 const image=await pixels(frame.image);
 assert.equal(image.info.width,style.width);assert.equal(image.info.height,style.height);
 assert.ok(image.data.some(value=>value>0));
 scrolling.clear('dial');assert.equal(scrolling.active,false);
});

test('key text scrolls over stable album artwork and remains inside its image',async()=>{
 const scrolling=new ScrollingText(),keyStyle={width:128,height:30,fontSize:24,scale:2};
 const title=await scrolling.frame('key','title',text,keyStyle,'A',0);
 const artist=await scrolling.frame('key','artist','Artist',{width:128,height:28,fontSize:22},'A',0);
 const status=await scrolling.frame('key','status','▶',{width:24,height:24,fontSize:18},'A',0);
 const artwork='data:image/png;base64,'+(await sharp({create:{width:144,height:144,channels:4,background:'#7f40b0'}}).png().toBuffer()).toString('base64');
 const first=await pixels(await nowPlayingImage(artwork,title.image,artist.image,status.image));
 const nextTitle=await scrolling.frame('key','title',text,keyStyle,'A',HOLD+INTERVAL);
 const next=await pixels(await nowPlayingImage(artwork,nextTitle.image,artist.image,status.image));
 assert.equal(first.info.width,144);assert.equal(first.info.height,144);
 assert.deepEqual(first.data.subarray(0,144*72*4),next.data.subarray(0,144*72*4));
 assert.notDeepEqual(first.data,next.data);
});

test('adding emoji does not resize the surrounding text',async()=>{
 const scrolling=new ScrollingText(),fontStyle={width:200,height:22,fontSize:14};
 const plain=await scrolling.frame('font','plain','ABCD',fontStyle,'A',0);
 const mixed=await scrolling.frame('font','mixed','ABCD 🧑‍🎤',fontStyle,'A',0);
 const prefix=async image=>{
  const cropped=await sharp(Buffer.from(image.split(',')[1],'base64')).extract({left:0,top:0,width:28,height:22}).png().toBuffer();
  return sharp(cropped).trim().ensureAlpha().raw().toBuffer({resolveWithObject:true});
 };
 const a=await prefix(plain.image),b=await prefix(mixed.image);
 assert.equal(a.info.width,b.info.width);assert.equal(a.info.height,b.info.height);
 assert.deepEqual(a.data,b.data);
});

