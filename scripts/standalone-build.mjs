import {build} from 'esbuild';

export async function bundleStandalone({entry,banner='',target='chrome120'}) {
  const result=await build({entryPoints:[entry],bundle:true,write:false,format:'iife',platform:'browser',target,
    legalComments:'inline',banner:{js:banner}});
  return result.outputFiles[0].text;
}
