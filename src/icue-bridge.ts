import {startChromeServer} from "./chrome/chrome-server.js";
import {startMediaPolling} from "./media/media-state.js";
import {startIcueBridge} from "./icue/icue-runtime.js";
import {ICUE_PORT} from "./icue/icue-server.js";
import {setLanguage} from "./localization.js";

if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Windows x64 is required");
setLanguage("ja");
const log = (message: string) => console.error(message);
const {server, tokenFile} = startIcueBridge();
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
