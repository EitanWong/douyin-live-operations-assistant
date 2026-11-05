import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,copyFile,writeFile,open,access,rename,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {atomicJSON,installationLock,nativePaths,discoverExtension,NATIVE_FILES} from './native-install.mjs';

export const SETUP_HOST='com.douyin_live_assistant.setup';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const alive=pid=>{if(!Number.isInteger(pid) || pid<1)return false;try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}};
export async function registeredNativeDeployment(options={}){
 const {folder,browser}=nativePaths(options),manifest=join(browser,'NativeMessagingHosts',`${SETUP_HOST}.json`);
 const registration=JSON.parse(await readFile(manifest,'utf8'));
 const config=JSON.parse(await readFile(join(dirname(registration.path),'deployment-config.json'),'utf8'));
 return {manifest,deployment:createNativeDeployment({folder,config})};
}
async function launchWorker(config,id,folder){
 const output=await open(join(folder,'installation.log'),'a',0o600);
 try{
  const child=spawn(process.execPath,[join(config.root,'scripts/native-deployment-worker.mjs'),join(config.root,'deployment-config.json'),id],{detached:true,stdio:['ignore',output.fd,output.fd],cwd:config.root});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();return child.pid;
 }finally{await output.close();}
}
export function createNativeDeployment({folder,config,launch=launchWorker,isAlive=alive}){
 const browser=config.args?.['--browser'] || 'chrome',path=join(folder,`deployment-${browser}.json`);
 const key=createHash('sha256').update(JSON.stringify(config)).digest('hex');
 const read=async()=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return {phase:'unprepared'};throw error;}};
 async function status({resume=false}={}){
  const state=await read();
  if(['queued','running'].includes(state.phase) && !isAlive(state.pid) && !(state.phase==='queued' && !state.pid && Date.now()-state.updatedAt<10000)){
   if(resume && state.attempt<3)return start(true);
   return {...state,phase:'interrupted',progress:{stage:'interrupted'}};
  }
  return state;
 }
 async function start(recovering=false){
  await mkdir(folder,{recursive:true,mode:0o700});let unlock;
  for(let attempt=0;attempt<50;attempt++){
   try{unlock=await installationLock(folder,`start-${browser}.lock`);break;}
   catch(error){if(attempt===49)throw error;await new Promise(resolve=>setTimeout(resolve,20));const existing=await status();if(['queued','running'].includes(existing.phase))return existing;}
  }
  try{
   const previous=await status();
   if(['queued','running'].includes(previous.phase) || previous.phase==='ready' && previous.key===key)return previous;
   const state={id:randomUUID(),key,phase:'queued',attempt:recovering ? previous.attempt+1 : 1,updatedAt:Date.now(),progress:{stage:recovering ? 'restoring' : 'queued'}};
   await atomicJSON(path,state);
   try{state.pid=await launch(config,state.id,folder);await atomicJSON(path,state);return state;}
   catch(error){await atomicJSON(path,{...state,phase:'error',error:'安装进程启动失败，请重试'});throw error;}
  }finally{await unlock();}
 }
 async function run(id,install){
  let state=await read();if(state.id!==id)return;
  // Parent commits the detached PID before allowing this process to write progress.
  for(let n=0;!state.pid && n<100;n++){await new Promise(resolve=>setTimeout(resolve,25));state=await read();if(state.id!==id)return;}
  if(!state.pid)throw new Error('安装进程交接失败');
  const progress=async value=>{const latest=await read();if(latest.id!==id)return;state={...latest,phase:'running',progress:value,updatedAt:Date.now()};await atomicJSON(path,state);};
  try{await progress({stage:'starting'});await install({progress});if((await read()).id===id)await atomicJSON(path,{...state,phase:'ready',progress:{stage:'ready'},updatedAt:Date.now()});}
  catch{if((await read()).id===id)await atomicJSON(path,{...state,phase:'error',error:'安装失败，请检查网络与磁盘后重试；已完成的缓存会复用',progress:{stage:'error'},updatedAt:Date.now()});}
 }
 return {start,status,run,path};
}
export async function bootstrapNativeDeployment({args={},home=homedir(),platform=process.platform,arch=process.arch,root=ROOT,launch,isAlive,log=console.log}={}){
 const {folder,browser}=nativePaths({home,platform,args}),id=args['--extension-id'] || await discoverExtension(browser);
 if(!/^[a-p]{32}$/u.test(id))throw new Error('扩展ID必须是32位 a-p 字母');
 const resolvedArgs={...args,'--extension-id':id};
 const files=[...NATIVE_FILES.map(name=>`native/${name}`),'scripts/native-deployment-host.mjs','scripts/native-deployment-worker.mjs','scripts/lib/native-deployment.mjs','scripts/lib/native-install.mjs'];
 const hash=createHash('sha256').update(JSON.stringify([resolvedArgs,home,platform,arch]));
 for(const name of files)hash.update(await readFile(join(root,name)));
 const snapshot=join(folder,'agents',hash.digest('hex'));
 const config={args:resolvedArgs,home,platform,arch,root:snapshot};
 const quote=value=>`'${value.replaceAll("'","'\\''")}'`,launcher=join(snapshot,'launch');
 try{await access(join(snapshot,'deployment-config.json'));}catch{
  const staging=`${snapshot}.${randomUUID()}.tmp`;await mkdir(staging,{recursive:true,mode:0o700});
  try{
   for(const name of files){const target=join(staging,name);await mkdir(dirname(target),{recursive:true});await copyFile(join(root,name),target);}
   await atomicJSON(join(staging,'deployment-config.json'),config);
   await writeFile(join(staging,'launch'),`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(snapshot,'scripts/native-deployment-host.mjs'))} ${quote(join(snapshot,'deployment-config.json'))} "$@"\n`,{mode:0o700});
   try{await rename(staging,snapshot);}catch(error){if(!['EEXIST','ENOTEMPTY'].includes(error.code))throw error;}
  }finally{await rm(staging,{recursive:true,force:true});}
 }
 const manifest=join(browser,'NativeMessagingHosts',`${SETUP_HOST}.json`);await mkdir(dirname(manifest),{recursive:true});
 await atomicJSON(manifest,{name:SETUP_HOST,description:'Resumable local AI installation',type:'stdio',path:launcher,allowed_origins:[`chrome-extension://${id}/`]});
 const deployment=createNativeDeployment({folder,config,launch,isAlive}),state=await deployment.start();
 log('安装任务已转入独立后台进程，可关闭终端。在“AI 设置 → 本地与性能”查看进度，刷新网页或重载扩展不会中断安装。');
 return {manifest,state,config};
}
