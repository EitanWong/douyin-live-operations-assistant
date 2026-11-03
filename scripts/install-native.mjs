import {execFileSync} from 'node:child_process';
import {mkdir,copyFile,writeFile,chmod,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const args=Object.fromEntries(process.argv.slice(2).map(value=>{const index=value.indexOf('=');return [value.slice(0,index),value.slice(index+1)];}));
const id=args['--extension-id'];
if(!['darwin','linux'].includes(process.platform))throw new Error('当前自动安装器支持 macOS / Linux。Windows 请使用 WSL 之外的原生宿主安装方案，暂不支持自动注册。');
const folder=join(homedir(),'.local','share','douyin-live-assistant','native');
const manifests=process.platform==='darwin' ? join(homedir(),'Library','Application Support','Google','Chrome','NativeMessagingHosts') : join(homedir(),'.config','google-chrome','NativeMessagingHosts');
const manifest=join(manifests,'com.douyin_live_assistant.perception.json');
if(process.argv.includes('--uninstall')){await rm(manifest,{force:true});await rm(folder,{recursive:true,force:true});console.log('本地感知组件已卸载。');process.exit(0);}
if(!/^[a-p]{32}$/u.test(id || ''))throw new Error('请传入 chrome://extensions 中的扩展 ID：npm run native:install -- --extension-id=扩展ID');
const python=args['--python'] || 'python3';
execFileSync(python,['-c','import sys; assert sys.version_info >= (3,11), "需要 Python 3.11 或更高版本"'],{stdio:'inherit'});
const ffmpeg=execFileSync(python,['-c','import shutil,sys; p=shutil.which(sys.argv[1]); assert p, "请先安装 FFmpeg"; print(p)',args['--ffmpeg'] || 'ffmpeg'],{encoding:'utf8'}).trim();
await mkdir(folder,{recursive:true,mode:0o700});
execFileSync(python,['-m','venv',join(folder,'.venv')],{stdio:'inherit'});
const runtime=join(folder,'.venv','bin','python');
execFileSync(runtime,['-m','pip','install','--disable-pip-version-check','-r',join(root,'native','requirements.lock.txt')],{stdio:'inherit'});
for(const name of ['host.py','local_asr.py','protocol.py','resolver.py','requirements.txt','requirements.lock.txt'])await copyFile(join(root,'native',name),join(folder,name));
const asrModelDir=args['--asr-model-dir'];
if(asrModelDir)execFileSync(runtime,['-m','pip','install','--disable-pip-version-check','sherpa-onnx==2.0.1','numpy==2.4.4'],{stdio:'inherit'});
await writeFile(join(folder,'runtime.json'),JSON.stringify({ffmpeg,...(asrModelDir ? {asrModelDir} : {})}),{mode:0o600});
const shellQuote=value=>`'${value.replaceAll("'","'\\''")}'`;
const launcher=join(folder,'launch');await writeFile(launcher,`#!/bin/sh\nexec ${shellQuote(runtime)} ${shellQuote(join(folder,'host.py'))} "$@"\n`,{mode:0o700});await chmod(launcher,0o700);
await mkdir(manifests,{recursive:true});
await writeFile(manifest,JSON.stringify({name:'com.douyin_live_assistant.perception',description:'Douyin native stream perception',path:launcher,type:'stdio',allowed_origins:[`chrome-extension://${id}/`]},null,2),{mode:0o600});
// Import/decoder checks contain no live stream or model requests.
execFileSync(runtime,['-c','import streamget; from websockets.asyncio.client import connect'],{stdio:'inherit'});
console.log(`本地感知组件已注册到 Chrome。扩展 ID：${id}\n在 AI 设置选择“本地原生拉流”及 Omni 实时组合后启动。\n组件位置：${folder}`);
