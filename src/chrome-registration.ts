import {execFile,type ChildProcess} from "node:child_process";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

type RegistrationResult={status:"registered"|"not-found"|"failed";message:string};
let pending:Promise<RegistrationResult>|undefined,child:ChildProcess|undefined;

// Registration runs only in response to the property inspector button. Share an
// in-flight attempt if another inspector requests it at the same time.
export function registerChromeHost(log:(message:string)=>void):Promise<RegistrationResult> {
  if(pending) return pending;
  if(process.platform!=="win32") return Promise.resolve({status:"failed",message:"Chrome 連携の登録は Windows で利用できます。"});
  const powershell=join(process.env.SystemRoot??"C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe");
  const script=fileURLToPath(new URL("../native/register-chrome-native-host.ps1",import.meta.url));
  pending=new Promise<RegistrationResult>(resolve=>{
    child=execFile(powershell,["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",script,"-NodePath",process.execPath],
      {windowsHide:true,timeout:20000,maxBuffer:64*1024},(error)=>{
        child=undefined;
        if(error&&"code" in error&&error.code===2) resolve({status:"not-found",message:"拡張機能が見つかりません。Chrome で chrome-extension フォルダーを読み込んでから、もう一度ボタンを押してください。"});
        else if(error) {log(`Chrome host registration failed: ${error.message}`);resolve({status:"failed",message:"登録に失敗しました。プラグインのログを確認し、もう一度お試しください。"});}
        else resolve({status:"registered",message:"Chrome 連携を登録しました。拡張機能のオプションで送信を有効にしてください。接続できない場合は拡張機能を再読み込みしてください。"});
      });
  }).catch((error:unknown)=>{
    log(`Chrome host registration failed: ${String(error)}`);
    return {status:"failed" as const,message:"登録に失敗しました。プラグインのログを確認し、もう一度お試しください。"};
  }).finally(()=>{pending=undefined;});
  return pending;
}

export function stopChromeRegistration():void {child?.kill();}
