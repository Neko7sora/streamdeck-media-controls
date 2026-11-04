/** Keep the host connection active even when no keys or inspectors are visible. */
export function startStreamDeckKeepalive(probe:()=>Promise<unknown>,onError:(message:string)=>void):()=>void {
  let stopped=false,pending=false;
  const tick=async()=>{
    // The SDK retains a response listener until getGlobalSettings resolves.
    // Never stack requests if the host is suspended or stops responding.
    if(stopped||pending) return;
    pending=true;
    try {await probe();}
    catch(error) {if(!stopped) onError(`Stream Deck keepalive: ${String(error)}`);}
    finally {pending=false;}
  };
  const timer=setInterval(()=>{void tick();},15000);
  timer.unref();
  return ()=>{stopped=true;clearInterval(timer);};
}
