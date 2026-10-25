import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const directory='assets/chrome-web-store/';
await mkdir(new URL(directory,root),{recursive:true});

// Original vector composition around the bundled product mark. These are
// promotional illustrations, not screenshots or claims of a connected device.
// No text, third-party logos, album art or generated bitmap assets are used.
const mark=await read('assets/plugin-icon.svg');
const outputs={};
for(const [name,width,height,scale,offset] of [
  ['promo-small.png',440,280,1,0],
  ['promo-marquee.png',1400,560,2,260]
]) {
  const artwork=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><linearGradient id="background" x2="1" y2="1"><stop stop-color="#123e59"/><stop offset="1" stop-color="#131c2d"/></linearGradient></defs>
    <rect width="${width}" height="${height}" fill="url(#background)"/>
    <g transform="translate(${offset} 0) scale(${scale})">
      <circle cx="220" cy="140" r="172" fill="#59dcf5" opacity=".045"/>
      <circle cx="220" cy="140" r="122" fill="none" stroke="#59dcf5" stroke-opacity=".14"/>
      <path d="M111 140H329" fill="none" stroke="#59dcf5" stroke-width="3"/>
      <path d="m319 134 10 6-10 6" fill="none" stroke="#59dcf5" stroke-width="3"/>
      <rect x="26" y="102" width="84" height="76" rx="7" fill="#131c2d" stroke="#59dcf5" stroke-width="3"/>
      <path d="M26 119H110" stroke="#59dcf5" stroke-width="2"/>
      <circle cx="36" cy="111" r="2" fill="#59dcf5"/>
      <circle cx="44" cy="111" r="2" fill="#59dcf5"/>
      <path d="m59 130 24 16-24 16Z" fill="#59dcf5"/>
      <g fill="#131c2d" stroke="#59dcf5" stroke-width="3">
        <rect x="340" y="105" width="29" height="29" rx="5"/>
        <rect x="382" y="105" width="29" height="29" rx="5"/>
        <rect x="340" y="147" width="29" height="29" rx="5"/>
        <rect x="382" y="147" width="29" height="29" rx="5"/>
      </g>
      <g transform="translate(154 74) scale(.515625)">${mark.replace(/<\/?svg\b[^>]*>/g,'')}</g>
    </g>
  </svg>`);
  const bytes=await sharp(artwork).flatten({background:'#131c2d'}).removeAlpha().png().toBuffer();
  await writeFile(new URL(directory+name,root),bytes);
  outputs[directory+name]=digest(bytes);
}
for(const language of ['en','ja']) {
  const listing=JSON.parse(await read(`docs/chrome-web-store/listing.${language}.json`));
  const path=`docs/chrome-web-store/description.${language}.txt`;
  const text=listing.description+'\n';
  await writeFile(new URL(path,root),text);
  outputs[path]=digest(text);
}
const sources={};
for(const path of ['assets/plugin-icon.svg','scripts/build-chrome-listing.mjs',...['en','ja'].map(language=>`docs/chrome-web-store/listing.${language}.json`)]) {
  sources[path]=digest((await read(path)).replaceAll('\r\n','\n'));
}
await writeFile(new URL(directory+'listing-assets.json',root),JSON.stringify({
  method:'Original vector promotional illustration with the existing product mark; text-free, full bleed, no physical device or connection-state claim. Descriptions exported verbatim from localized listing JSON.',
  sources,outputs
},null,2)+'\n');
console.log('Chrome listing: 440 × 280 promotion, 1400 × 560 marquee and English/Japanese plain-text descriptions.');
