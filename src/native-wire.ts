import {safeImage} from "./media-model.js";

export class NativeWire {
  private images=new Map<string,string>();
  private snapshot:Record<string,unknown>={};
  decode(packet:Record<string,unknown>):unknown|undefined {
    if(packet.reset===true) {this.images.clear();this.snapshot={};}
    const images=packet.images;
    if(!images||typeof images!=="object"||Array.isArray(images)) throw Error("Invalid native images");
    for(const [id,data] of Object.entries(images)) {
      if(!/^\d{1,20}$/.test(id)||!safeImage(data)) throw Error("Invalid native image");
      this.images.set(id,data as string);
    }
    if(this.images.size>512||[...this.images.values()].reduce((n,s)=>n+s.length,0)>32_000_000) throw Error("Native image cache exceeded limit");
    const changes=packet.changes;
    if(!changes||typeof changes!=="object"||Array.isArray(changes)) throw Error("Invalid native changes");
    if(!Object.keys(changes).length) return undefined;
    this.snapshot={...this.snapshot,...changes};
    if(!Array.isArray(this.snapshot.sessions)||this.snapshot.sessions.length>128) throw Error("Invalid native sessions");
    const sessions=this.snapshot.sessions.map(value=>{
      const item={...value};
      for(const field of ["artwork_data_url","app_icon_data_url"]) if(item[field]&&typeof item[field]==="object") {
        const data=this.images.get(item[field].image);if(!data) throw Error("Missing native image");item[field]=data;
      }
      return item;
    });
    return {...this.snapshot,sessions,current:sessions.find(s=>s.session_id===this.snapshot.current)??null};
  }
}
