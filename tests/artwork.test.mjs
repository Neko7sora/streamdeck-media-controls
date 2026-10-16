import {test} from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {load} from "./load.mjs";
const {artwork,applicationIcon}=await load("artwork");
test("valid artwork is contained in a square without distorting its aspect ratio",async()=>{
  const png=await sharp({create:{width:200,height:100,channels:3,background:"red"}}).png().toBuffer();
  const result=await artwork(`data:image/png;base64,${png.toString("base64")}`,144);
  const bytes=Buffer.from(result.split(",")[1],"base64");
  const meta=await sharp(bytes).metadata();assert.equal(meta.width,144);assert.equal(meta.height,144);
  const {data,info}=await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const at=(x,y)=>[...data.subarray((y*info.width+x)*3,(y*info.width+x)*3+3)];
  assert.deepEqual(at(72,0),[16,16,24]);assert.deepEqual(at(72,72),[255,0,0]);
});
test("malformed, disguised SVG, unsupported and oversized images are refused",async()=>{
  assert.equal(await artwork("data:image/png;base64,AAAA"),undefined);
  assert.equal(await artwork(`data:image/png;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64")}`),undefined);
  assert.equal(await artwork("https://example.com/cover.png"),undefined);
  assert.equal(await artwork("data:image/png;base64,"+"A".repeat(1_500_001)),undefined);
  const png=await sharp({create:{width:5000,height:5000,channels:3,background:"black"}}).png().toBuffer();
  assert.equal(await artwork(`data:image/png;base64,${png.toString("base64")}`),undefined);
});

test('favicon takes priority, with application icon fallback on missing or broken favicons',async()=>{
 const image=async color=>'data:image/png;base64,'+(await sharp({create:{width:32,height:32,channels:4,background:color}}).png().toBuffer()).toString('base64');
 const app=await image('red'),favicon=await image('blue');
 const media={source:'windows',title:'Track',app_icon_data_url:app,favicon_data_url:favicon};
 assert.equal(await applicationIcon(media),await artwork(favicon,32));
 for(const missing of [null,'data:image/png;base64,AAAA']) {
  assert.equal(await applicationIcon({...media,favicon_data_url:missing}),await artwork(app,32));
 }
 assert.equal(await applicationIcon(null),undefined);
});
