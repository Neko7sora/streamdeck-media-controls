import sharp from 'sharp';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Reuse the product's vector mark. Transparent padding follows the store's
// recommended visual weight (112px circle on a 128px canvas).
const source=fileURLToPath(new URL('../assets/plugin-icon.svg',import.meta.url));
const directory=new URL('../chrome-extension/icons/',import.meta.url);
mkdirSync(directory,{recursive:true});
for(const size of [16,32,48,128]) {
  const mark=Math.round(size*0.875),before=Math.floor((size-mark)/2),after=size-mark-before;
  await sharp(source).resize(mark,mark).extend({top:before,left:before,bottom:after,right:after,background:'#0000'}).png().toFile(fileURLToPath(new URL(`icon-${size}.png`,directory)));
}
console.log('Chrome icons: 16, 32, 48, 128px');
