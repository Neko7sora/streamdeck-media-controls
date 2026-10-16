import {build} from "esbuild";
import {mkdir,mkdtemp,rm} from "node:fs/promises";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url));
export async function load(name,plugins=[]) {
  const parent=fileURLToPath(new URL(".generated/",import.meta.url));
  await mkdir(parent,{recursive:true});
  const dir=await mkdtemp(parent+"test-");
  const output=dir+"/module.mjs";
  await build({entryPoints:[`src/${name}.ts`],absWorkingDir:root,outfile:output,bundle:true,platform:"node",format:"esm",target:"node24",packages:"external",logLevel:"silent",plugins});
  try {return await import(pathToFileURL(output));} finally {await rm(dir,{recursive:true,force:true});}
}
