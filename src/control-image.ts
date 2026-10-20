import sharp from "sharp";
import {fileURLToPath} from "node:url";
import type {MediaCommand} from "./windows-media.js";

const icons=new Map<string,Promise<Buffer>>();
const bytes=(image:string)=>Buffer.from(image.slice(image.indexOf(",")+1),"base64");

/** Keep the operation prominent, with two dedicated lines for its target. */
export async function controlImage(command:MediaCommand,target:string,detail:string,appIcon?:string,showControlIcon=true):Promise<string> {
  let icon=icons.get(command);
  if(showControlIcon&&!icon) {
    // The bundled entry point lives in sdPlugin/bin; assets remain in sdPlugin/imgs.
    icon=sharp(fileURLToPath(new URL(`../imgs/actions/${command}@2x.png`,import.meta.url))).resize(72,72).png().toBuffer();
    icons.set(command,icon);
    void icon.catch(()=>{if(icons.get(command)===icon) icons.delete(command);});
  }
  const png=await sharp({create:{width:144,height:144,channels:4,background:"#101018"}}).composite([
    ...(showControlIcon&&icon?[{input:await icon,left:36,top:4}]:[]),
    ...(appIcon?[{input:bytes(appIcon),left:108,top:4}]:[]),
    {input:bytes(target),left:8,top:80},
    {input:bytes(detail),left:8,top:114}
  ]).png({compressionLevel:1}).toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}
