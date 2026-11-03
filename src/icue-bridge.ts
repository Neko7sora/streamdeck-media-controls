import {randomBytes} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {loadCredentials, startChromeServer, chromeCommand, chromeConnectionStatus} from "./chrome-server.js";
import {currentMedia, availableSessions, audioTarget, audioTargets, subscribeChanges, startMediaPolling} from "./media-state.js";
import {nativeCommand} from "./native-client.js";
import {startIcueServer, ICUE_PORT} from "./icue-server.js";
import {setLanguage} from "./localization.js";

if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Windows x64 is required");
setLanguage("ja");
// Reuse the protected credential directory and TLS identity; the widget gets its own token.
const credentials = loadCredentials();
const tokenFile = join(process.env.LOCALAPPDATA!, "StreamDeckMediaControls", "icue-token.txt");
let token: string;
try {
  token = readFileSync(tokenFile, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid iCUE token file");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  token = randomBytes(32).toString("hex");
  writeFileSync(tokenFile, token + "\n", {flag: "wx", mode: 0o600});
}
const log = (message: string) => console.error(message);
const server = startIcueServer({media: currentMedia, sessions: availableSessions, audio: audioTarget, audioTargets,
  subscribe: subscribeChanges, native: nativeCommand, chromeStatus: chromeConnectionStatus,
  chrome: (media, command, position) => {
    if (media.tab_id === undefined || media.frame_id === undefined || !media.document_id) return Promise.reject(new Error("Chrome target unavailable"));
    return chromeCommand(media.tab_id, media.frame_id, media.document_id, media.title ?? "", command, position,
      media.browser_media?.target_id, media.client_id);
  }}, {token, tls: credentials.tls});
let stopMedia: (() => void) | undefined;
let chrome: ReturnType<typeof startChromeServer> | undefined;
server.once("listening", () => {
  log(`Edge Media Deck bridge: https://127.0.0.1:${ICUE_PORT}`);
  log(`Set the widget Bridge Token from: ${tokenFile}`);
  stopMedia = startMediaPolling(log);
  if (!process.argv.includes("--no-chrome")) chrome = startChromeServer(log);
});
server.once("error", error => {log(`iCUE bridge: ${error.message}`); shutdown(1);});
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true; stopMedia?.();
  chrome?.close(); chrome?.closeAllConnections();
  server.close(); server.closeAllConnections();
  setTimeout(() => process.exit(code), 100).unref();
}
process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());
