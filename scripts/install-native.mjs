import {installNative} from './lib/native-install.mjs';

const flags=new Set(['--uninstall','--doctor','--without-asr']);
const values=new Set(['--extension-id','--python','--ffmpeg','--asr-model-dir','--browser']);
const args={};
for(const argument of process.argv.slice(2)){
  const at=argument.indexOf('=');
  if(flags.has(argument)){args[argument]=true;continue;}
  const key=argument.slice(0,at),value=argument.slice(at+1);
  if(at<0 || !values.has(key) || !value)throw new Error(`不支持的安装参数：${argument}`);
  args[key]=value;
}
try{await installNative({args});}catch(error){console.error(`安装未完成：${error.message}`);process.exitCode=1;}
