import streamDeck from "@elgato/streamdeck";
import type {Server} from "node:https";
import {startIcueBridge} from "./icue-runtime.js";
import {ICUE_PORT} from "./icue-server.js";

type State = "loading" | "disabled" | "starting" | "running" | "error";
let enabled = true, ready = false, state: State = "loading", revision = 0, stopped = false;
let server: Server | undefined;
let queue: Promise<unknown> = Promise.resolve();
let disposeSettings: (() => void) | undefined;
const listeners = new Set<() => void>();
export const icueIntegrationStatus = () => ({enabled, ready, state, revision});
export function subscribeIcueIntegration(callback: () => void) {listeners.add(callback); return () => listeners.delete(callback);}
function publish(next: State) {state = next; revision++; for (const callback of listeners) callback();}
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work); queue = result.catch(() => {}); return result;
}
async function globalSettings() {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([streamDeck.settings.getGlobalSettings(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Global settings timed out")), 5000);
    })]);
  } finally {clearTimeout(timer);}
}
function close(current: Server): Promise<void> {
  return new Promise(resolve => {current.close(() => resolve()); current.closeAllConnections();});
}
async function apply(value: boolean) {
  if (stopped) return;
  enabled = value; ready = true;
  if (!enabled) {
    const current = server; server = undefined;
    if (current) await close(current);
    if (!stopped) publish("disabled");
    return;
  }
  if (server) return;
  publish("starting");
  try {
    const bridge = startIcueBridge({log:message=>streamDeck.logger.info(message)}), current = bridge.server;
    server = current;
    await new Promise<void>(resolve => {
      current.once("listening", () => {
        if (stopped || server !== current) {void close(current); resolve(); return;}
        streamDeck.logger.info(`iCUE bridge listening on https://127.0.0.1:${ICUE_PORT}`);
        streamDeck.logger.info(`Set the widget Bridge Token from: ${bridge.tokenFile}`);
        publish("running"); resolve();
      });
      current.on("error", error => {
        if (server === current) {
          server = undefined;
          streamDeck.logger.error(`iCUE bridge: ${String(error)}. Stop the standalone bridge if it is running.`);
          if (!stopped) publish("error");
        }
        void close(current); resolve();
      });
    });
  } catch (error) {streamDeck.logger.error(`iCUE bridge: ${String(error)}`); publish("error");}
}
export function initializeIcueIntegration(): Promise<void> {
  const subscription = streamDeck.settings.onDidReceiveGlobalSettings(ev => {
    void enqueue(() => apply(ev.settings.icueBridgeEnabled !== false));
  });
  disposeSettings = () => subscription.dispose();
  return enqueue(async () => {
    try {const saved = await globalSettings(); await apply(saved.icueBridgeEnabled !== false);}
    catch (error) {streamDeck.logger.error(`iCUE settings: ${String(error)}`); if (!stopped) publish("error");}
  });
}
export function setIcueIntegrationEnabled(value: boolean): Promise<void> {
  return enqueue(async () => {
    if (stopped) throw new Error("Plugin stopped");
    const saved = await globalSettings();
    if (stopped) throw new Error("Plugin stopped");
    await streamDeck.settings.setGlobalSettings({...saved, icueBridgeEnabled: value});
    await apply(value);
  });
}
export function stopIcueIntegration(): void {
  stopped = true; disposeSettings?.();
  const current = server; server = undefined;
  if (current?.listening) void close(current);
  // A pending listen is closed by its listening callback above.
}
