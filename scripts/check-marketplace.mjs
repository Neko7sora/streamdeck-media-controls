import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import sharp from "sharp";
import {digest,sourceHashes,root} from "./build-marketplace.mjs";

// Local, structural checks only. No claim of Marketplace approval, IP clearance,
// name availability, human contribution or live device validation.
export async function checkMarketplace() {
  const read=path=>readFileSync(resolve(root,path));
  const listing=JSON.parse(read("docs/marketplace/listing.en.json"));
  const manifest=JSON.parse(read("dev.n7s.media-controls.sdPlugin/manifest.json"));
  const require=(condition,message)=>{if(!condition) throw Error(message);};
  const {name,description}=listing;
  require(typeof name==="string"&&name===manifest.Name,"Marketplace and manifest names must match");
  require(name.length<=30&&/^[A-Z][A-Za-z0-9 &'-]*$/.test(name),"Use a short English product name without special characters");
  require(!name.toLowerCase().includes(manifest.Author.toLowerCase()),"Product name must not include the Maker name");
  require(!/\b(plugin|official|best|top quality|hot item|best seller)\b/i.test(name),"Review the product name against Marketplace naming requirements");
  require(typeof description==="string"&&description.length>=250&&description.length<=1500,`Description must contain 250–1500 characters (actual: ${description?.length})`);
  require(!/[\r\n*_#<>`\[\]]/.test(description.slice(0,250)),"First 250 description characters must be unformatted text");
  require(/^[\x20-\x7e\n]+$/.test(description),"This English listing uses plain ASCII text");
  require(description.includes("Requires Windows")&&description.includes("Stream Deck 7.1")&&description.includes("Chrome 111"),"List the runtime requirements");
  require(typeof listing.aiDisclosure==="string"&&listing.aiDisclosure.includes("AI assistance"),"Missing AI usage disclosure");
  require(description.includes("AI assistance"),"Include AI usage disclosure in the submitted listing description");
  require(read("docs/marketplace/description.en.txt").toString("utf8").trimEnd()===description,"Stale description.en.txt; run npm run marketplace:build");
  require(Array.isArray(listing.gallery)&&listing.gallery.length>=3&&listing.gallery.length<=10,"Provide 3–10 gallery items");
  const images=[listing.appIcon,listing.thumbnail,...listing.gallery];
  require(new Set(images).size===images.length,"Provide separate app icon, thumbnail and gallery files");
  const provenance=JSON.parse(read("assets/marketplace/provenance.json"));
  require(JSON.stringify(provenance.sources)===JSON.stringify(sourceHashes()),"Marketplace source changed; run npm run marketplace:build and review images again");
  for(const [i,path] of images.entries()) {
    require(typeof path==="string"&&/^assets\/marketplace\/[a-z0-9-]+\.png$/.test(path),"Marketplace media must be local PNG assets");
    const bytes=read(path),meta=await sharp(bytes).metadata();
    const [width,height]=i===0?[288,288]:[1920,960];
    require(meta.format==="png"&&meta.width===width&&meta.height===height&&(meta.pages??1)===1,`${path}: expected static ${width} × ${height} PNG`);
    require(provenance.outputs[path]===digest(bytes),`${path}: media differs from the recorded build; regenerate and review`);
  }
  for(const path of ["docs/marketplace/privacy.md","docs/marketplace/setup.md","docs/product-guidelines.md"]) require(read(path).length>0,`Missing ${path}`);
  for(const type of ["setup","support","privacy"]) require(new URL(listing.links[type]).protocol==="https:",`Missing HTTPS ${type} link`);
  console.log(`Product guidelines: local checks OK (${description.length} description characters, ${images.length} PNG assets). Manual publication review remains required; see docs/product-guidelines.md.`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) await checkMarketplace();
