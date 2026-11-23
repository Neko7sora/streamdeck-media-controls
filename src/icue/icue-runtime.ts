import {privateDirectory} from "../platform-paths.js";
import {randomBytes} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {loadCredentials, chromeCommand, chromeConnectionStatus} from "../chrome/chrome-server.js";
import {currentMedia, availableSessions, audioTarget, audioTargets, subscribeChanges} from "../media/media-state.js";
import {nativeCommand} from "../native/native-client.js";
import {startIcueServer} from "./icue-server.js";

/** Share the host's media state and Chrome transport without starting another poller or helper. */
export function startIcueBridge(options: {port?: number; log?: (message: string) => void} = {}) {
  // This also restricts the credential directory and existing files to the user and SYSTEM.
  const credentials = loadCredentials();
  const tokenFile = join(privateDirectory(), "icue-token.txt");
  const readToken = () => {
    const token = readFileSync(tokenFile, "utf8").trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid iCUE token file");
    return token;
  };
  let token: string;
  try {token = readToken();}
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    token = randomBytes(32).toString("hex");
    try {writeFileSync(tokenFile, token + "\n", {flag: "wx", mode: 0o600});}
    catch (error) {
      // Another host may have created the shared token while we were starting.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      token = readToken();
    }
  }
  const server = startIcueServer({media: currentMedia, sessions: availableSessions, audio: audioTarget, audioTargets,
    subscribe: subscribeChanges, native: nativeCommand, chromeStatus: chromeConnectionStatus,
    chrome: (media, command, position) => {
      if (media.tab_id === undefined || media.frame_id === undefined || !media.document_id) return Promise.reject(new Error("Chrome target unavailable"));
      return chromeCommand(media.tab_id, media.frame_id, media.document_id, media.title ?? "", command, position,
        media.browser_media?.target_id, media.client_id);
    }}, {token, tls: credentials.tls, port: options.port, log: options.log});
  return {server, tokenFile};
}
