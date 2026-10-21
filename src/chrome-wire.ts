import {createHash} from "node:crypto";
import {safeImage} from "./media-model.js";

// Transport state is separate from validated media and is bounded independently.
export class ChromeWire {
  private images=new Map<string,string>();
  private bytes=0;
  private frames=new Map<string,{sequence:number;media:Record<string,unknown>}>();
  clear():void {this.images.clear();this.frames.clear();this.bytes=0;}
  remove(tab:number):void {for(const key of this.frames.keys()) if(key.startsWith(`${tab}:`)) this.frames.delete(key);}
  decode(v:Record<string,unknown>):{media?:unknown;resync?:boolean;missing?:string[]} {
    const key=`${v.tab_id}:${v.frame_id}:${v.document_id}`;
    if(v.media===null) {this.frames.delete(key);return {media:null};}
    if(!v.media||typeof v.media!=="object"||Array.isArray(v.media)) throw Error("Invalid delta");
    if(JSON.stringify(v.media).length>64000) throw Error("Oversized delta");
    if(v.images) {
      if(typeof v.images!=="object"||Array.isArray(v.images)||Object.keys(v.images).length>3) throw Error("Invalid images");
      for(const [id,data] of Object.entries(v.images)) {
        if(!safeImage(data)||createHash("sha256").update(data as string).digest("hex")!==id) throw Error("Invalid image hash");
        if(!this.images.has(id)) {this.images.set(id,data as string);this.bytes+=(data as string).length;}
      }
      while(this.bytes>16_000_000||this.images.size>128) {
        const id=this.images.keys().next().value!;this.bytes-=this.images.get(id)!.length;this.images.delete(id);
      }
    }
    const previous=this.frames.get(key);
    if(v.base!==null&&(!previous||previous.sequence!==v.base)) return {resync:true};
    const raw={...(v.base===null?{}:previous!.media),...v.media};
    if(JSON.stringify(raw).length>64000) throw Error("Oversized state");
    const media={...raw},missing:string[]=[];
    for(const field of ["artwork_data_url","favicon_data_url"]) {
      const ref=raw[field];
      if(ref&&typeof ref==="object") {
        const id=(ref as {image?:unknown}).image;
        if(typeof id!=="string"||!/^[a-f0-9]{64}$/.test(id)) throw Error("Invalid image reference");
        const data=this.images.get(id);
        if(!data) missing.push(id);
        else {media[field]=data;this.images.delete(id);this.images.set(id,data);}
      }
    }
    if(missing.length) return {missing};
    // Navigation replaces the old document's base, rather than accumulating documents.
    const prefix=`${v.tab_id}:${v.frame_id}:`;
    for(const old of this.frames.keys()) if(old.startsWith(prefix)&&old!==key) this.frames.delete(old);
    this.frames.delete(key);this.frames.set(key,{sequence:Number(v.sequence),media:raw});
    if(this.frames.size>256) this.frames.delete(this.frames.keys().next().value!);
    return {media};
  }
}
