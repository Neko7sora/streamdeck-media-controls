import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {createRequire} from "node:module";
import {displayFont} from "../src/display-font.ts";
import {checkGuidelines} from "./check-guidelines.mjs";
import {buildNotices} from "./build-notices.mjs";
const plugin = resolve("dev.n7s.media-controls.sdPlugin");
await checkGuidelines(plugin);
buildNotices(true);
for(const file of ["LICENSE","LICENSE-MIT","LICENSE-APACHE"]) {
  if(readFileSync(join(plugin,file),'utf8')!==readFileSync(resolve(file),'utf8')) throw new Error(`Stale project license: ${file}`);
}
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
  if(a.Encoder?.layout&&!a.Encoder.layout.startsWith("$")&&!existsSync(join(plugin,a.Encoder.layout))) throw new Error(`Missing layout: ${a.Encoder.layout}`);
}
for (const file of [m.CodePath, "native/media-keys.exe", "native/media-info.exe", "native/register-chrome-native-host.ps1", "native/chrome-native-host.mjs", "ui/settings.html", "ui/settings.css", "ui/settings.js", "ui/localization.js", "layouts/now-playing.json", "node_modules/sharp/package.json"]) {
  if (!existsSync(join(plugin,file))) throw new Error(`Missing build output: ${file}`);
}
console.log(`Manifest and assets: OK (${m.Actions.length} actions)`);
const require=createRequire(join(plugin,m.CodePath));
if(!require.resolve("sharp").startsWith(join(plugin,"node_modules"))) throw new Error("Image runtime missing from plugin");
if(process.platform==="win32"&&!existsSync(join(plugin,`node_modules/@img/sharp-win32-${process.arch}/package.json`))) throw new Error("Native image runtime missing");
const sharp=require("sharp");
await sharp({create:{width:2,height:2,channels:3,background:"black"}}).png().toBuffer();
const font=displayFont();
await sharp({text:{text:'<span foreground="white">日本語 &amp; Music 🎵</span>',font:`${font.family} 14`,fontfile:font.fontfile,dpi:72,rgba:true}}).png().toBuffer();
console.log("Bundled native image runtime: OK");
