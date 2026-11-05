import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createNativeDeployment,bootstrapNativeDeployment} from '../../scripts/lib/native-deployment.mjs';

test('原生安装先落盘再分离进程；刷新和新宿主复用在途任务，进度可恢复读取',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'native-deploy-'));let launches=0;
 const options={folder,config:{args:{'--browser':'chrome'},root:'/snapshot'},isAlive:pid=>pid===777,
  launch:async()=>{launches++;return 777;}};
 try{
  const first=createNativeDeployment(options),a=await first.start();
  assert.equal(a.phase,'queued');assert.equal(a.pid,777);
  const second=createNativeDeployment(options),b=await second.start();assert.equal(a.id,b.id);assert.equal(launches,1);
  await first.run(a.id,async({progress})=>{await progress({stage:'model',loaded:40,total:100});const status=await second.status();assert.equal(status.progress.loaded,40);return {ready:true};});
  assert.equal((await second.status()).phase,'ready');assert.equal((await second.start()).id,a.id);assert.equal(launches,1);
 }finally{await rm(folder,{recursive:true,force:true});}
});
test('两个宿主同时启动只创建一个独立安装进程',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'native-concurrent-'));let launches=0;
 const options={folder,config:{args:{}},isAlive:p=>p===777,launch:async()=>{launches++;return 777;}};
 try{const results=await Promise.allSettled([createNativeDeployment(options).start(),createNativeDeployment(options).start()]);for(const result of results)assert.equal(result.status,'fulfilled',String(result.reason));const [a,b]=results.map(r=>r.value);assert.equal(a.id,b.id);assert.equal(launches,1);}
 finally{await rm(folder,{recursive:true,force:true});}
});
test('安装进程中断可自动恢复，保留失败原因供重试；旧任务回写不能覆盖后来的任务',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'native-deploy-'));let pid=777;
 const options={folder,config:{args:{}},isAlive:p=>p===pid,launch:async()=>pid};
 try{
  const manager=createNativeDeployment(options),a=await manager.start();pid=888;
  const resumed=await manager.status({resume:true});assert.notEqual(resumed.id,a.id);assert.equal(resumed.attempt,2);
  await manager.run(a.id,async()=>{throw Error('old failure');});assert.equal((await manager.status()).id,resumed.id);
  await manager.run(resumed.id,async()=>{throw Error('network failed');});
  assert.equal((await manager.status()).phase,'error');assert.match((await manager.status()).error,/安装失败/);
 }finally{await rm(folder,{recursive:true,force:true});}
});
test('首次入口注册轻量安装代理后立即返回，扩展只需查询进度，不依赖终端常驻',async()=>{
 const home=await mkdtemp(join(tmpdir(),'native-bootstrap-'));let launched=0;
 try{
  const result=await bootstrapNativeDeployment({home,platform:'darwin',args:{'--extension-id':'a'.repeat(32)},launch:async()=>{launched++;return 777;},isAlive:p=>p===777,log:()=>{}});
  const manifest=JSON.parse(await readFile(result.manifest,'utf8'));assert.equal(manifest.name,'com.douyin_live_assistant.setup');
  assert.deepEqual(manifest.allowed_origins,[`chrome-extension://${'a'.repeat(32)}/`]);assert.equal(launched,1);
  assert.match(await readFile(manifest.path,'utf8'),/native-deployment-host/);assert.equal(result.state.phase,'queued');
 }finally{await rm(home,{recursive:true,force:true});}
});
test('真实安装代理使用Native Messaging帧读回持久任务，拒绝其他扩展来源',async()=>{
 const home=await mkdtemp(join(tmpdir(),'native-setup-framing-')),id='a'.repeat(32);
 try{
  const result=await bootstrapNativeDeployment({home,platform:'darwin',args:{'--extension-id':id},launch:async()=>process.pid,log:()=>{}});
  const input=Buffer.from(JSON.stringify({action:'status'})),header=Buffer.alloc(4);header.writeUInt32LE(input.length);
  const args=[join(result.config.root,'scripts/native-deployment-host.mjs'),join(result.config.root,'deployment-config.json'),`chrome-extension://${id}/`];
  const output=execFileSync(process.execPath,args,{input:Buffer.concat([header,input]),timeout:5000});
  const response=JSON.parse(output.subarray(4));assert.equal(output.readUInt32LE(),output.length-4);assert.equal(response.value.id,result.state.id);assert.equal(response.value.phase,'queued');
  assert.throws(()=>execFileSync(process.execPath,[...args.slice(0,-1),`chrome-extension://${'b'.repeat(32)}/`],{input:Buffer.concat([header,input]),timeout:5000}));
 }finally{await rm(home,{recursive:true,force:true});}
});
test('自动发现的扩展ID更换后生成新代理快照，不复用旧来源配置',async()=>{
 const home=await mkdtemp(join(tmpdir(),'native-discovery-')),profile=join(home,'Library/Application Support/Google/Chrome/Default');
 const options={home,platform:'darwin',launch:async()=>process.pid,log:()=>{}};
 const preference=id=>JSON.stringify({extensions:{settings:{[id]:{state:1,manifest:{name:'抖音直播运营助手'}}}}});
 try{
  await mkdir(profile,{recursive:true});await writeFile(join(profile,'Preferences'),preference('a'.repeat(32)));
  const first=await bootstrapNativeDeployment(options);
  await createNativeDeployment({folder:join(home,'.local/share/douyin-live-assistant/native'),config:first.config}).run(first.state.id,async()=>{});
  await writeFile(join(profile,'Preferences'),preference('b'.repeat(32)));
  const next=await bootstrapNativeDeployment(options),installed=JSON.parse(await readFile(join(next.config.root,'deployment-config.json'),'utf8'));
  assert.equal(installed.args['--extension-id'],'b'.repeat(32));assert.notEqual(next.config.root,first.config.root);
 }finally{await rm(home,{recursive:true,force:true});}
});
