import {readFileSync} from "node:fs";
import {basename,join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import sharp from "sharp";
import {SEEK_TOUCH_RECT} from "../src/display-guidelines.ts";

// Asset rules from https://docs.elgato.com/guidelines/stream-deck/plugins/
export async function checkGuidelines(plugin=resolve("dev.n7s.media-controls.sdPlugin")) {
  const manifest=JSON.parse(readFileSync(join(plugin,"manifest.json"),"utf8"));
  const require=(condition,message)=>{if(!condition) throw Error(message);};
  require(basename(plugin)===`${manifest.UUID}.sdPlugin`,"Plugin folder must match its UUID");
  require(manifest.UUID.split(".").length>=3,"Plugin UUID must identify its author and product");
  for(const field of ["Name","Category","Author"]) require(typeof manifest[field]==="string"&&manifest[field].trim(),`Missing ${field}`);
  const images=new Set();
  async function imagePair(base,size,monochrome=false) {
    for(const [suffix,scale] of [[".png",1],["@2x.png",2]]) {
      const file=join(plugin,base+suffix);
      if(images.has(file)) continue;
      images.add(file);
      const metadata=await sharp(file).metadata();
      require(metadata.format==="png"&&metadata.width===size*scale&&metadata.height===size*scale,`${base+suffix}: expected ${size*scale} × ${size*scale} PNG`);
      if(monochrome) {
        const {data}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
        let visible=false,transparent=false;
        for(let i=0;i<data.length;i+=4) {
          if(data[i+3]===0) transparent=true;
          else {
            visible=true;
            require(data[i]===255&&data[i+1]===255&&data[i+2]===255,`${base+suffix}: action-list icons must be white`);
          }
        }
        require(visible&&transparent,`${base+suffix}: expected white artwork on a transparent background`);
      }
    }
  }
  await imagePair(manifest.Icon,256);
  await imagePair(manifest.CategoryIcon,28,true);
  const uuids=new Set();
  for(const action of manifest.Actions) {
    require(!uuids.has(action.UUID)&&action.UUID.startsWith(manifest.UUID+"."),`Invalid action UUID: ${action.UUID}`);
    uuids.add(action.UUID);
    require(action.Name?.trim()&&action.Tooltip?.trim(),`Missing action name or tooltip: ${action.UUID}`);
    await imagePair(action.Icon,20,true);
    for(const state of action.States??[]) await imagePair(state.Image,72);
    const layout=action.Encoder?.layout;
    if(layout&&!layout.startsWith("$")) {
      const {items}=JSON.parse(readFileSync(join(plugin,layout),"utf8"));
      const keys=new Set();
      for(const item of items) {
        require(!keys.has(item.key),`${layout}: duplicate layout key ${item.key}`);keys.add(item.key);
        const [x,y,width,height]=item.rect;
        require(item.rect.length===4&&item.rect.every(Number.isFinite)&&x>=0&&y>=0&&width>0&&height>0&&x+width<=200&&y+height<=100,`${layout}: ${item.key} exceeds the 200 × 100 canvas`);
      }
    }
  }
  const [x,y,width,height]=SEEK_TOUCH_RECT;
  require(x>=0&&y>=0&&width>=35&&height>=35&&x+width<=200&&y+height<=100,"Seek touch target must be at least 35 × 35 and within the layout");
  console.log(`Plugin guidelines: OK (${images.size} PNG assets, ${uuids.size} actions; publication checks remain manual)`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) await checkGuidelines();
