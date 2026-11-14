// Ignore observation clocks when deciding whether the inspector needs new data.
// The actual payload retains the clocks and all public metadata.
export function inspectorFingerprint(value:unknown):string {
  return JSON.stringify(value,(key,item)=>["observed_at","enriched_at","lastSeen"].includes(key)?undefined:
    key==="details"&&typeof item==="string"?JSON.parse(item):item);
}
export class InspectorUpdates {
  private previous:Record<string,unknown>={};
  reset():void {this.previous={};}
  changes(payload:Record<string,unknown>):Record<string,unknown> {
    const changed:Record<string,unknown>={};
    for(const [key,value] of Object.entries(payload)) {
      if(inspectorFingerprint(value)!==inspectorFingerprint(this.previous[key])) changed[key]=value;
    }
    this.previous=payload;return changed;
  }
}
