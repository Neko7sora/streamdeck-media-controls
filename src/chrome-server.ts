import {createServer, type IncomingMessage} from "node:http";
import {randomBytes, timingSafeEqual} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {ingestChrome} from "./media-state.js";

export const PORT = 39761;
const dir = join(process.env.LOCALAPPDATA || process.env.APPDATA || process.cwd(), "StreamDeckMediaControls");
const tokenPath = join(dir,"chrome-token.txt");
function loadToken(): string {
  mkdirSync(dir, {recursive:true});
  try {
    const found = readFileSync(tokenPath,"utf8").trim();
    if(/^[0-9a-f]{64}$/.test(found)) return found;
  } catch { /* not yet paired */ }
  const token = randomBytes(32).toString("hex");
  writeFileSync(tokenPath, `${token}\n`, {flag:"w",mode:0o600});
  return token;
}
function authorized(req:IncomingMessage, token:string):boolean {
  const value = req.headers.authorization;
  if(typeof value !== "string" || !value.startsWith("Bearer ")) return false;
  const candidate=Buffer.from(value.substring(7),"utf8");
  const expected=Buffer.from(token,"utf8");
  return candidate.length === expected.length && timingSafeEqual(candidate,expected);
}
export function startChromeServer(log:(s:string)=>void): void {
  const token=loadToken();
  const server = createServer((req,res)=>{
    res.setHeader("Cache-Control","no-store");
    res.setHeader("Content-Type","application/json; charset=utf-8");
    if(req.method !== "POST" || req.url !== "/chrome") {res.writeHead(404).end('{"error":"not_found"}');return;}
    if(!authorized(req,token)) {res.writeHead(401).end('{"error":"unauthorized"}');return;}
    if(req.headers["content-type"]?.split(";")[0] !== "application/json") {res.writeHead(415).end('{"error":"content_type"}');return;}
    let size=0; const parts:Buffer[]=[];
    req.on("data", (chunk: Buffer)=>{
      size+=chunk.length;
      if(size>1_750_000) {req.destroy();return;}
      parts.push(chunk);
    });
    req.on("end",()=>{
      try {
        const body:unknown=JSON.parse(Buffer.concat(parts).toString("utf8"));
        if(!body || typeof body!=="object") throw new Error("payload must be object");
        const record=body as Record<string,unknown>;
        if(typeof record.tab_id!=="number" || !Number.isSafeInteger(record.tab_id)) throw new Error("invalid tab_id");
        ingestChrome(record.tab_id,record.media);
        res.writeHead(200).end('{"ok":true}');
      } catch(e) {log(`Invalid Chrome input: ${String(e)}`);res.writeHead(400).end('{"error":"invalid_json"}');}
    });
  });
  server.on("error",e=>log(`Chrome bridge not started: ${String(e)}`));
  server.listen(PORT,"127.0.0.1",()=>log(`Chrome bridge listening on 127.0.0.1:${PORT}; local only`));
}
