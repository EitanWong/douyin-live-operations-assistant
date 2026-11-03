import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

test('bundled window can close before the deferred React motion workspace initializes',async()=>{
 const result=await build({stdin:{contents:"export {WindowPresence} from './src/ui/window-presence.js'; export const prepareWorkspace=()=>import('motion/react');",resolveDir:fileURLToPath(new URL('../../',import.meta.url))},bundle:true,format:'esm',minify:true,define:{'process.env.NODE_ENV':'"production"'},write:false});
 const {WindowPresence}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
 const presence=new WindowPresence(1);presence.target=0;
 presence.step(.1);assert.ok(presence.value<1 && presence.value>0);
 for(let i=0;i<100;i++)presence.step(.016);
 assert.equal(presence.value,0);assert.equal(presence.active,false);
});
