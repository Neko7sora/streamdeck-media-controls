import {build,context} from "esbuild";
import {cpSync,mkdirSync,readFileSync,existsSync,rmSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {createRequire} from "node:module";
import {buildLocales} from "./build-locales.mjs";
import {buildNotices} from "./build-notices.mjs";
await buildLocales();
buildNotices();
const require=createRequire(import.meta.url),root=resolve("dev.n7s.media-controls.sdPlugin");
for(const file of ["LICENSE","LICENSE-MIT","LICENSE-APACHE"]) cpSync(resolve(file),resolve(root,file));
const runtime=resolve(root,"node_modules");
if(dirname(runtime)!==root) throw new Error("Runtime path escaped the plugin folder");
rmSync(runtime,{recursive:true,force:true});
// Preserve sharp's native module loading. Copy just its installed production graph.
const copied=new Set();
function copy(name,from=process.cwd()) {
  if(copied.has(name)) return;
  let manifest;
  try {manifest=require.resolve(`${name}/package.json`,{paths:[from]});}
  catch {manifest=resolve("node_modules",name,"package.json");if(!existsSync(manifest)) throw new Error(`Missing runtime dependency ${name}`);}
  copied.add(name);
  const dir=dirname(manifest),pkg=JSON.parse(readFileSync(manifest,"utf8"));
  mkdirSync(resolve(root,"node_modules",dirname(name)),{recursive:true});
  cpSync(dir,resolve(root,"node_modules",name),{recursive:true});
  for(const dependency of Object.keys(pkg.dependencies??{})) copy(dependency,dir);
  for(const dependency of Object.keys(pkg.optionalDependencies??{})) if(existsSync(resolve("node_modules",dependency))) copy(dependency,dir);
}
copy("sharp");
mkdirSync(resolve(root,"native"),{recursive:true});
for(const file of ["register-chrome-native-host.ps1","chrome-native-host.mjs"]) cpSync(resolve("scripts",file),resolve(root,"native",file));
// Bundled CommonJS dependencies (including ws) still require Node built-ins.
const options={entryPoints:["src/plugin.ts"],bundle:true,platform:"node",format:"esm",target:"node24",banner:{js:'import { createRequire as createBundleRequire } from "node:module"; const require = createBundleRequire(import.meta.url);'},external:["sharp"],outfile:resolve(root,"bin/plugin.js")};
if(process.argv.includes("--watch")) {const ctx=await context(options);await ctx.watch();}
else await build(options);
console.log(`Plugin built; ${copied.size} image runtime packages included.`);
