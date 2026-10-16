import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {fileURLToPath} from "node:url";
import {createInterface} from "node:readline";
import {validateSnapshot} from "./media-validation.js";
import type {MediaSnapshot} from "./media-model.js";

const helper = fileURLToPath(new URL("../native/media-info.exe",import.meta.url));
let child: ChildProcessWithoutNullStreams | undefined;
let sequence=0;
const pending=new Map<number,{resolve:()=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
export function nativeCommand(command: Record<string,string|number>):Promise<void> {
  if(!child || child.killed || pending.size>=32) return Promise.reject(new Error("Windows helper unavailable or busy"));
  return new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error("Windows command timed out"));},5000);
    pending.set(id,{resolve,reject,timer});
    child!.stdin.write(JSON.stringify({...command,id})+"\n",error=>{
      if(error) {clearTimeout(timer);pending.delete(id);reject(error);}
    });
  });
}
export function startNative(onSnapshot:(s:MediaSnapshot)=>void,onError:(s:string)=>void):()=>void {
  let stopped=false, retry:NodeJS.Timeout|undefined;
  let lastError="",lastErrorAt=0;
  const report=(message:string)=>{if(message!==lastError||Date.now()-lastErrorAt>30000){lastError=message;lastErrorAt=Date.now();onError(message);}};
  const start=()=>{
    if(stopped || process.platform!=="win32") return;
    const processChild=spawn(helper,["--watch"],{windowsHide:true,stdio:"pipe"});
    child=processChild;
    let lastSeen=Date.now(), length=0;
    const lines=createInterface({input:processChild.stdout});
    processChild.stdout.on("data",(bytes:Buffer)=>{
      length+=bytes.length;
      if(length>64_000_000) processChild.kill();
      if(bytes.includes(10)) length=0;
    });
    lines.on("line",line=>{
      try {
        const v:unknown=JSON.parse(line);
        if(!v || typeof v!=="object") throw new Error("Invalid native output");
        const record=v as Record<string,unknown>;
        if(typeof record.reply==="number") {
          const p=pending.get(record.reply); if(!p) return;
          pending.delete(record.reply);clearTimeout(p.timer);
          if(record.ok===true) p.resolve(); else p.reject(new Error(typeof record.error==="string" ? record.error : "Native command failed"));
        } else {onSnapshot(validateSnapshot(v));lastSeen=Date.now();}
      } catch(e) {report(`Native output: ${String(e)}`);}
    });
    processChild.stderr.on("data",(b:Buffer)=>report(b.toString().slice(0,2000)));
    processChild.on("error",e=>report(`Windows helper: ${e.message}`));
    const watchdog=setInterval(()=>{if(Date.now()-lastSeen>12000) {report("Windows helper snapshot timed out");processChild.kill();}},2000);
    processChild.on("close",()=>{
      clearInterval(watchdog);lines.close();
      if(child===processChild) child=undefined;
      for(const p of pending.values()) {clearTimeout(p.timer);p.reject(new Error("Windows helper disconnected"));} pending.clear();
      onSnapshot({current:null,sessions:[],audio:null});
      if(!stopped) retry=setTimeout(start,3000);
    });
  };
  start();
  return ()=>{stopped=true;clearTimeout(retry);child?.kill();};
}
