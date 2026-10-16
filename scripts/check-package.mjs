import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
const plugin = resolve("dev.local.media-controls.sdPlugin");
const m = JSON.parse(readFileSync(join(plugin, "manifest.json"), "utf8"));
const actions = new Set();
function checkImage(base) {
  for (const suffix of [".png", "@2x.png"]) {
    if (!existsSync(join(plugin, base + suffix))) throw new Error(`Missing image: ${base + suffix}`);
  }
}
if (m.SDKVersion !== 3 || m.Nodejs?.Version !== "24") throw new Error("Unexpected SDK version");
checkImage(m.Icon);
checkImage(m.CategoryIcon);
for (const a of m.Actions) {
  if (actions.has(a.UUID)) throw new Error(`Duplicate action UUID: ${a.UUID}`);
  actions.add(a.UUID);
  if (!a.UUID.startsWith(m.UUID + ".")) throw new Error(`Invalid UUID prefix: ${a.UUID}`);
  checkImage(a.Icon);
  for (const state of a.States) checkImage(state.Image);
}
for (const file of [m.CodePath, "native/media-keys.exe", "native/media-info.exe"]) {
  if (!existsSync(join(plugin,file))) throw new Error(`Missing build output: ${file}`);
}
console.log(`Manifest and assets: OK (${m.Actions.length} actions)`);
