import sharp from "sharp";
import { createHash } from "node:crypto";
import { safeImage, type MediaItem } from "./media-model.js";

sharp.cache({memory:8, files:0, items:16});
sharp.concurrency(1);
/** A broken favicon must not hide a working application icon. */
export async function applicationIcon(media: MediaItem | null, size = 32): Promise<string | undefined> {
  return (await artwork(media?.favicon_data_url,size)) ?? (await artwork(media?.app_icon_data_url,size));
}
const loadingImages = new Map<string, Promise<string>>();
/** Keep the loading marker above the key's title and artist overlays. */
export function artworkLoadingImage(label: string, size = 144): Promise<string> {
  const key = JSON.stringify([label,size]);
  let image = loadingImages.get(key);
  if (!image) {
    const escaped = label.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
    image = sharp(Buffer.from(`<svg width="${size}" height="${size}" viewBox="0 0 144 144"><rect width="144" height="144" fill="#101018"/><circle cx="72" cy="25" r="13" fill="none" stroke="#384355" stroke-width="4"/><path d="M72 12 A13 13 0 0 1 85 25" fill="none" stroke="#75cfff" stroke-width="4" stroke-linecap="round"/><text x="72" y="62" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#e7f5ff">${escaped}</text></svg>`)).png().toBuffer().then(bytes => `data:image/png;base64,${bytes.toString("base64")}`);
    loadingImages.set(key,image);
  }
  return image;
}
const cache = new Map<string, Promise<string | undefined>>();
/** Decode before sending to Stream Deck; disallow SVG, animation and pixel bombs. */
export async function artwork(data: unknown, size = 144): Promise<string | undefined> {
  const safe = safeImage(data); if (!safe) return undefined;
  const key = `${size}:${createHash("sha256").update(safe).digest("hex")}`;
  const cached = cache.get(key); if (cached) return cached;
  const result = (async () => {
    try {
      const input = Buffer.from(safe.slice(safe.indexOf(",")+1),"base64");
      const png=input.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const jpeg=input[0]===255&&input[1]===216&&input[2]===255;
      const webp=input.toString("ascii",0,4)==="RIFF"&&input.toString("ascii",8,12)==="WEBP";
      if(!png&&!jpeg&&!webp) return undefined;
      const image = sharp(input,{limitInputPixels:16_777_216,failOn:"warning",animated:false});
      const meta = await image.metadata();
      if (!["png","jpeg","webp"].includes(meta.format ?? "") || (meta.pages ?? 1) > 1) return undefined;
      const bytes = await image.resize(size,size,{fit:"contain",background:"#101018",withoutEnlargement:false}).png().toBuffer();
      return `data:image/png;base64,${bytes.toString("base64")}`;
    } catch {return undefined;}
  })();
  cache.set(key,result);
  if (cache.size > 48) cache.delete(cache.keys().next().value!);
  return result;
}
