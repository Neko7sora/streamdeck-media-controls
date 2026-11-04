import assert from 'node:assert/strict';
import sharp from 'sharp';

// Decode real raster fixtures and resample/encode them with Sharp in the Node VM.
// The browser E2E separately exercises the native canvas and bitmap APIs.
export function rasterWorkerHooks() {
  let opened=0,closed=0;
  return {
    async createImageBitmap(blob) {
      const input=Buffer.from(await blob.arrayBuffer()),{width,height}=await sharp(input).metadata();
      const pixels=await sharp(input).resize(32,32,{fit:'fill'}).ensureAlpha().raw().toBuffer();
      opened++;
      return {width,height,pixels,input,close(){closed++;}};
    },
    OffscreenCanvas:class {
      constructor(width,height) {this.width=width;this.height=height;}
      getContext(type) {
        assert.equal(type,'2d');
        return {drawImage:bitmap=>{this.image=bitmap;},getImageData:()=>{
          assert.equal(this.width,32);assert.equal(this.height,32);
          return {data:this.image.pixels};
        }};
      }
      async convertToBlob({type,quality}) {
        const image=sharp(this.image.input).resize(this.width,this.height,{fit:'fill'});
        const data=await (type==='image/webp'?image.webp({quality:Math.round(quality*100)}):image.png()).toBuffer();
        return new Blob([data],{type});
      }
    },
    assertClosed() {assert.equal(closed,opened,'decoded bitmaps must be released');}
  };
}
