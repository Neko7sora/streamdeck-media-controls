import {t} from "./localization.js";
import {execFile,type ChildProcess} from "node:child_process";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

type RegistrationResult={status:"registered"|"not-found"|"failed";message:string};
let pending:Promise<RegistrationResult>|undefined,child:ChildProcess|undefined;

// Registration runs only in response to the property inspector button. Share an
// in-flight attempt if another inspector requests it at the same time.
export function registerChromeHost(log:(message:string)=>void):Promise<RegistrationResult> {
  if(pending) return pending;
  if(process.platform!=="win32") return Promise.resolve({status:"failed",message:t("chrome.registration.windowsOnly")});
  const powershell=join(process.env.SystemRoot??"C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe");
  const script=fileURLToPath(new URL("../native/register-chrome-native-host.ps1",import.meta.url));
  pending=new Promise<RegistrationResult>(resolve=>{
    child=execFile(powershell,["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",script,"-NodePath",process.execPath],
      {windowsHide:true,timeout:20000,maxBuffer:64*1024},(error)=>{
        child=undefined;
        if(error&&"code" in error&&error.code===2) resolve({status:"not-found",message:t("chrome.registration.notFound")});
        else if(error) {log(`Chrome host registration failed: ${error.message}`);resolve({status:"failed",message:t("chrome.registration.failed")});}
        else resolve({status:"registered",message:t("chrome.registration.success")});
      });
  }).catch((error:unknown)=>{
    log(`Chrome host registration failed: ${String(error)}`);
    return {status:"failed" as const,message:t("chrome.registration.failed")};
  }).finally(()=>{pending=undefined;});
  return pending;
}

export function stopChromeRegistration():void {child?.kill();}
