import sharp from "sharp";
import {fileURLToPath} from "node:url";
import type {MediaCommand} from "./windows-media.js";

const icons=new Map<string,Promise<Buffer>>();
const bytes=(image:string)=>Buffer.from(image.slice(image.indexOf(",")+1),"base64");

/** Keep the operation prominent, with two dedicated lines for its target. */
export async function controlImage(command:MediaCommand,target:string,detail:string,appIcon?:string,showControlIcon=true,playing=false):Promise<string> {
  const iconKey=command==="play-pause"&&playing?"pause":command;
  let icon=icons.get(iconKey);
  if(showControlIcon&&!icon) {
    // The bundled entry point lives in sdPlugin/bin; assets remain in sdPlugin/imgs.
    icon=(iconKey==="pause"
      ?sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" rx="12" fill="#131c2d"/><path d="M27 20v32m18-32v32" stroke="#59dcf5" stroke-width="9"/></svg>'))
      :sharp(fileURLToPath(new URL(`../imgs/actions/${command}@2x.png`,import.meta.url))).resize(72,72)).png().toBuffer();
    icons.set(iconKey,icon);
    void icon.catch(()=>{if(icons.get(iconKey)===icon) icons.delete(iconKey);});
  }
  const png=await sharp({create:{width:144,height:144,channels:4,background:"#101018"}}).composite([
    ...(showControlIcon&&icon?[{input:await icon,left:36,top:4}]:[]),
    ...(appIcon?[{input:bytes(appIcon),left:108,top:4}]:[]),
    {input:bytes(target),left:8,top:80},
    {input:bytes(detail),left:8,top:114}
  ]).png({compressionLevel:1}).toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}
