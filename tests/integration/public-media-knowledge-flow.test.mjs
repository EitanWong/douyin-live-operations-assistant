import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {nativeMessage} from '../helpers/native-message.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AudienceMemory} from '../../src/ai/audience-memory.js';
import {createKnowledgeCorpus} from '../../src/ai/knowledge-corpus.js';
import {createAutomaticKnowledge,createKnowledgeMemory} from '../../src/services/automatic-knowledge.js';
import {createWebKnowledge} from '../../src/services/web-knowledge.js';
import {createAIClient} from '../../src/services/ai.js';
import {sourcePassages} from '../../src/ai/source-evidence.js';
import {mergeConfig} from '../../src/core/engine.js';
import {createPublicMediaResearch} from '../../extension/public-media-research.js';
import {createPublicMediaProfileResolver} from '../../extension/public-media-profile.js';
import {checkResearchProfile} from '../../src/ai/research-profile.js';
import {nativeDataRequest} from '../../extension/local-data.js';
import {capturePublicWorkSample} from '../../extension/account-media.js';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';

const nativeHost=fileURLToPath(new URL('../../native/data_host.py',import.meta.url));
const pageObserver=(await build({entryPoints:['extension/account-page.js'],bundle:true,write:false,format:'iife'})).outputFiles[0].text;
function nativeTransport(database){return nativeDataRequest({runtime:{sendNativeMessage:(_host,message)=>nativeMessage(nativeHost,['--database',database],message)}});}

for(const subject of ['uid:2','uid:10'])test(`${subject} 浏览器稳定身份→真实原生封包/SQLite/FFmpeg→原文库→前台按人引用，重启与遗忘不复活`,async()=>{
 const folder=await mkdtemp(join(tmpdir(),'public-media-flow-')),database=join(folder,'archive.sqlite3'),transport=nativeTransport(database),anchor='10';let interruptAck=true;
 const request=(action,input)=>{if(input.operation==='ack' && interruptAck){interruptAck=false;throw Error('fixture interruption before ack');}return transport(action,input);};
 const config=mergeConfig({anchorId:anchor,ai:{enabled:true,endpoint:'https://model.test/chat/completions',model:'fixture',pipeline:{mode:'local-audio'},edge:{enabled:true,audioEnabled:true},accountCollection:{enabled:true}}});
 const memory=new AudienceMemory({anchor});if(subject==='uid:2')memory.observe({type:'chat',source:'socket',id:'profile',text:'陶瓷茶杯怎么清洗',user:{id:'2',secUid:'author-sec',name:'茶友'},receivedAt:Date.now()});
 const values={'live-assistant:profile:1':{room:'1',anchorId:anchor,secUid:subject==='uid:10' ? 'author-sec' : 'anchor-sec',updatedAt:Date.now()}};const read=async key=>key==='live-assistant:live-memory:1:10'?{anchor,audience:memory.snapshot()}:structuredClone(values[key]);
 const corpus=createKnowledgeCorpus({read,write:async(key,value)=>values[key]=structuredClone(value)}),knowledge=createAutomaticKnowledge({corpus,readConfig:async()=>config,readAudience:async()=>memory.snapshot(),readProfile:()=>read('live-assistant:profile:1')});
 const options={readConfig:async()=>config,resolveProfile:createPublicMediaProfileResolver(read),checkProfile:input=>checkResearchProfile({...input,read}),request,knowledge,readPrivacy:async()=>memory.snapshot(),
  worker:{ready:async()=>true,run:async()=>{execFileSync('python3',[fileURLToPath(new URL('../helpers/public-media-worker.py',import.meta.url)),database]);return true;}}};
 const bridge=createPublicMediaResearch(options),cache=createWebKnowledge({indexedDB:null});
 try{
  const mediaURL=subject==='uid:2' ? 'https://v1.example.douyinvod.com/file?cquery=original&l=trace' : 'https://v1.example.douyinvod.com/file?__vid=70';
  const page=new JSDOM('<body></body>',{url:'https://www.douyin.com/video/70',runScripts:'outside-only'}).window;let records,media;
  try{
   page.fetch=async()=>new Response('{}');page.eval(pageObserver);
   page.__INITIAL_STATE__={aweme_detail:{aweme_id:'70',desc:'茶杯清洗',author:{uid:subject.slice(4),sec_uid:'author-sec',nickname:'茶友'},video:{duration:8000,play_addr:{url_list:[mediaURL]}}}};
   records=page.__liveAssistantPublicAccountV1.snapshot();
   const sample=await page.eval(`(${capturePublicWorkSample.toString()})`)({audio:false,video:false,workId:'70'});
   assert.equal(sample.mediaSource?.url,mediaURL,'没有播放器时仍交接同作品详情的未改写来源');media=[sample.mediaSource];
  }finally{page.close();}
  await bridge.collect({room:'1',anchor,records,media});
  await assert.rejects(bridge.wake('1'),/interruption/);
  assert.equal((await knowledge.handle('1','list',{anchor})).length,2,'入库之后、确认之前中断仍保留已提交原文');
  await createPublicMediaResearch(options).wake('1');
  const rows=await knowledge.handle('1','list',{anchor});assert.equal(rows.length,2);assert.equal(rows[0].subject,subject);assert.equal(rows[0].evidenceKind,'public-media');assert.match(rows[0].coverage,/说话人未确认/);
  assert.equal(JSON.stringify(values).includes('douyinvod'),false,'临时播放源不能进入浏览器原文库');
  const sequence=values['live-assistant:knowledge:1:10'].sequence;await createPublicMediaResearch(options).wake('1');assert.equal(values['live-assistant:knowledge:1:10'].sequence,sequence);
  const retrieval=createKnowledgeMemory({cache,anchor:()=>anchor,transport:(action,input)=>knowledge.handle('1',action,input)});
  let calls=0;const client=createAIClient({knowledge:retrieval,getKey:()=> 'test',request:details=>{calls++;const input=JSON.parse(JSON.parse(details.data).messages[1].content),candidate=input.knowledge_candidates.find(row=>row.results.some(source=>source.content.includes('冷水')));assert.ok(candidate);for(const p of sourcePassages(candidate.results[0]))assert.match(p.coverage,/说话人未确认/);details.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:JSON.stringify({intent:'knowledge',query:candidate.id,reply:'视频音轨提到冷水清洗，语音说话人未确认。',sources:[1]})}}]})});}});
  const profile=await options.resolveProfile({room:'1',anchor,subject,author:'author-sec',ai:config.ai});
  assert.match(await client({task:{kind:'ai'},target:{text:'陶瓷茶杯如何清洗',memory:{key:subject==='uid:10' ? 'uid:3' : profile.binding.subject,epoch:profile.epoch,profile:profile.profile}},maxLength:100},config.ai),/冷水/);assert.equal(calls,1);
  assert.equal((await retrieval.candidates('陶瓷茶杯清洗',config.ai.search,{subject:'uid:3'})).length,subject==='uid:10' ? 1 : 0);
  memory.forget(subject);await bridge.wakeAll();
  assert.deepEqual(await knowledge.handle('1','list',{anchor}),[]);
  const [job]=await request('public-media',{operation:'list',room:'1',anchor});assert.equal(job.status,'cancelled');
  assert.deepEqual(await request('public-media',{operation:'evidence',room:'1',anchor,job:job.id}),[]);
 }finally{cache.close();await rm(folder,{recursive:true,force:true});}
});
