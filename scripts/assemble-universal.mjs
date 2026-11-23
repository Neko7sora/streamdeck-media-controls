import {cpSync,existsSync,mkdirSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

export const bundleTargets=['win32-x64','darwin-arm64','darwin-x64'];
const pluginName='dev.n7s.media-controls.sdPlugin';
const notices=target=>target==='win32-x64'?'THIRD_PARTY_NOTICES.txt':`THIRD_PARTY_NOTICES.macos-${target.slice(7)}.txt`;
const imagePackages=target=>[`@img/sharp-${target}`,...(target.startsWith('darwin-')?[`@img/sharp-libvips-${target}`]:[])];
const helpers=target=>target==='win32-x64'?['media-info.exe','media-keys.exe']:['media-info.mjs','media.js'];
const json=file=>JSON.parse(readFileSync(file,'utf8'));

export function checkUniversalBundle(directory,lock=json(resolve('package-lock.json'))) {
  for(const target of bundleTargets) {
    for(const file of helpers(target)) {
      if(!existsSync(join(directory,'native',file))) throw Error(`Missing ${target} helper: ${file}`);
    }
    const notice=readFileSync(join(directory,notices(target)),'utf8');
    for(const name of imagePackages(target)) {
      const folder=join(directory,'node_modules',name),pkg=json(join(folder,'package.json'));
      if(pkg.name!==name||pkg.version!==lock.packages[`node_modules/${name}`]?.version) throw Error(`Unexpected image runtime: ${name}`);
      if(!notice.includes(`npm: ${name}@${pkg.version}\n`)) throw Error(`Missing license inventory: ${name}`);
      const extension=name.includes('libvips')?'.dylib':'.node';
      if(!readdirSync(folder,{recursive:true}).some(file=>file.endsWith(extension))) throw Error(`Missing native image binary: ${name}`);
    }
  }
  console.log('Universal bundle: Windows x64, macOS arm64 and macOS x64 assets present');
}

// Merge independently built trees; conflicting shared code must never be overwritten.
export function assembleUniversal(input,output,lock) {
  input=resolve(input);output=resolve(output);
  if(output===input||output.startsWith(input+sep)||input.startsWith(output+sep)) throw Error('Input and output directories must be separate');
  if(existsSync(output)) throw Error(`Output already exists: ${output}`);
  mkdirSync(output,{recursive:true});
  try {
    for(const target of bundleTargets) {
      const source=join(input,target,pluginName);
      const sourceNotice=target==='win32-x64'?'THIRD_PARTY_NOTICES.txt':'THIRD_PARTY_NOTICES.macos.txt';
      cpSync(join(source,sourceNotice),join(output,notices(target)));
      function merge(folder,relative='') {
        for(const entry of readdirSync(folder,{withFileTypes:true})) {
          if(!relative&&/^THIRD_PARTY_NOTICES.*\.txt$/.test(entry.name)) continue;
          const path=join(relative,entry.name),from=join(folder,entry.name),to=join(output,path);
          if(entry.isDirectory()) {mkdirSync(to,{recursive:true});merge(from,path);}
          else if(entry.isFile()) {
            if(existsSync(to)) {
              if(!readFileSync(from).equals(readFileSync(to))) throw Error(`Conflicting bundle file: ${path}`);
            } else {mkdirSync(dirname(to),{recursive:true});cpSync(from,to);}
          } else throw Error(`Unsupported bundle entry: ${path}`);
        }
      }
      merge(source);
    }
    checkUniversalBundle(output,lock);
  } catch(error) {rmSync(output,{recursive:true,force:true});throw error;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv.length!==4) throw Error('Usage: node scripts/assemble-universal.mjs <input-directory> <output.sdPlugin>');
  assembleUniversal(process.argv[2],process.argv[3]);
}
