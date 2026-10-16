// Read-only Windows integration. Never changes playback or volume.
import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
const helper=fileURLToPath(new URL("../dev.local.media-controls.sdPlugin/native/media-info.exe",import.meta.url));
const child=spawn(helper,["--watch"],{windowsHide:true});
const timer=setTimeout(()=>{child.kill();console.error("Native smoke timed out");process.exitCode=1;},15000);
let snapshot=false,replied=false;
child.stderr.on("data",b=>process.stderr.write(b));
child.on("error",e=>{clearTimeout(timer);console.error(e);process.exitCode=1;});
createInterface({input:child.stdout}).on("line",line=>{
  try {
    const value=JSON.parse(line);
    if(Array.isArray(value.sessions)&&!snapshot){
      snapshot=true;assert.ok(value.current===null||typeof value.current==="object");
      console.log(`Native snapshot OK: GSMTC ${value.sessions.length} session(s), Core Audio ${value.audio?.sessions?.length??"unavailable"} session(s), master volume ${value.audio?.master?.volume??"unavailable"}`);
      child.stdin.write(JSON.stringify({id:1,command:"play-pause",session_id:"nonexistent-test-session"})+"\n");
    }
    if(value.reply===1){assert.equal(value.ok,false);replied=true;child.stdin.end();}
  }catch(e){console.error(e);process.exitCode=1;child.kill();}
});
child.on("close",code=>{clearTimeout(timer);if(code!==0||!snapshot||!replied) process.exitCode=1;else console.log("Native command rejection and clean shutdown OK");});
