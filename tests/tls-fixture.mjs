// Public, test-only identities. Never use these keys for an installed bridge.
import {readFileSync} from 'node:fs';
import {request} from 'node:https';
import {Readable} from 'node:stream';

const read=name=>readFileSync(new URL(`fixtures/tls/${name}.pem`,import.meta.url));
export const tls={key:read('trusted-key'),cert:read('trusted-cert')};
export const untrustedTls={key:read('untrusted-key'),cert:read('untrusted-cert')};
export function httpsFetch(url,options={}) {
  return new Promise((resolve,reject)=>{
    const req=request(url,{...options,ca:options.ca??tls.cert,rejectUnauthorized:true},res=>{
      const empty = [204,205,304].includes(res.statusCode);
      if(empty) res.resume();
      resolve(new Response(empty ? null : Readable.toWeb(res),{status:res.statusCode}));
    });
    req.on('error',reject);req.end(options.body);
  });
}
