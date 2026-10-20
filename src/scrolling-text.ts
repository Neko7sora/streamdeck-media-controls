import sharp from "sharp";
import {displayFont} from "./display-font.js";

export const SCROLL_HOLD_MS = 1500;
export const SCROLL_PIXELS_PER_SECOND = 30;
export const ANIMATION_INTERVAL_MS = 1000 / 30;
export type TextStyle = {width:number; height:number; fontSize:number; bold?:boolean; scale?:number; scroll?:boolean};
export type TextFrame = {image:string; offset:number; distance:number};
type Strip = {data:Buffer; width:number; height:number};
type Line = {key:string; strip:Promise<Strip>; started?:number; offset?:number; image?:string};
const escape = (s:string)=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

/** Shape the entire line once, then move a pixel viewport over those same glyphs. */
export class ScrollingText {
  private readonly instances = new Map<string,Map<string,Line>>();
  private readonly moving = new Set<Line>();
  get active():boolean {return this.moving.size>0;}

  clear(id:string):void {
    for(const line of this.instances.get(id)?.values()??[]) this.moving.delete(line);
    this.instances.delete(id);
  }

  async frame(id:string,field:string,value:string,style:TextStyle,identity="",now?:number):Promise<TextFrame> {
    const text=value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu,"").replace(/\s+/gu," ").trim();
    const key=JSON.stringify([text,{...style,scroll:style.scroll!==false},identity]);
    let lines=this.instances.get(id);
    if(!lines) {lines=new Map();this.instances.set(id,lines);}
    let line=lines.get(field);
    if(!line||line.key!==key) {
      if(line) this.moving.delete(line);
      const strip=(async():Promise<Strip>=>{
        if(!text) return {data:Buffer.alloc(4),width:1,height:1};
        const font=displayFont(style.bold);
        const {data,info}=await sharp({text:{text:'<span foreground="#ffffff">'+escape(text)+'</span>',
          font:`${font.family} ${style.bold?"Bold ":""}${style.fontSize}`,fontfile:font.fontfile,dpi:72,rgba:true}})
          .ensureAlpha().raw().toBuffer({resolveWithObject:true});
        return {data,width:info.width,height:info.height};
      })();
      line={key,strip};lines.set(field,line);
    }
    const strip=await line.strip;
    const tick=now??performance.now();
    line.started??=tick;
    const distance=Math.max(0,strip.width-style.width);
    // Ignore a raster that finished after its action disappeared or changed tracks.
    if(lines.get(field)===line&&this.instances.get(id)===lines&&distance>0&&style.scroll!==false) this.moving.add(line);
    const speed=SCROLL_PIXELS_PER_SECOND*(style.scale??1);
    const travel=distance/speed*1000;
    const phase=Math.max(0,tick-line.started)%(SCROLL_HOLD_MS*2+travel);
    const offset=style.scroll===false?0:Math.min(distance,Math.max(0,Math.round((phase-SCROLL_HOLD_MS)/1000*speed)));
    if(line.offset!==offset||line.image===undefined) {
      const height=Math.min(strip.height,style.height);
      const crop=await sharp(strip.data,{raw:{width:strip.width,height:strip.height,channels:4}})
        .extract({left:offset,top:Math.max(0,Math.floor((strip.height-style.height)/2)),width:Math.min(style.width,strip.width),height}).png().toBuffer();
      const bytes=await sharp({create:{width:style.width,height:style.height,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
        .composite([{input:crop,left:0,top:Math.floor((style.height-height)/2)}]).png({compressionLevel:1}).toBuffer();
      line.offset=offset;line.image=`data:image/png;base64,${bytes.toString("base64")}`;
    }
    return {image:line.image,offset,distance};
  }
}

