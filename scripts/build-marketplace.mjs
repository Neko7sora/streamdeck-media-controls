import {build} from "esbuild";
import sharp from "sharp";
import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

// Render original vector artwork and the real key renderer. No device mockups,
// third-party album covers, captured user metadata or generative image assets.
export const root=fileURLToPath(new URL("../",import.meta.url));
export const mediaSources=[
  "assets/plugin-icon.svg", "dev.n7s.media-controls.sdPlugin/manifest.json",
  "docs/marketplace/listing.en.json", "scripts/build-marketplace.mjs",
  "src/now-playing-image.ts", "src/scrolling-text.ts", "src/display-font.ts",
  "src/display-guidelines.ts", "src/plugin.ts",
  ...["play-pause","previous","next","stop","mute","volume-down","volume-up"].map(name=>`dev.n7s.media-controls.sdPlugin/imgs/actions/${name}@2x.png`)
];
export const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
// Git's Windows checkout can convert text to CRLF; that does not change a source.
export const sourceHashes=()=>Object.fromEntries(mediaSources.map(path=>{
  const bytes=readFileSync(resolve(root,path));
  return [path,digest(path.endsWith(".png")?bytes:bytes.toString("utf8").replaceAll("\r\n","\n"))];
}));
const read=path=>readFileSync(resolve(root,path));
const escape=value=>String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const text=(x,y,value,size=32,color="#f1f5fb",weight=400)=>`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" font-family="Segoe UI, sans-serif">${escape(value)}</text>`;
const rect=(x,y,width,height,fill="#172436",radius=24)=>`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"/>`;
const svg=(width,height,body)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`);

export async function buildMarketplace() {
  const listing=JSON.parse(read("docs/marketplace/listing.en.json"));
  const out=resolve(root,"assets/marketplace");mkdirSync(out,{recursive:true});
  // An in-memory bundle resolves the renderer's .js TypeScript imports without
  // starting Stream Deck, the native helper or the browser bridge.
  const bundled=await build({stdin:{contents:'export {nowPlayingImage} from "./src/now-playing-image.ts"; export {ScrollingText} from "./src/scrolling-text.ts";',resolveDir:root},bundle:true,platform:"node",format:"cjs",packages:"external",write:false,logLevel:"silent"});
  const {createRequire}=await import("node:module");
  const module={exports:{}};
  new Function("module","exports","require",bundled.outputFiles[0].text)(module,module.exports,createRequire(new URL("../package.json",import.meta.url)));
  const {nowPlayingImage,ScrollingText}=module.exports;
  const scrolling=new ScrollingText();
  const line=async(field,value,width,height,fontSize,scale=2,align="left")=>(await scrolling.frame("sample",field,value,{width,height,fontSize,scale,scroll:false,align},"sample",0)).image;
  const title=await line("title","Daylight",128,30,24);
  const artist=await line("artist","Sample",128,28,22);
  const playing=await line("playing","▶",24,24,18,1,"center");
  const paused=await line("paused","Ⅱ",24,24,18,1,"center");
  const cover=await sharp(svg(144,144,`<rect width="144" height="144" fill="#145d70"/><circle cx="106" cy="37" r="27" fill="#f3c987"/><path d="M0 95 53 42 144 133V144H0Z" fill="#72b9b0"/><path d="M0 131 67 73 144 110V144H0Z" fill="#253d64"/>`)).png().toBuffer();
  const data=bytes=>`data:image/png;base64,${bytes.toString("base64")}`;
  const decode=url=>Buffer.from(url.split(",")[1],"base64");
  const previews={
    playing:decode(await nowPlayingImage(data(cover),title,artist,playing)),
    paused:decode(await nowPlayingImage(data(cover),title,artist,paused)),
    artwork:decode(await nowPlayingImage(data(cover))),
    text:decode(await nowPlayingImage(undefined,title,artist,playing))
  };
  const outputHashes={};
  async function write(path,buffer) {
    writeFileSync(resolve(root,path),buffer);outputHashes[path]=digest(buffer);
  }
  await write(listing.appIcon,await sharp(read("assets/plugin-icon.svg")).resize(288,288).png().toBuffer());
  const chip=(x,y,label)=>rect(x,y,230,52,"#193446",26)+text(x+22,y+35,label,24,"#a2ebef",600);
  const frame=(number,title,subtitle,body="")=>svg(1920,960,
    rect(0,0,1920,960,"#0b1422",0)+`<circle cx="1810" cy="50" r="470" fill="#102537"/>`+
    text(88,84,listing.name,26,"#72d9e4",600)+text(1832,84,number,26,"#8199b3")+
    text(88,184,title,64,"#f1f5fb",600)+text(90,245,subtitle,29,"#b3c4d8")+body+
    text(88,906,"Windows x64  /  Stream Deck 7.1+",24,"#8fa6c0")+
    text(1030,906,"Code-rendered previews. Fictional sample media.",24,"#8fa6c0"));
  const scaled=async(input,size)=>sharp(input).resize(size,size,{kernel:"lanczos3"}).png().toBuffer();
  const key=(name)=>read(`dev.n7s.media-controls.sdPlugin/imgs/actions/${name}@2x.png`);

  const hero=svg(1920,960,rect(0,0,1920,960,"#0b1422",0)+
    `<circle cx="1490" cy="470" r="500" fill="#102b3d"/>`+
    text(100,122,"FOR STREAM DECK",27,"#72d9e4",600)+
    text(96,284,listing.name,92,"#f1f5fb",600)+
    text(100,374,"Your media, within reach.",42,"#c8d6e6")+
    text(100,472,"Artwork. Playback. Volume.",32,"#9eb8d2")+
    chip(100,548,"Windows x64")+chip(346,548,"Keys and dials")+
    rect(1136,160,560,560,"#1b3649",40)+
    text(100,818,"Optional Chrome integration",28,"#c8d6e6")+
    text(100,865,"Stream Deck 7.1+  ·  Dials require Stream Deck +",24,"#8fa6c0")+
    text(1136,870,"Rendered preview · Sample media",24,"#8fa6c0"));
  await write(listing.thumbnail,await sharp(hero).composite([
    {input:await scaled(previews.playing,504),left:1164,top:188},
    ...await Promise.all(["previous","play-pause","next","volume-up"].map(async(name,i)=>({input:await scaled(key(name),96),left:1156+i*140,top:742})))
  ]).png().toBuffer());

  await write(listing.gallery[0],await sharp(frame("01","See what is playing","Artwork, title, artist and playback state on a key.",
    rect(280,312,520,520)+rect(1120,312,520,520)+text(470,806,"Playing",28,"#b3c4d8")+text(1310,806,"Paused",28,"#b3c4d8")))
    .composite([{input:await scaled(previews.playing,432),left:324,top:340},{input:await scaled(previews.paused,432),left:1164,top:340}]).png().toBuffer());

  const controls=[["previous","Previous Track"],["play-pause","Play / Pause"],["next","Next Track"],["stop","Stop"],["volume-down","Volume Down"],["mute","Toggle Mute"],["volume-up","Volume Up"]];
  let cards="";const overlays=[];
  for(let i=0;i<controls.length;i++) {
    const [name,label]=controls[i],x=i<4?230+i*380:420+(i-4)*380,y=i<4?304:580;
    cards+=rect(x-32,y-16,300,252)+text(x-4,y+215,label,27,"#c8d6e6");
    overlays.push({input:await scaled(key(name),160),left:x+38,top:y});
  }
  await write(listing.gallery[1],await sharp(frame("02","Playback and volume","Choose playback and audio targets separately. Shown: bundled action icons.",cards)).composite(overlays).png().toBuffer());

  let variants="";const variantOverlays=[];
  for(const [i,[name,label]] of [["playing","Full details"],["artwork","Artwork only"],["text","Text only"]].entries()) {
    const x=160+i*570;
    variants+=rect(x-24,318,468,498)+text(x+56,785,label,30,"#c8d6e6");
    variantOverlays.push({input:await scaled(previews[name],396),left:x+12,top:344});
  }
  await write(listing.gallery[2],await sharp(frame("03","Make each key your own","Show or hide information per action. Configure text scrolling in settings.",variants)).composite(variantOverlays).png().toBuffer());
  writeFileSync(resolve(root,"docs/marketplace/description.en.txt"),listing.description+"\n");
  writeFileSync(resolve(out,"provenance.json"),JSON.stringify({sources:sourceHashes(),outputs:outputHashes,sample:{title:"Daylight",artist:"Sample",artwork:"Original geometric SVG in scripts/build-marketplace.mjs"},method:"Plugin nowPlayingImage + ScrollingText; original bundled control icons. Enlarged key previews, no physical device representation.",aiDisclosure:listing.aiDisclosure},null,2)+"\n");
  console.log(`Marketplace media: 288 × 288 icon, thumbnail and ${listing.gallery.length} gallery images (1920 × 960)`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) await buildMarketplace();
