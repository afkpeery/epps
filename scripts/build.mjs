import { mkdir, readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { extname } from 'node:path';
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8','.jpg':'image/jpeg','.webp':'image/webp'};
const assets={};
for (const entry of await readdir('public',{recursive:true,withFileTypes:true})) {
  if (!entry.isFile()) continue;
  const file=entry.parentPath+'/'+entry.name;
  const type=types[extname(file)];
  if (!type) throw new Error('Missing content type for '+file);
  const binary=type.startsWith('image/');
  assets[file.slice('public'.length)]=[type,await readFile(file,binary?'base64':'utf8'),binary];
}
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
const worker=await readFile('worker/index.mjs','utf8');
await writeFile('dist/server/index.js',worker.replace("import { assets } from './assets.mjs';",'const assets = '+JSON.stringify(assets)+';'));
await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
