import sharp from "sharp";
import {fileURLToPath} from "node:url";
const source=new URL("../assets/plugin-icon.svg",import.meta.url);
for(const [size,suffix] of [[256,""],[512,"@2x"]]) {
  await sharp(fileURLToPath(source)).resize(size,size).png().toFile(fileURLToPath(new URL(`../dev.n7s.media-controls.sdPlugin/imgs/plugin-icon${suffix}.png`,import.meta.url)));
}
console.log("Plugin icons: 256 × 256 and 512 × 512");
