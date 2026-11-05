import {installNative} from './lib/native-install.mjs';
import {bootstrapNativeDeployment,registeredNativeDeployment} from './lib/native-deployment.mjs';
import {rm} from 'node:fs/promises';

const flags=new Set(['--uninstall','--doctor','--without-asr','--foreground','--status']);
const values=new Set(['--extension-id','--python','--ffmpeg','--asr-model-dir','--browser']);
const args={};
for(const argument of process.argv.slice(2)){
  const at=argument.indexOf('=');
  if(flags.has(argument)){args[argument]=true;continue;}
  const key=argument.slice(0,at),value=argument.slice(at+1);
  if(at<0 || !values.has(key) || !value)throw new Error(`不支持的安装参数：${argument}`);
  args[key]=value;
}
try{
 if(args['--status'])console.log(JSON.stringify(await (await registeredNativeDeployment({args})).deployment.status({resume:true}),null,2));
 else if(args['--uninstall']){
  let agent;try{agent=await registeredNativeDeployment({args});}catch(error){if(error.code!=='ENOENT')throw error;}
  if(agent && ['queued','running'].includes((await agent.deployment.status()).phase))throw new Error('后台安装尚未结束，请完成后再卸载');
  await installNative({args});if(agent)await rm(agent.manifest);
 }
 else if(args['--doctor'] || args['--foreground'])await installNative({args});
 else await bootstrapNativeDeployment({args});
}catch(error){console.error(`安装未完成：${error.message}`);process.exitCode=1;}
