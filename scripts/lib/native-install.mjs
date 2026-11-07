import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,readFile,writeFile,readdir,copyFile,chmod,rename,rm,open} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve,isAbsolute,dirname} from 'node:path';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const HOST='com.douyin_live_assistant.perception';
const MODEL='sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17';
const MODEL_HASH='7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e';
const MODEL_FILES=['model.int8.onnx','tokens.txt','test_wavs/zh.wav'];
export const NATIVE_FILES=['host.py','local_asr.py','model_lease.py','public_media_worker.py','public_media_source.py','public_media_frames.py','media_process.py','public_media_session.py','public_media_jobs.py','data_location.py','data_store.py','data_models.py','knowledge_index.py','protocol.py','resolver.py','stream_source.py','diagnose.py','requirements.txt','requirements.lock.txt'];
const UV_HASHES={
  'aarch64-apple-darwin':'c021ce28988acbbfcb496e68cd9f2f6ba6401cc6d3292a5d25313873f825e002',
  'x86_64-apple-darwin':'10423293b0b11ed019551a0cd3e5d6d66e2799fab25dd2403e1d63cc883eb671',
  'aarch64-unknown-linux-gnu':'8dc203a27c99f721545adc531279f0486ea3deb77c951a051e6bb9ea1d588a71',
  'x86_64-unknown-linux-gnu':'950bad4899800ab158db97081b30a601a3ff4237d705756fda8695342cfcc20a',
};
const shellQuote=value=>`'${value.replaceAll("'","'\\''")}'`;
const runCommand=(file,args,options={})=>execFileSync(file,args,{encoding:'utf8',maxBuffer:4*1024*1024,...options});
const hashFile=async path=>{const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');};
const validHash=async(path,expected)=>{try{return await hashFile(path)===expected;}catch{return false;}};
export async function atomicJSON(path,value){const temporary=`${path}.${randomUUID()}.tmp`;try{await writeFile(temporary,JSON.stringify(value,null,2),{mode:0o600});await rename(temporary,path);}finally{await rm(temporary,{force:true});}}

export async function downloadVerified(url,path,{sha256,maxBytes,fetch:request=globalThis.fetch,onProgress=()=>{}}){
  const partial=`${path}.${randomUUID()}.part`;
  try{
    const response=await request(url,{signal:AbortSignal.timeout(600000)});
    if(!response.ok || !response.body)throw new Error('下载失败，请检查网络后重试');
    let size=0,last=0;const total=Number(response.headers.get('content-length')) || undefined,hash=createHash('sha256');
    const bound=new Transform({transform(chunk,encoding,callback){size+=chunk.length;if(size>maxBytes){callback(new Error('下载大小超过限制'));return;}hash.update(chunk);
      if(Date.now()-last>=500 || size===total){last=Date.now();Promise.resolve(onProgress({loaded:size,total})).then(()=>callback(null,chunk),callback);}else callback(null,chunk);}});
    await pipeline(Readable.fromWeb(response.body),bound,createWriteStream(partial,{flags:'wx',mode:0o600}));
    if(hash.digest('hex')!==sha256)throw new Error('下载校验失败，请重试');
    await rename(partial,path);
  }finally{await rm(partial,{force:true});}
}
async function cachedDownload(url,path,options){
  if(await validHash(path,options.sha256))return;
  for(let attempt=0;attempt<3;attempt++)try{await downloadVerified(url,path,options);return;}catch(error){if(attempt===2)throw error;}
}

export function extensionIdFromPreferences(records){
  const ids=new Set();
  for(const record of records)for(const [id,value] of Object.entries(record?.extensions?.settings || {})){
    if(/^[a-p]{32}$/u.test(id) && value.state!==0 && !value.disable_reasons?.length && value.manifest?.name==='抖音直播运营助手')ids.add(id);
  }
  if(ids.size>1)throw new Error('发现多个助手扩展，请用 --extension-id=扩展ID 明确选择');
  if(!ids.size)throw new Error('未发现已启用的助手扩展，请先加载扩展，或传入 --extension-id=扩展ID');
  return [...ids][0];
}
function browserDirectory(home,platform,browser='chrome'){
  const paths=platform==='darwin' ? {chrome:'Library/Application Support/Google/Chrome',chromium:'Library/Application Support/Chromium',edge:'Library/Application Support/Microsoft Edge'} : {chrome:'.config/google-chrome',chromium:'.config/chromium',edge:'.config/microsoft-edge'};
  if(!paths[browser])throw new Error('--browser 仅支持 chrome、chromium、edge');
  return join(home,paths[browser]);
}
export async function discoverExtension(directory){
  const records=[];
  for(const profile of await readdir(directory).catch(()=>[])){
    if(profile!=='Default' && !/^Profile \d+$/u.test(profile))continue;
    for(const name of ['Preferences','Secure Preferences'])try{records.push(JSON.parse(await readFile(join(directory,profile,name),'utf8')));}catch{}
  }
  return extensionIdFromPreferences(records);
}
export function nativePaths({home=homedir(),platform=process.platform,args={}}={}){
  if(!['darwin','linux'].includes(platform))throw new Error('自动注册目前支持 macOS / Linux；Windows 原生注册暂不支持');
  return {folder:join(home,'.local/share/douyin-live-assistant/native'),browser:browserDirectory(home,platform,args['--browser'])};
}
async function ensureUV(folder,{platform,arch,run,progress}){
  try{run('uv',['--version']);return 'uv';}catch{}
  const target=`${({arm64:'aarch64',x64:'x86_64'})[arch]}-${platform==='darwin' ? 'apple-darwin' : 'unknown-linux-gnu'}`;
  const sha256=UV_HASHES[target];if(!sha256)throw new Error('自动运行时支持 macOS/Linux 的 x64、arm64；请安装 uv 后重试');
  const directory=join(folder,'uv-0.9.8'),binary=join(directory,'uv');
  await mkdir(directory,{recursive:true});
  const archive=join(directory,'uv.tar.gz');
  await cachedDownload(`https://github.com/astral-sh/uv/releases/download/0.9.8/uv-${target}.tar.gz`,archive,{sha256,maxBytes:30000000,onProgress:value=>progress({stage:'runtime-download',...value})});
  run('tar',['-xzf',archive,'--strip-components=1','-C',directory,`uv-${target}/uv`]);
  await chmod(binary,0o700);return binary;
}
async function ensureModel(folder,{run,log,progress}){
  const target=join(folder,MODEL);
  try{
    const verified=JSON.parse(await readFile(join(target,'verified.json'),'utf8'));
    if(verified.archive===MODEL_HASH && (await Promise.all(MODEL_FILES.map(name=>validHash(join(target,name),verified.files[name])))).every(Boolean))return target;
  }catch{}
  log('下载并校验 SenseVoice int8 中文模型（约 163MB），网络失败可重跑同一命令…');
  await mkdir(folder,{recursive:true});
  const archive=join(folder,`${MODEL}.tar.bz2`),staging=join(folder,`.model-${randomUUID()}`);
  await cachedDownload(`https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL}.tar.bz2`,archive,{sha256:MODEL_HASH,maxBytes:164000000,onProgress:value=>progress({stage:'model-download',...value})});
  await progress({stage:'model-verify'});
  await mkdir(staging,{recursive:true});
  try{
    run('tar',['-xjf',archive,'-C',staging,...MODEL_FILES.map(name=>`${MODEL}/${name}`)]);
    const extracted=join(staging,MODEL),files={};
    for(const name of MODEL_FILES)files[name]=await hashFile(join(extracted,name));
    await atomicJSON(join(extracted,'verified.json'),{archive:MODEL_HASH,files});
    // Do not overwrite files mapped by a running host.
    try{await rename(target,`${target}.invalid-${randomUUID()}`);}catch(error){if(error.code!=='ENOENT')throw error;}
    await rename(extracted,target);return target;
  }finally{await rm(staging,{recursive:true,force:true});}
}
export async function installationLock(folder,name='install.lock'){
  const path=join(folder,name);
  for(let attempt=0;attempt<2;attempt++){
    try{const handle=await open(path,'wx',0o600);await handle.writeFile(String(process.pid));await handle.close();return ()=>rm(path,{force:true});}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const pid=Number(await readFile(path,'utf8'));
      if(!Number.isInteger(pid) || pid<1)throw new Error('安装锁不完整，请确认没有安装进程后删除 install.lock 再重试');
      try{process.kill(pid,0);throw new Error('另一个安装任务正在运行，请等待完成');}catch(active){if(active.code!=='ESRCH')throw active;}
      await rm(path,{force:true});
    }
  }
  throw new Error('无法取得安装锁');
}

async function registerHost(manifest,release,id){
  await mkdir(resolve(manifest,'..'),{recursive:true});
  await atomicJSON(manifest,{name:HOST,description:'Douyin native stream perception and local ASR',path:join(release,'launch'),type:'stdio',allowed_origins:[`chrome-extension://${id}/`]});
}
function checkRelease(release,run){
  const report=JSON.parse(run(join(release,'.venv/bin/python'),[join(release,'diagnose.py'),'--self-test'],{timeout:120000}));
  if(!report.ready)throw new Error('本地组件自检失败，保留之前的注册');
  return report;
}

export async function installNative({args={},home=homedir(),platform=process.platform,arch=process.arch,root=ROOT,run=runCommand,log=console.log,progress=async()=>{},ensureUV:prepareUV=ensureUV,ensureModel:prepareModel=ensureModel}={}){
  const {folder,browser}=nativePaths({home,platform,args});
  const manifest=join(browser,'NativeMessagingHosts',`${HOST}.json`);
  await mkdir(folder,{recursive:true,mode:0o700});
  const unlock=await installationLock(folder);
  try{
    if(args['--uninstall']){await rm(manifest,{force:true});log('已移除此浏览器的本地感知注册；运行时与模型缓存保留。');return {manifest};}
    if(args['--doctor']){
      const registered=JSON.parse(await readFile(manifest,'utf8')),release=resolve(registered.path,'..');
      const report=checkRelease(release,run);
      log(JSON.stringify(report,null,2));return {manifest,release,report};
    }
    const id=args['--extension-id'] || await discoverExtension(browser);
    if(!/^[a-p]{32}$/u.test(id))throw new Error('扩展ID必须是32位 a-p 字母');
    if(args['--asr-model-dir'] && !isAbsolute(args['--asr-model-dir']))throw new Error('--asr-model-dir 必须使用绝对路径');
    const inputs=await Promise.all(NATIVE_FILES.map(name=>hashFile(join(root,'native',name))));
    inputs.push(await hashFile(fileURLToPath(import.meta.url)));
    const key=createHash('sha256').update(JSON.stringify([inputs,platform,arch,args['--python'],args['--ffmpeg'],args['--asr-model-dir'],Boolean(args['--without-asr']),MODEL_HASH,'imageio-ffmpeg==0.6.0','sherpa-onnx==2.0.1','numpy==2.4.4'])).digest('hex');
    for(const name of await readdir(join(folder,'releases')).catch(()=>[])){
      const release=join(folder,'releases',name);let deployment;
      try{deployment=JSON.parse(await readFile(join(release,'deployment.json'),'utf8'));}catch{continue;}
      if(deployment.key!==key)continue;
      await progress({stage:'self-test'});
      const report=checkRelease(release,run);await registerHost(manifest,release,id);
      await progress({stage:'ready'});
      log('已复用安装并通过推理自检，无需重复下载或配置。');
      return {manifest,release,model:deployment.model,report};
    }
    log('准备独立 Python 运行时、直播解析、FFmpeg 与本地中文识别…');
    await progress({stage:'runtime'});const uv=await prepareUV(folder,{platform,arch,run,progress});
    const release=join(folder,'releases',randomUUID());
    await mkdir(release,{recursive:true,mode:0o700});
    try{
      await progress({stage:'python'});run(uv,['venv','--python',args['--python'] || '3.12',join(release,'.venv')],{stdio:'inherit',timeout:600000});
      const runtime=join(release,'.venv/bin/python');
      await progress({stage:'dependencies'});
      run(uv,['pip','install','--python',runtime,'-r',join(root,'native/requirements.lock.txt'),'imageio-ffmpeg==0.6.0',...(!args['--without-asr'] ? ['sherpa-onnx==2.0.1','numpy==2.4.4'] : [])],{stdio:'inherit',timeout:600000});
      const ffmpeg=args['--ffmpeg'] ? run(runtime,['-c','import shutil,sys; p=shutil.which(sys.argv[1]); assert p, "FFmpeg 不存在"; print(p)',args['--ffmpeg']]).trim() : run(runtime,['-c','import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())']).trim();
      await progress({stage:'model'});const model=args['--without-asr'] ? null : args['--asr-model-dir'] || await prepareModel(join(folder,'models'),{run,log,progress});
      for(const name of NATIVE_FILES)await copyFile(join(root,'native',name),join(release,name));
      await atomicJSON(join(release,'runtime.json'),{ffmpeg,...(model ? {asrModelDir:model} : {})});
      log('检查依赖、真实解码器与中文模型预热/推理…');
      await progress({stage:'self-test'});
      const report=checkRelease(release,run);
      if(!report.ready || model && !['ready','slow'].includes(report.asr?.phase))throw new Error('本地组件自检失败，保留之前的注册');
      const launcher=join(release,'launch');
      await writeFile(launcher,`#!/bin/sh\nPATH=${shellQuote(dirname(process.execPath))}:"$PATH"\nexport PATH\nexec ${shellQuote(runtime)} ${shellQuote(join(release,'host.py'))} "$@"\n`,{mode:0o700});
      await atomicJSON(join(release,'deployment.json'),{key,model});
      await progress({stage:'register'});
      await registerHost(manifest,release,id);
      await progress({stage:'ready'});
      log(`安装完成，扩展按需启动，无需常驻终端。扩展 ID：${id}\n中文语音：${report.asr?.phase || '未安装'}${report.asr?.phase==='slow' ? '（此设备测速不足，自动模式将尝试浏览器方案）' : ''}\n检查命令：npm run native:doctor${args['--browser'] ? ` -- --browser=${args['--browser']}` : ''}`);
      return {manifest,release,model,report};
    }catch(error){await rm(release,{recursive:true,force:true});throw error;}
  }finally{await unlock();}
}
