import {createServer,type IncomingMessage,type Server} from "node:http";
import {randomBytes,timingSafeEqual} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {ingestChrome,chromeSessions} from "./media-state.js";

export const PORT=39761;
let bridgeListening=false,lastChromeContact:number|null=null;
export function chromeConnectionStatus(now=Date.now()) {
  const connected=bridgeListening&&lastChromeContact!==null&&now-lastChromeContact<15000;
  return {state:!bridgeListening?"unavailable":connected?"connected":"disconnected",lastSeen:lastChromeContact,sessions:connected?chromeSessions(now).length:0};
}
function loadToken():string {
  if(!process.env.LOCALAPPDATA) throw new Error("LOCALAPPDATA is required for private token storage");
  const dir=join(process.env.LOCALAPPDATA,"StreamDeckMediaControls"), path=join(dir,"chrome-token.txt");
  mkdirSync(dir,{recursive:true});
  if(process.platform==="win32") {
    // mode:0600 does not set a Windows DACL. Restrict both existing and new tokens.
    const script=`$ErrorActionPreference='Stop'; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;
      $system=New-Object Security.Principal.SecurityIdentifier('S-1-5-18');
      $acl=New-Object Security.AccessControl.DirectorySecurity;
      $acl.SetAccessRuleProtection($true,$false);
      foreach($identity in @($sid,$system)) {$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))};
      [IO.Directory]::SetAccessControl($env:SDMC_TOKEN_DIR,$acl);
      if([IO.File]::Exists($env:SDMC_TOKEN_FILE)) {
        $fileAcl=New-Object Security.AccessControl.FileSecurity; $fileAcl.SetAccessRuleProtection($true,$false);
        foreach($identity in @($sid,$system)) {$fileAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow')))};
        [IO.File]::SetAccessControl($env:SDMC_TOKEN_FILE,$fileAcl);
      }`;
    execFileSync(join(process.env.SystemRoot??"C:\\Windows","System32/WindowsPowerShell/v1.0/powershell.exe"),["-NoProfile","-NonInteractive","-Command",script],{windowsHide:true,timeout:10000,env:{...process.env,SDMC_TOKEN_DIR:dir,SDMC_TOKEN_FILE:path},stdio:"pipe"});
  }
  try {const found=readFileSync(path,"utf8").trim();if(/^[0-9a-f]{64}$/.test(found)) return found;} catch(e) {if((e as NodeJS.ErrnoException).code!=="ENOENT") throw e;}
  const token=randomBytes(32).toString("hex");
  writeFileSync(path,token+"\n",{flag:"wx",mode:0o600});
  return token;
}
function authorized(req:IncomingMessage,token:string):boolean {
  const v=req.headers.authorization;
  if(typeof v!=="string"||!v.startsWith("Bearer ")) return false;
  const a=Buffer.from(v.slice(7)),b=Buffer.from(token);
  return a.length===b.length&&timingSafeEqual(a,b);
}
type Command={id:string;tab_id:number;frame_id:number;document_id:string;command:string;position?:number;title:string};
const pending=new Map<string,{command:Command;sent:boolean;resolve:()=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
export function chromeCommand(tab_id:number,frame_id:number,document_id:string,title:string,command:string,position?:number):Promise<void> {
  if(pending.size>=32) return Promise.reject(new Error("Chrome command queue full"));
  return new Promise((resolve,reject)=>{
    const id=randomBytes(16).toString("hex");
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error("Chrome command timed out; no global fallback was sent"));},6500);
    pending.set(id,{command:{id,tab_id,frame_id,document_id,title,command,position},sent:false,resolve,reject,timer});
  });
}
export function startChromeServer(log:(s:string)=>void,options:{token?:string;port?:number}={}):Server {
  const token=options.token??loadToken();
  bridgeListening=false;lastChromeContact=null;
  const server=createServer((req,res)=>{
    res.setHeader("Cache-Control","no-store");res.setHeader("Content-Type","application/json");
    const reply=(status:number,value:unknown)=>{if(!res.writableEnded) res.writeHead(status).end(JSON.stringify(value));};
    if(req.method!=="POST"||!["/chrome","/chrome/result","/chrome/status"].includes(req.url??"")) {reply(404,{error:"not_found"});return;}
    if(!authorized(req,token)) {reply(401,{error:"unauthorized"});return;}
    if(req.headers["content-type"]?.split(";")[0]?.trim()!=="application/json") {reply(415,{error:"content_type"});return;}
    let size=0,oversized=false;const parts:Buffer[]=[];
    req.on("error",()=>{res.destroy();});
    req.on("data",(chunk:Buffer)=>{
      size+=chunk.length;
      if(size>1_750_000) {oversized=true;parts.length=0;reply(413,{error:"too_large"});req.destroy();return;}
      parts.push(chunk);
    });
    req.on("end",()=>{
      if(oversized) return;
      try {
        const b:unknown=JSON.parse(Buffer.concat(parts).toString("utf8"));
        if(!b||typeof b!=="object"||Array.isArray(b)) throw new Error("Invalid payload");
        const v=b as Record<string,unknown>;
        if(req.url==="/chrome/status") {lastChromeContact=Date.now();reply(200,{ok:true});return;}
        if(req.url==="/chrome/result") {
          const p=typeof v.id==="string"?pending.get(v.id):undefined;
          if(p) {pending.delete(p.command.id);clearTimeout(p.timer);if(v.ok===true) p.resolve();else p.reject(new Error("Chrome operation unavailable or rejected"));}
          reply(200,{ok:true});return;
        }
        const tab=v.tab_id,frame=v.frame_id;
        if(typeof tab!=="number"||typeof frame!=="number"||!Number.isSafeInteger(v.sequence)||Number(v.sequence)<0||typeof v.document_id!=="string"||v.document_id.length>100||!v.document_id||!ingestChrome(tab,frame,v.media,Number(v.sequence),v.document_id)) throw new Error("Invalid media update");
        lastChromeContact=Date.now();
        const commands:Command[]=[];
        for(const p of pending.values()) if(!p.sent&&p.command.tab_id===tab&&p.command.frame_id===frame&&p.command.document_id===v.document_id) {commands.push(p.command);p.sent=true;}
        reply(200,{ok:true,commands});
      } catch {reply(400,{error:"invalid_payload"});}
    });
  });
  server.requestTimeout=5000;server.headersTimeout=5000;server.timeout=5000;server.maxConnections=16;
  server.on("error",e=>{bridgeListening=false;log(`Chrome bridge: ${String(e)}`);});
  server.on("close",()=>{bridgeListening=false;lastChromeContact=null;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error("Chrome bridge stopped"));}pending.clear();});
  server.listen(options.port??PORT,"127.0.0.1",()=>{bridgeListening=true;log(`Chrome bridge listening on loopback:${(server.address() as {port:number}).port}`);});
  return server;
}
