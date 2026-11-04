import {lstatSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';

export function marketplaceImagePaths(listing) {
  if(!Array.isArray(listing?.gallery)||listing.gallery.length<3||listing.gallery.length>10)
    throw Error('Provide 3–10 gallery items');
  const images=[listing.appIcon,listing.thumbnail,...listing.gallery];
  if(new Set(images).size!==images.length) throw Error('Provide separate app icon, thumbnail and gallery files');
  for(const path of images)
    if(typeof path!=='string'||!/^assets\/marketplace\/[a-z0-9-]+\.png$/.test(path))
      throw Error('Marketplace media must be local PNG assets');
  return images;
}

export function marketplaceOutputPaths(root,images) {
  const directory=resolve(root,'assets/marketplace');
  if(realpathSync(directory)!==resolve(realpathSync(root),'assets/marketplace'))
    throw Error('Marketplace output directory must not be a link');
  return images.map(path=>{
    const target=resolve(root,path);
    try {
      const entry=lstatSync(target);
      if(!entry.isFile()||entry.nlink!==1)
        throw Error(`${path}: Marketplace output must be an unlinked regular file`);
    } catch(error) {
      if(error.code!=='ENOENT') throw error;
    }
    return target;
  });
}
