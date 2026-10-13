import {cpSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=dirname(require.resolve('pdfjs-dist/package.json'));
for(const folder of ['cmaps','standard_fonts','wasm']) {
 const target=resolve('public/pdfjs',folder);mkdirSync(target,{recursive:true});cpSync(resolve(root,folder),target,{recursive:true});
}
