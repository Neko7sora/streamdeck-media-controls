import streamDeck from "@elgato/streamdeck";
import type {Server} from "node:https";
import {startChromeServer,PORT} from "../chrome/chrome-server.js";
import {registerChromeHost} from "../chrome/chrome-registration.js";
import {t} from "../localization.js";
import {readPluginSettings,updatePluginSettings} from "./plugin-settings.js";

type State = "loading" | "disabled" | "starting" | "running" | "error";
let enabled = true, ready = false, state: State = "loading", revision = 0, stopped = false;
let server: Server | undefined;
let queue: Promise<unknown> = Promise.resolve();
let disposeSettings: (() => void) | undefined;
let extensionId: string | undefined;
const listeners = new Set<() => void>();
export const chromeIntegrationStatus = () => ({enabled, ready, state, revision, extensionId});
export function subscribeChromeIntegration(callback: () => void) {listeners.add(callback); return () => listeners.delete(callback);}
function publish(next: State) {state = next; revision++; for (const callback of listeners) callback();}
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work); queue = result.catch(() => {}); return result;
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
    const current = startChromeServer(message=>streamDeck.logger.info(message));
    server = current;
    await new Promise<void>(resolve => {
      current.once("listening", () => {
        if (stopped || server !== current) {void close(current); resolve(); return;}
        streamDeck.logger.info(`Chrome bridge listening on https://127.0.0.1:${PORT}`);
        publish("running"); resolve();
      });
      current.on("error", error => {
        if (server === current) {
          server = undefined;
          streamDeck.logger.error(`Chrome bridge: ${String(error)}. Stop the standalone bridge if it is running.`);
          if (!stopped) publish("error");
        }
        void close(current); resolve();
      });
    });
  } catch (error) {streamDeck.logger.error(`Chrome bridge: ${String(error)}`); publish("error");}
}
function readExtensionId(saved: Record<string, unknown>) {
  extensionId = typeof saved.chromeExtensionId === "string" && /^[a-p]{32}$/.test(saved.chromeExtensionId) ? saved.chromeExtensionId : undefined;
}
export function initializeChromeIntegration(): Promise<void> {
  const subscription = streamDeck.settings.onDidReceiveGlobalSettings(ev => {
    void enqueue(() => {readExtensionId(ev.settings); return apply(ev.settings.chromeBridgeEnabled !== false);});
  });
  disposeSettings = () => subscription.dispose();
  return enqueue(async () => {
    try {const saved = await readPluginSettings(); readExtensionId(saved); await apply(saved.chromeBridgeEnabled !== false);}
    catch (error) {streamDeck.logger.error(`Chrome settings: ${String(error)}`); if (!stopped) publish("error");}
  });
}
export function setChromeIntegrationEnabled(value: boolean): Promise<void> {
  return enqueue(async () => {
    if (stopped) throw new Error("Plugin stopped");
    await updatePluginSettings({chromeBridgeEnabled: value}, () => !stopped);
    await apply(value);
  });
}
let registering = false;
export async function configureChromeIntegration(id: unknown) {
  if (typeof id !== "string" || !/^[a-p]{32}$/.test(id)) return {status:"failed", message:t("chrome.registration.invalidId")};
  if (registering) return {status:"failed", message:t("chrome.registration.busy")};
  registering = true;
  try {
    return await enqueue(async () => {
      if (stopped) throw new Error("Plugin stopped");
      const result = await registerChromeHost(id, message=>streamDeck.logger.warn(message));
      if (result.status !== "registered") return result;
      if (stopped) throw new Error("Plugin stopped");
      await updatePluginSettings({chromeExtensionId:id, chromeBridgeEnabled:true}, () => !stopped);
      extensionId = id;
      await apply(true);
      publish(state);
      return result;
    });
  } finally {registering = false;}
}
export function stopChromeIntegration(): void {
  stopped = true; disposeSettings?.();
  const current = server; server = undefined;
  if (current?.listening) void close(current);
  // A pending listen is closed by its listening callback above.
}
