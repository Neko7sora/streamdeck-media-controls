// A profile keeps its namespace when its worker or native host reconnects.
// Missing IDs retain compatibility with older extensions.
export function chromeClientId(value:unknown):string {
  if(value===undefined) return "";
  if(typeof value!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) throw Error("Invalid Chrome client ID");
  return value;
}

export function chromeFrameKey(tab:number,frame:number,client=""):string {
  return `${client?`${client}:`:""}${tab}:${frame}`;
}
