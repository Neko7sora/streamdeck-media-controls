import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {fileURLToPath} from "node:url";
import {validateSnapshot} from "./media-validation.js";
import type {MediaSnapshot} from "./media-model.js";
import {NativeWire} from "./native-wire.js";

const helper = fileURLToPath(new URL("../native/media-info.exe",import.meta.url));
const COMMAND_TIMEOUT_MS=5000;
const MAX_OUTPUT_LINE_BYTES=64_000_000;
type PendingCommand={resolve:()=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout};
type Connection={child:ChildProcessWithoutNullStreams;pending:Map<number,PendingCommand>};
let connection:Connection|undefined;
let sequence=0;
export function nativeCommand(command: Record<string,string|number>):Promise<void> {
  const current=connection;
  if(!current || current.child.killed || current.child.stdin.destroyed || !current.child.stdin.writable || current.pending.size>=32) return Promise.reject(new Error("Windows helper unavailable or busy"));
  return new Promise((resolve,reject)=>{
    const id=++sequence;
    const expiresAt=Date.now()+COMMAND_TIMEOUT_MS;
    const timer=setTimeout(()=>{current.pending.delete(id);reject(new Error("Windows command timed out"));},COMMAND_TIMEOUT_MS);
    current.pending.set(id,{resolve,reject,timer});
    current.child.stdin.write(JSON.stringify({...command,id,expires_at:expiresAt})+"\n",error=>{
      if(error) {clearTimeout(timer);current.pending.delete(id);reject(error);}
    });
  });
}
export function startNative(onSnapshot:(s:MediaSnapshot)=>void,onError:(s:string)=>void):()=>void {
  let stopped=false, retry:NodeJS.Timeout|undefined;
  let stopConnection:(()=>void)|undefined;
  let lastError="",lastErrorAt=0;
  const report=(message:string)=>{if(message!==lastError||Date.now()-lastErrorAt>30000){lastError=message;lastErrorAt=Date.now();onError(message);}};
  const start=()=>{
    if(stopped || process.platform!=="win32") return;
    const processChild=spawn(helper,["--watch","--delta"],{windowsHide:true,stdio:"pipe"});
    const wire=new NativeWire();
    const current:Connection={child:processChild,pending:new Map()};
    connection=current;
    let finished=false, watchdog:NodeJS.Timeout|undefined;
    let lastSeen=Date.now(), length=0;
    let fragments:Buffer[]=[];
    const finish=()=>{
      if(finished) return;
      finished=true;
      clearInterval(watchdog);fragments=[];length=0;
      if(connection===current) connection=undefined;
      for(const p of current.pending.values()) {clearTimeout(p.timer);p.reject(new Error("Windows helper disconnected"));}
      current.pending.clear();
      if(!stopped) {
        onSnapshot({current:null,sessions:[],audio:null});
        retry=setTimeout(start,3000);
      }
    };
    const fail=(message:string)=>{
      if(finished) return;
      report(message);finish();processChild.kill();
    };
    stopConnection=()=>{finish();processChild.kill();};
    // Writable errors are emitted even when write() has an error callback.
    processChild.stdin.on("error",e=>fail(`Windows helper input: ${e.message}`));
    processChild.stdout.on("error",e=>fail(`Windows helper output: ${e.message}`));
    processChild.stderr.on("error",e=>fail(`Windows helper stderr: ${e.message}`));
    const receiveLine=(line:string)=>{
      if(finished) return;
      try {
        const v:unknown=JSON.parse(line);
        if(!v || typeof v!=="object") throw new Error("Invalid native output");
        const record=v as Record<string,unknown>;
        if(typeof record.reply==="number") {
          const p=current.pending.get(record.reply); if(!p) return;
          current.pending.delete(record.reply);clearTimeout(p.timer);
          if(record.ok===true) p.resolve(); else p.reject(new Error(typeof record.error==="string" ? record.error : "Native command failed"));
        } else {
          const decoded=record.native_wire===2?wire.decode(record):v;
          if(decoded!==undefined) onSnapshot(validateSnapshot(decoded));
          lastSeen=Date.now();
        }
      } catch(e) {report(`Native output: ${String(e)}`);}
    };
    const flushLine=()=>{
      const line=(fragments.length===1?fragments[0]!:Buffer.concat(fragments,length)).toString("utf8");
      fragments=[];length=0;
      receiveLine(line);
    };
    processChild.stdout.on("data",(bytes:Buffer)=>{
      // Bound each JSON line before decoding or parsing it. A chunk may hold
      // several complete lines plus the beginning of the next one.
      let start=0;
      while(!finished&&start<bytes.length) {
        const newline=bytes.indexOf(10,start),end=newline<0?bytes.length:newline;
        length+=end-start;
        if(length>MAX_OUTPUT_LINE_BYTES) {fail("Windows helper output exceeded limit");return;}
        if(end>start) fragments.push(bytes.subarray(start,end));
        if(newline<0) return;
        flushLine();start=end+1;
      }
    });
    processChild.stdout.on("end",()=>{if(!finished&&length) flushLine();});
    processChild.stderr.on("data",(b:Buffer)=>{if(!finished) report(b.toString().slice(0,2000));});
    processChild.on("error",e=>fail(`Windows helper: ${e.message}`));
    watchdog=setInterval(()=>{if(Date.now()-lastSeen>12000) fail("Windows helper snapshot timed out");},2000);
    processChild.on("close",finish);
  };
  start();
  return ()=>{if(stopped) return;stopped=true;clearTimeout(retry);stopConnection?.();};
}
