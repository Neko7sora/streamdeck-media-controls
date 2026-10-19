import sharp from "sharp";
import {createHash} from "node:crypto";

const backgrounds=new Map<string,Promise<Buffer>>();
const bytes=(image:string)=>Buffer.from(image.slice(image.indexOf(",")+1),"base64");

/** Cache album decoding separately from animated text; keys need a composite image for pixel motion. */
export async function nowPlayingImage(artwork:string|undefined,title?:string,artist?:string,status?:string,appIcon?:string):Promise<string> {
  const key=createHash("sha256").update(JSON.stringify([artwork,appIcon,!!title,!!artist,!!status])).digest("hex");
  let background=backgrounds.get(key);
  if(!background) {
    background=(async()=>{
      const image=artwork?sharp(bytes(artwork)).resize(144,144):sharp({create:{width:144,height:144,channels:4,background:"#101018"}});
      const shade=Buffer.from(`<svg width="144" height="144">${title?'<rect y="72" width="144" height="34" fill="#101018" fill-opacity="0.9"/>':""}${artist?'<rect y="106" width="144" height="38" fill="#101018" fill-opacity="0.9"/>':""}${status?'<rect x="4" y="4" width="28" height="28" rx="4" fill="#101018" fill-opacity="0.8"/>':""}</svg>`);
      return image.composite([{input:shade},...(appIcon?[{input:bytes(appIcon),left:108,top:4}]:[])]).png().toBuffer();
    })();
    backgrounds.set(key,background);
    if(backgrounds.size>8) backgrounds.delete(backgrounds.keys().next().value!);
    void background.catch(()=>{if(backgrounds.get(key)===background) backgrounds.delete(key);});
  }
  const png=await sharp(await background).composite([
    ...(title?[{input:bytes(title),left:8,top:78}]:[]),...(artist?[{input:bytes(artist),left:8,top:110}]:[]),...(status?[{input:bytes(status),left:6,top:6}]:[])
  ]).png({compressionLevel:1}).toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}
