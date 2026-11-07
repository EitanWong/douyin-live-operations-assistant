import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {nativeMessage} from '../helpers/native-message.mjs';
import {nativeDataRequest} from '../../extension/local-data.js';
import {createPublicMediaWorkerClient} from '../../extension/public-media-worker-client.js';
import {createPublicMediaVisualAnalyzer} from '../../extension/public-media-visual.js';
import {createPublicMediaResearch} from '../../extension/public-media-research.js';
import {createMediaClient} from '../../src/services/media.js';
import {createKnowledgeCorpus} from '../../src/ai/knowledge-corpus.js';
import {createAutomaticKnowledge,createKnowledgeMemory} from '../../src/services/automatic-knowledge.js';
import {createWebKnowledge} from '../../src/services/web-knowledge.js';
import {AudienceMemory} from '../../src/ai/audience-memory.js';
import {mergeConfig} from '../../src/core/engine.js';
import {createPublicMediaProfileResolver} from '../../extension/public-media-profile.js';
import {checkResearchProfile} from '../../src/ai/research-profile.js';

function workerPort(database,analyzeVisual,noaudio){
 const child=spawn('python3',[fileURLToPath(new URL('../helpers/public-media-visual-worker.py',import.meta.url)),database,...(noaudio ? ['noaudio'] : [])]);
 const messages=new Set(),disconnects=new Set(),errors=[];let input=Buffer.alloc(0),frames=0,largestPacket=0;
 child.stderr.on('data',value=>errors.push(value));
 const port={onMessage:{addListener:fn=>messages.add(fn)},onDisconnect:{addListener:fn=>disconnects.add(fn)},disconnect:()=>child.stdin.end(),postMessage:value=>{const body=Buffer.from(JSON.stringify(value)),size=Buffer.alloc(4);size.writeUInt32LE(body.length);child.stdin.write(Buffer.concat([size,body]));}};
 child.stdout.on('data',chunk=>{input=Buffer.concat([input,chunk]);while(input.length>=4 && input.length>=input.readUInt32LE(0)+4){const size=input.readUInt32LE(0);largestPacket=Math.max(largestPacket,size);const value=JSON.parse(input.subarray(4,4+size));input=input.subarray(4+size);if(value.type==='public-media-visual')frames++;for(const fn of messages)fn(value);}});
 const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{clearTimeout(timer);for(const fn of disconnects)fn();code ? reject(Error(Buffer.concat(errors).toString())) : resolve();});});
 const client=createPublicMediaWorkerClient({connect:()=>port,analyzeVisual});
 return {client,done,get frames(){return frames;},get largestPacket(){return largestPacket;}};
}

for(const noaudio of [false,true])test(`${noaudio ? '无音轨' : '有音轨'}真实关键帧经原生封包→既有视觉客户端→SQLite→原文库→按人检索，重启去重和遗忘清除`,async()=>{
 const folder=await mkdtemp(join(tmpdir(),'media-visual-flow-')),database=join(folder,'archive.sqlite3'),values={},anchor='10';
 const config=mergeConfig({anchorId:anchor,ai:{enabled:true,pipeline:{mode:'local-multimodal'},edge:{enabled:true,audioEnabled:true},accountCollection:{enabled:true}}});
 const memory=new AudienceMemory({anchor});memory.observe({type:'chat',source:'socket',id:'identity',text:'背景颜色',user:{id:'2',secUid:'author-sec',name:'茶友'},receivedAt:Date.now()});
 values['live-assistant:live-memory:1:10']={anchor,audience:memory.snapshot()};
 const read=async key=>key==='live-assistant:live-memory:1:10' ? {anchor,audience:memory.snapshot()} : structuredClone(values[key]);
 const corpus=createKnowledgeCorpus({read,write:async(key,value)=>values[key]=structuredClone(value)});
 const knowledge=createAutomaticKnowledge({corpus,readConfig:async()=>config,readAudience:async()=>memory.snapshot()});
 const resolveProfile=createPublicMediaProfileResolver(read),checkProfile=input=>checkResearchProfile({...input,read});
 let modelCalls=0;
 const recognize=createMediaClient({getKey:()=>'',request:details=>{
  modelCalls++;const body=JSON.parse(details.data),image=body.messages[1].content.find(row=>row.type==='image_url').image_url.url;
  const pixels=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','image2pipe','-i','pipe:0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{input:Buffer.from(image.split(',')[1],'base64')});
  details.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:pixels[0]>pixels[2] ? '红色背景。' : '蓝色背景。'}}]})});return {abort(){}};
 }});
 const analyzer=createPublicMediaVisualAnalyzer({readConfig:async()=>config,resolveProfile,checkProfile,readVersion:(room,anchor)=>knowledge.handle(room,'version',{anchor}),recognize});
 const port=workerPort(database,analyzer,noaudio),transport=nativeDataRequest({runtime:{sendNativeMessage:(_host,message)=>nativeMessage(fileURLToPath(new URL('../../native/data_host.py',import.meta.url)),['--database',database],message)}});
 const bridge=createPublicMediaResearch({readConfig:async()=>config,resolveProfile,checkProfile,readPrivacy:async()=>memory.snapshot(),request:transport,knowledge,worker:port.client});
 const cache=createWebKnowledge({indexedDB:null});
 try{
  await bridge.collect({room:'1',anchor,records:[{kind:'work',id:'70',subject:'author-sec',url:'https://www.douyin.com/video/70',text:'背景颜色'}]});
  await port.done;await bridge.wake('1');
  assert.equal(port.frames,2);assert.equal(modelCalls,2);assert.ok(port.largestPacket<=65536);
  const rows=await knowledge.handle('1','list',{anchor});assert.equal(rows.length,noaudio ? 2 : 3);
  assert.equal(rows.filter(row=>row.title==='公开视频关键帧观察').length,2);
  if(noaudio)assert.ok(rows.every(row=>row.coverage.includes('无音轨') && JSON.parse(row.text).audio==='absent'));
  const retrieval=createKnowledgeMemory({cache,anchor:()=>anchor,transport:(action,input)=>knowledge.handle('1',action,input)});
  const matches=await retrieval.candidates('蓝色背景',config.ai.search,{subject:'uid:2'});
  assert.ok(matches.some(row=>row.results.some(source=>source.content.includes('蓝色背景'))));
  assert.equal((await retrieval.candidates('蓝色背景',config.ai.search,{subject:'uid:3'})).length,0);
  const sequence=values['live-assistant:knowledge:1:10'].sequence;await bridge.wake('1');assert.equal(values['live-assistant:knowledge:1:10'].sequence,sequence);
  memory.forget('uid:2');await bridge.wakeAll();assert.deepEqual(await knowledge.handle('1','list',{anchor}),[]);
 }finally{port.client.close();cache.close();await port.done.catch(()=>{});await rm(folder,{recursive:true,force:true});}
});
