import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./media.js',import.meta.url));
const output=value=>{if(process.stdout.writableLength>1024*1024) process.exit(1);process.stdout.write(JSON.stringify(value)+'\n');};
const run=request=>new Promise((resolve,reject)=>execFile('/usr/bin/osascript',['-l','JavaScript',script,JSON.stringify(request)],{timeout:4000,maxBuffer:1024*1024},(error,stdout,stderr)=>error?reject(Error(stderr.trim()||error.message)):resolve(stdout.trim())));
let busy=false, pending=[], buffer='';
async function tick() {
  if(busy) return;
  busy=true;
  try {
    while(pending.length) {
      const command=pending.shift();
      try {if(Date.now()>=command.expires_at) throw Error('Expired command');await run(command);output({reply:command.id,ok:true});}
      catch(e) {output({reply:command.id,ok:false,error:e.message});}
    }
    const snapshot=JSON.parse(await run({command:'snapshot'}));
    if(snapshot.errors?.length) process.stderr.write(snapshot.errors.join('\n')+'\n');
    delete snapshot.errors;output(snapshot);
  } catch(e) {process.stderr.write(e.message+'\n');output({current:null,sessions:[],audio:null});}
  finally {busy=false;}
}
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{
  buffer+=chunk;
  if(Buffer.byteLength(buffer)>65536) process.exit(1);
  let end;
  while((end=buffer.indexOf('\n'))>=0) {
    try {
      const command=JSON.parse(buffer.slice(0,end));
      if(!Number.isSafeInteger(command.id)||!Number.isFinite(command.expires_at)||pending.length>=32) throw Error('Invalid command');
      if(!['play-pause','play','pause','stop','next','previous','seek','volume','mute'].includes(command.command)) throw Error('Unsupported command');
      if(command.command==='volume' && (!Number.isFinite(command.delta)||Math.abs(command.delta)>0.64)) throw Error('Invalid volume');
      pending.push(command);
    } catch {process.exit(1);}
    buffer=buffer.slice(end+1);
  }
  void tick();
});
process.stdin.on('end',()=>process.exit(0));
process.stdout.on('error',()=>process.exit(1));
setInterval(()=>void tick(),1000);void tick();
