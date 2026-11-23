import {nativeCommand} from "./native-client.js";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Actions accepted by the bundled native Windows helper. */
export type MediaCommand =
  | "play-pause"
  | "previous"
  | "next"
  | "stop"
  | "mute"
  | "volume-up"
  | "volume-down";

/** Resolve relative to the compiled entry point, not the user's CWD. */
const helperPath = fileURLToPath(new URL("../native/media-keys.exe", import.meta.url));

export function sendMediaKey(command: MediaCommand, count = 1): Promise<void> {
  if (!Number.isInteger(count) || count < 1 || count > 32) {
    return Promise.reject(new RangeError("count must be an integer from 1 to 32"));
  }

  if(process.platform==="darwin") {
    if(command==="mute") return nativeCommand({command:"mute",target:"master"});
    if(command==="volume-up"||command==="volume-down") return nativeCommand({command:"volume",target:"master",delta:(command==="volume-up"?1:-1)*count*0.02});
    return Promise.reject(new Error("Global playback keys are unavailable on macOS. Turn off global keys and select Music, Spotify or Chrome."));
  }
  if(process.platform!=="win32") return Promise.reject(new Error("Unsupported platform"));
  return new Promise<void>((resolve, reject) => {
    // No shell expansion. Arguments are fixed, validated strings.
    execFile(helperPath, [command, String(count)], {
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 4096
    }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`Media-key helper failed: ${stderr.trim() || error.message}`));
      } else {
        resolve();
      }
    });
  });
}
