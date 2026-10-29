import type {IncomingMessage} from "node:http";
import {createServer,type Server,type ServerOptions} from "node:https";
import {randomBytes,timingSafeEqual,X509Certificate} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {ingestChrome,chromeSessions} from "./media-state.js";
import {ChromeWire} from "./chrome-wire.js";
import {chromeClientId,chromeFrameKey} from "./chrome-identity.js";
import type {ServerResponse} from "node:http";

export const PORT=39761;
let bridgeListening=false,lastChromeContact:number|null=null;
export function chromeConnectionStatus(now=Date.now()) {
  const connected=bridgeListening&&lastChromeContact!==null&&now-lastChromeContact<15000;
  return {state:!bridgeListening?"unavailable":connected?"connected":"disconnected",lastSeen:lastChromeContact,sessions:connected?chromeSessions(now).length:0};
}
function loadCredentials():{token:string;tls:ServerOptions} {
  if(!process.env.LOCALAPPDATA) throw new Error("LOCALAPPDATA is required for private token storage");
  const dir=join(process.env.LOCALAPPDATA,"StreamDeckMediaControls"), path=join(dir,"chrome-token.txt");
  const pfx=join(dir,"chrome-server.pfx"),cert=join(dir,"chrome-server.pem");
  mkdirSync(dir,{recursive:true});
  if(process.platform==="win32") {
    // mode:0600 does not set a Windows DACL. Restrict both existing and new tokens.
    const script=`$ErrorActionPreference='Stop'; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;
      $system=New-Object Security.Principal.SecurityIdentifier('S-1-5-18');
      $acl=New-Object Security.AccessControl.DirectorySecurity;
      $acl.SetAccessRuleProtection($true,$false);
      foreach($identity in @($sid,$system)) {$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))};
      [IO.Directory]::SetAccessControl($env:SDMC_TOKEN_DIR,$acl);
      foreach($file in @($env:SDMC_TOKEN_FILE,$env:SDMC_TLS_PFX,$env:SDMC_TLS_CERT)) {if([IO.File]::Exists($file)) {
        $fileAcl=New-Object Security.AccessControl.FileSecurity; $fileAcl.SetAccessRuleProtection($true,$false);
        foreach($identity in @($sid,$system)) {$fileAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow')))};
        [IO.File]::SetAccessControl($file,$fileAcl);
      }};
      if(-not [IO.File]::Exists($env:SDMC_TLS_PFX) -and -not [IO.File]::Exists($env:SDMC_TLS_CERT)) {
        $rsa=[Security.Cryptography.RSA]::Create(2048);
        try {
          $request=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Stream Deck Media Controls',$rsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1);
          $san=[Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new();
          $san.AddIpAddress([Net.IPAddress]::Parse('127.0.0.1')); $request.CertificateExtensions.Add($san.Build());
          $certificate=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5),[DateTimeOffset]::UtcNow.AddYears(10));
          try {
            [IO.File]::WriteAllBytes($env:SDMC_TLS_PFX,$certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx));
            $base64=[Convert]::ToBase64String($certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert),[Base64FormattingOptions]::InsertLineBreaks);
            [IO.File]::WriteAllText($env:SDMC_TLS_CERT,"-----BEGIN CERTIFICATE-----\n"+$base64+"\n-----END CERTIFICATE-----\n",[Text.Encoding]::ASCII);
          } finally {$certificate.Dispose()}
        } finally {$rsa.Dispose()}
      }`;
    execFileSync(join(process.env.SystemRoot??"C:\\Windows","System32/WindowsPowerShell/v1.0/powershell.exe"),["-NoProfile","-NonInteractive","-Command",script],{windowsHide:true,timeout:10000,env:{...process.env,SDMC_TOKEN_DIR:dir,SDMC_TOKEN_FILE:path,SDMC_TLS_PFX:pfx,SDMC_TLS_CERT:cert},stdio:"pipe"});
  }
  // Never regenerate a partial identity or silently fall back to plaintext.
  const tls={pfx:readFileSync(pfx),passphrase:""};
  const identity=new X509Certificate(readFileSync(cert));
  if(!identity.checkIP("127.0.0.1")||Date.parse(identity.validFrom)>Date.now()||Date.parse(identity.validTo)<=Date.now()) throw new Error("Invalid or expired Chrome bridge certificate");
  try {const found=readFileSync(path,"utf8").trim();if(/^[0-9a-f]{64}$/.test(found)) return {token:found,tls};} catch(e) {if((e as NodeJS.ErrnoException).code!=="ENOENT") throw e;}
  const token=randomBytes(32).toString("hex");
  writeFileSync(path,token+"\n",{flag:"wx",mode:0o600});
  return {token,tls};
}
function authorized(req:IncomingMessage,token:string):boolean {
  const v=req.headers.authorization;
  if(typeof v!=="string"||!v.startsWith("Bearer ")) return false;
  const a=Buffer.from(v.slice(7)),b=Buffer.from(token);
  return a.length===b.length&&timingSafeEqual(a,b);
}
type Command={id:string;tab_id:number;frame_id:number;document_id:string;client_id?:string;command:string;position?:number;title:string;target_id:string};
const pending=new Map<string,{command:Command;sent:boolean;resolve:()=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
const streams=new Map<string,{response:ServerResponse;lastWrite:number}>();
const owners=new Map<string,string>();
const sequences=new Map<string,number>();
const wire=new ChromeWire();
let epoch="";
function push(client:string,value:unknown):boolean {
  const stream=streams.get(client);if(!stream) return false;
  if(stream.response.destroyed) {streams.delete(client);return false;}
  // write(false) still accepts the event. Never redeliver an accepted toggle.
  if(!stream.response.write(JSON.stringify(value)+"\n")) {stream.response.destroy();streams.delete(client);}
  stream.lastWrite=Date.now();return true;
}
function dispatch():void {
  for(const p of pending.values()) if(!p.sent) {
    const c=p.command,owner=owners.get(`${chromeFrameKey(c.tab_id,c.frame_id,c.client_id)}:${c.document_id}`);
    if(owner&&push(owner,{event:"command",command:c})) p.sent=true;
  }
}
export function chromeCommand(tab_id:number,frame_id:number,document_id:string,title:string,command:string,position?:number,targetId?:string,clientId?:string):Promise<void> {
  if(typeof targetId!=="string" || !/^[A-Za-z0-9_-]{1,100}$/.test(targetId)) return Promise.reject(new Error("Chrome media target unavailable; reload the extension and media page"));
  if(pending.size>=32) return Promise.reject(new Error("Chrome command queue full"));
  return new Promise((resolve,reject)=>{
    const id=randomBytes(16).toString("hex");
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error("Chrome command timed out; no global fallback was sent"));},6500);
    pending.set(id,{command:{id,tab_id,frame_id,document_id,...(clientId?{client_id:clientId}:{}),title,command,position,target_id:targetId},sent:false,resolve,reject,timer});
    dispatch();
  });
}
export function startChromeServer(log:(s:string)=>void,options:{token?:string;port?:number;tls?:ServerOptions}={}):Server {
  const credentials=options.token===undefined&&options.tls===undefined?loadCredentials():options;
  if(!credentials.token||!credentials.tls) throw new Error("Chrome bridge requires token and TLS credentials");
  const {token,tls}=credentials;
  bridgeListening=false;lastChromeContact=null;
  epoch=randomBytes(16).toString("hex");wire.clear();owners.clear();sequences.clear();
  const server=createServer({...tls,minVersion:"TLSv1.2"},(req,res)=>{
    res.setHeader("Cache-Control","no-store");res.setHeader("Content-Type","application/json");
    const reply=(status:number,value:unknown)=>{if(!res.writableEnded) res.writeHead(status).end(JSON.stringify(value));};
    const eventRequest=req.method==="GET"&&req.url==="/chrome/events";
    if(!eventRequest&&(req.method!=="POST"||!["/chrome","/chrome/result","/chrome/status"].includes(req.url??""))) {reply(404,{error:"not_found"});return;}
    if(!authorized(req,token)) {reply(401,{error:"unauthorized"});return;}
    if(eventRequest) {
      const client=req.headers["x-sdmc-client"];
      if(typeof client!=="string"||!/^[a-f0-9-]{36}$/.test(client)||(!streams.has(client)&&streams.size>=8)) {reply(400,{error:"invalid_client"});return;}
      streams.get(client)?.response.destroy();
      res.setHeader("Content-Type","application/x-ndjson");res.setHeader("X-Accel-Buffering","no");res.writeHead(200);res.flushHeaders();res.setTimeout(0);
      const stream={response:res,lastWrite:0};streams.set(client,stream);
      push(client,{event:"ready",epoch});dispatch();
      res.on("close",()=>{if(streams.get(client)===stream) streams.delete(client);});return;
    }
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
        const clientId=chromeClientId(v.client_id);
        const sourceClient=req.headers["x-sdmc-client"];
        if(typeof sourceClient==="string") {const stream=streams.get(sourceClient);if(stream) stream.lastWrite=Date.now();}
        if(req.url==="/chrome/status") {lastChromeContact=Date.now();reply(200,{ok:true,protocol:2,epoch});return;}
        if(req.url==="/chrome/result") {
          const p=typeof v.id==="string"?pending.get(v.id):undefined;
          if(p&&(p.command.client_id??"")===clientId) {pending.delete(p.command.id);clearTimeout(p.timer);if(v.ok===true) p.resolve();else p.reject(new Error("Chrome operation unavailable or rejected"));}
          lastChromeContact=Date.now();
          reply(200,{ok:true});return;
        }
        const tab=v.tab_id,frame=v.frame_id;
        if(!Number.isSafeInteger(tab)||Number(tab)<0||!Number.isSafeInteger(frame)||Number(frame)<0||!Number.isSafeInteger(v.sequence)||Number(v.sequence)<0||typeof v.document_id!=="string"||v.document_id.length>100||!v.document_id) throw new Error("Invalid media update");
        const frameKey=chromeFrameKey(Number(tab),Number(frame),clientId),sequence=Number(v.sequence);
        // A delayed request from the previous host must not reclaim the stream
        // owner, rewind a delta base, or revive media that was already cleared.
        if(sequence<(sequences.get(frameKey)??-1)) {lastChromeContact=Date.now();reply(200,{ok:true,commands:[]});return;}
        const decoded=v.protocol===2?wire.decode(v):{media:v.media};
        if("resync" in decoded||"missing" in decoded) {reply(200,{ok:false,...decoded,epoch});return;}
        if(!ingestChrome(Number(tab),Number(frame),decoded.media,Number(v.sequence),v.document_id,clientId)) throw new Error("Invalid media update");
        sequences.delete(frameKey);sequences.set(frameKey,sequence);
        if(sequences.size>256) sequences.delete(sequences.keys().next().value!);
        const client=req.headers["x-sdmc-client"],prefix=`${frameKey}:`,ownerKey=`${prefix}${v.document_id}`;
        if(typeof client==="string"&&/^[a-f0-9-]{36}$/.test(client)) {
          for(const key of owners.keys()) if(key.startsWith(prefix)&&key!==ownerKey) owners.delete(key);
          owners.set(ownerKey,client);if(owners.size>256) owners.delete(owners.keys().next().value!);
          const stream=streams.get(client);if(stream) stream.lastWrite=Date.now();
        }
        lastChromeContact=Date.now();
        dispatch();
        const commands:Command[]=[];
        for(const p of pending.values()) if(!p.sent&&(p.command.client_id??"")===clientId&&p.command.tab_id===tab&&p.command.frame_id===frame&&p.command.document_id===v.document_id) {commands.push(p.command);p.sent=true;}
        reply(200,{ok:true,commands});
      } catch {reply(400,{error:"invalid_payload"});}
    });
  });
  server.requestTimeout=5000;server.headersTimeout=5000;server.timeout=5000;server.maxConnections=16;
  const heartbeat=setInterval(()=>{for(const [client,stream] of streams) if(Date.now()-stream.lastWrite>=5000) push(client,{event:"heartbeat"});},1000);heartbeat.unref();
  server.on("error",e=>{bridgeListening=false;log(`Chrome bridge: ${String(e)}`);});
  server.on("close",()=>{clearInterval(heartbeat);bridgeListening=false;lastChromeContact=null;streams.clear();owners.clear();sequences.clear();wire.clear();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error("Chrome bridge stopped"));}pending.clear();});
  server.listen(options.port??PORT,"127.0.0.1",()=>{bridgeListening=true;log(`Chrome bridge listening on loopback:${(server.address() as {port:number}).port}`);});
  return server;
}
