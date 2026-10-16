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
  if (process.platform !== "win32") {
    return Promise.reject(new Error("This plugin supports Windows only."));
  }
  if (!Number.isInteger(count) || count < 1 || count > 32) {
    return Promise.reject(new RangeError("count must be an integer from 1 to 32"));
  }

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
