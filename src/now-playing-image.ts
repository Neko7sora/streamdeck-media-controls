import sharp from "sharp";
import {createHash} from "node:crypto";

const backgrounds=new Map<string,Promise<Buffer>>();
const shade=Buffer.from('<svg width="144" height="144"><rect y="72" width="144" height="72" fill="#101018" fill-opacity="0.9"/><rect x="4" y="4" width="28" height="28" rx="4" fill="#101018" fill-opacity="0.8"/></svg>');
const bytes=(image:string)=>Buffer.from(image.slice(image.indexOf(",")+1),"base64");

/** Cache album decoding separately from animated text; keys need a composite image for pixel motion. */
export async function nowPlayingImage(artwork:string|undefined,title:string,artist:string,status:string):Promise<string> {
  const key=artwork?createHash("sha256").update(artwork).digest("hex"):"default";
  let background=backgrounds.get(key);
  if(!background) {
    background=(async()=>{
      const image=artwork?sharp(bytes(artwork)).resize(144,144):sharp({create:{width:144,height:144,channels:4,background:"#101018"}});
      return image.composite([{input:shade}]).png().toBuffer();
    })();
    backgrounds.set(key,background);
    if(backgrounds.size>8) backgrounds.delete(backgrounds.keys().next().value!);
    void background.catch(()=>{if(backgrounds.get(key)===background) backgrounds.delete(key);});
  }
  const png=await sharp(await background).composite([
    {input:bytes(title),left:8,top:78},{input:bytes(artist),left:8,top:110},{input:bytes(status),left:6,top:6}
  ]).png({compressionLevel:1}).toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}
