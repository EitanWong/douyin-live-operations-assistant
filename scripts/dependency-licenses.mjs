import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';

export async function readPackageLicense(root,name) {
  const directory=join(root,'node_modules',name);
  // Read the published filename verbatim: macOS can hide case errors that fail on Linux.
  const file=(await readdir(directory)).find(file=>/^license(?:\.(?:md|txt))?$/iu.test(file));
  if(file)return readFile(join(directory,file),'utf8');
  if(name==='@cfworker/json-schema')return readFile(join(root,'vendor/runtime-licenses/cfworker-json-schema/LICENSE'),'utf8');
  if(name==='js-tiktoken')return readFile(join(root,'vendor/runtime-licenses/js-tiktoken/LICENSE'),'utf8');
  if(name==='@ricky0123/vad-web')return readFile(join(root,'vendor/runtime-licenses/vad-web/LICENSE'),'utf8');
  if(['react-remove-scroll-bar','onnxruntime-web','onnxruntime-common'].includes(name))return readFile(join(root,'vendor/runtime-licenses',name,'LICENSE'),'utf8');
  throw new Error(`Missing license for ${name}`);
}
