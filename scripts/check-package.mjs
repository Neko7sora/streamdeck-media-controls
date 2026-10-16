import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {createRequire} from "node:module";
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
for (const file of [m.CodePath, "native/media-keys.exe", "native/media-info.exe", "ui/settings.html", "ui/settings.js", "layouts/now-playing.json", "node_modules/sharp/package.json"]) {
  if (!existsSync(join(plugin,file))) throw new Error(`Missing build output: ${file}`);
}
console.log(`Manifest and assets: OK (${m.Actions.length} actions)`);
const require=createRequire(join(plugin,m.CodePath));
if(!require.resolve("sharp").startsWith(join(plugin,"node_modules"))) throw new Error("Image runtime missing from plugin");
if(process.platform==="win32"&&!existsSync(join(plugin,`node_modules/@img/sharp-win32-${process.arch}/package.json`))) throw new Error("Native image runtime missing");
const sharp=require("sharp");
await sharp({create:{width:2,height:2,channels:3,background:"black"}}).png().toBuffer();
console.log("Bundled native image runtime: OK");
