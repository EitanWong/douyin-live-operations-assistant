import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {installNative,downloadVerified,extensionIdFromPreferences} from '../../scripts/lib/native-install.mjs';

test('安装器自动发现唯一已启用扩展，多个不同安装需明确选择',()=>{
  const record=id=>({extensions:{settings:{[id]:{state:1,manifest:{name:'抖音直播运营助手'}}}}});
  assert.equal(extensionIdFromPreferences([record('a'.repeat(32)),record('a'.repeat(32))]),'a'.repeat(32));
  assert.throws(()=>extensionIdFromPreferences([record('a'.repeat(32)),record('b'.repeat(32))]),/多个/);
  assert.throws(()=>extensionIdFromPreferences([]),/extension-id/);
});

test('下载按校验值提交，错误与中断不覆盖已有文件，也不留下半文件',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'native-download-')),path=join(folder,'model');
  try{
    await writeFile(path,'previous');
    const hash=createHash('sha256').update('model').digest('hex');
    await assert.rejects(downloadVerified('https://example.com/model',path,{sha256:hash,maxBytes:20,fetch:async()=>new Response('wrong')}),/校验/);
    assert.equal(await readFile(path,'utf8'),'previous');
    await downloadVerified('https://example.com/model',path,{sha256:hash,maxBytes:20,fetch:async()=>new Response('model')});
    assert.equal(await readFile(path,'utf8'),'model');
    await assert.rejects(downloadVerified('https://example.com/model',path,{sha256:hash,maxBytes:2,fetch:async()=>new Response('model')}),/大小/);
    assert.equal(await readFile(path,'utf8'),'model');
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('一条命令自动装运行时、FFmpeg和中文模型，自检成功后才注册可启动宿主',async()=>{
  const home=await mkdtemp(join(tmpdir(),'native-install-')),id='a'.repeat(32),calls=[];
  let healthy=true,models=0;
  const run=(file,args,options={})=>{
    calls.push([file,args]);
    if(args.some(value=>value.includes('imageio_ffmpeg')))return '/bundled/ffmpeg\n';
    if(args.includes('--self-test')){if(!healthy)throw Error('self-test failed');return JSON.stringify({ready:true,asr:{phase:'ready'}});}
    return '';
  };
  const options={home,platform:'darwin',args:{'--extension-id':id},run,log:()=>{},ensureUV:async()=>'/uv',
    ensureModel:async folder=>{models++;await mkdir(folder,{recursive:true});return folder;}};
  try{
    const first=await installNative(options);
    const manifest=JSON.parse(await readFile(first.manifest,'utf8'));
    assert.deepEqual(manifest.allowed_origins,[`chrome-extension://${id}/`]);
    assert.match(await readFile(manifest.path,'utf8'),/host\.py/);
    assert.equal(JSON.parse(await readFile(join(first.release,'runtime.json'),'utf8')).asrModelDir,first.model);
    assert.ok(calls.some(([,args])=>args.includes('venv') && args.includes('3.12')));
    assert.ok(calls.some(([,args])=>args.includes('imageio-ffmpeg==0.6.0')));
    assert.equal(models,1);
    assert.match(execFileSync('python3',[join(first.release,'public_media_worker.py'),'--help'],{encoding:'utf8'}),/--once/,'发布快照必须包含可独立导入的视频任务及归档依赖');
    const before=await readFile(first.manifest,'utf8');
    healthy=false;
    await assert.rejects(installNative(options),/self-test failed/);
    assert.equal(await readFile(first.manifest,'utf8'),before,'失败的更新不能覆盖可用注册');
    healthy=true;
    const again=await installNative(options);assert.equal(again.release,first.release);assert.equal(models,1);
  }finally{await rm(home,{recursive:true,force:true});}
});
