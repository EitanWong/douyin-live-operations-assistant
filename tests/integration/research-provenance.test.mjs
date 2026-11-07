import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {createResearchGraph} from '../../src/ai/research-graph.js';
import {compactResearchState,RESEARCH_CONTEXT_LIMITS} from '../../src/ai/research-context.js';
import {createKnowledgeCorpus,corpusKey} from '../../src/ai/knowledge-corpus.js';
import {createAgentTaskStore} from '../../src/ai/task-store.js';
import {retrieveSourceRecords} from '../../src/services/automatic-knowledge.js';

const now=1800000000000,url='https://example.org/video';
const audio={url,title:'音轨',text:'整个夏天的歌词由未知说话人唱出。',at:now-2000,expiresAt:now+60000,evidenceKind:'public-media',coverage:'完整音轨0–4000ms；机器转录待核实，说话人未知'};
const visual={url,title:'画面',text:'贝雷帽出现在单张关键帧，无法确认人物身份。',at:now-1000,expiresAt:now+120000,evidenceKind:'public-media',coverage:'单帧9400ms；非连续视频；不证明心理、身份或帧外事件'};
function storage(){
 const values={},archives=[];let fail=false;
 const options={read:async k=>values[k],write:async(k,v)=>{values[k]=structuredClone(v);},archive:async row=>{if(fail)throw Error('归档未确认');archives.push(structuredClone(row));},now:()=>now};
 return {values,archives,options,setFail:value=>{fail=value;}};
}
const complete=()=>JSON.stringify({action:'finish',answer:'音轨与画面均待核实。',citations:[1]});
async function merged(sources=[audio,visual]){
 let calls=0;
 return createResearchGraph({tier:'deep',knowledge:async query=>[sources[Number(query)]],plan:async()=>++calls<=sources.length ? JSON.stringify({action:'knowledge',query:String(calls-1)}) : complete()}).run({id:'merge'});
}
function assertDisclosed(view,source){
 assert.ok(JSON.stringify(view).length<=RESEARCH_CONTEXT_LIMITS.workingChars);assert.ok(view.evidence.length<=RESEARCH_CONTEXT_LIMITS.passages);
 for(const row of view.evidence){
  const passage=source.passages.find(p=>p.start<=row.start && p.end>=row.end);assert.ok(passage,'窗口不能跨过证据边界');
  assert.equal(row.content,source.content.slice(row.start,row.end));assert.equal(row.coverage,passage.coverage);assert.equal(row.evidenceKind,passage.evidenceKind);
 }
}

test('真实检索两次knowledge的同URL音画证据，跨IndexedDB重启保留独立范围且回存不复制原知识',async()=>{
 const saved=storage(),corpus=createKnowledgeCorpus(saved.options);
 await corpus.remember('1','2',[audio,visual],{subject:'uid:2'});
 const original=await corpus.list('1','2'),sequence=saved.values[corpusKey('1','2')].sequence;
 const options={indexedDB:new IDBFactory(),IDBKeyRange},first=createAgentTaskStore(options);let tools=0;
 const deps={question:'整个夏天和贝雷帽',knowledge:async query=>{tools++;return retrieveSourceRecords(original,query,now,{anchor:'2',subject:'uid:3'}).flatMap(r=>r.results);},checkpointer:first.checkpointer,
  plan:async state=>{if(state.modelCalls===2)throw Error('模拟进程关闭');return JSON.stringify({action:'knowledge',query:state.modelCalls===0 ? '整个夏天' : '贝雷帽'});}};
 try{await assert.rejects(createResearchGraph(deps).run({id:'provenance'}),/进程关闭/);}finally{first.close();}
 const second=createAgentTaskStore(options);
 try{
  const result=await createResearchGraph({...deps,checkpointer:second.checkpointer,plan:async state=>{
   assert.equal(state.sources.length,1);assert.equal(state.sources[0].passages.length,2);
   assertDisclosed(state.workingContext,state.sources[0]);
   assert.ok(state.workingContext.evidence.some(r=>r.coverage===audio.coverage));assert.ok(state.workingContext.evidence.some(r=>r.coverage===visual.coverage));
   return complete();
  }}).run({id:'provenance'});
  assert.equal(tools,2);assert.deepEqual(result.citationIndices,[1]);
  await corpus.remember('1','2',result.sources,{subject:'uid:3'});
  assert.deepEqual(await createKnowledgeCorpus(saved.options).list('1','2'),original);
  assert.equal(saved.values[corpusKey('1','2')].sequence,sequence,'引用不刷新原知识时间或归档序号');
  await corpus.clear('1','2');await corpus.remember('1','2',result.sources,{subject:'uid:3'});
  assert.deepEqual(await corpus.list('1','2'),[],'旧引用不能复活已删除原文');
 }finally{second.close();}
});

test('新证据合并后按原片段回存，保留各自时间与范围；inspect跨边界时分段披露',async()=>{
 const result=await merged(),source=result.sources[0],before=structuredClone(result);
 assert.equal(source.passages.length,2);assert.equal(source.coverage,undefined,'混合范围不能伪装成一个标量');
 for(const offset of [0,source.passages[0].end-2,source.passages[1].start,source.content.length-2]){
  const view=compactResearchState({...result,focus:{source:1,offset}},'整个夏天和贝雷帽');assert.ok(view.evidence.length);assertDisclosed(view,source);
 }
 assert.deepEqual(result,before);
 const saved=storage(),corpus=createKnowledgeCorpus(saved.options);await corpus.remember('1','2',result.sources);
 const rows=await createKnowledgeCorpus(saved.options).list('1','2');assert.equal(rows.length,2);
 for(const expected of [audio,visual]){const row=rows.find(r=>r.text===expected.text);assert.ok(row);for(const key of ['at','expiresAt','evidenceKind','coverage'])assert.equal(row[key],expected[key]);}
});

test('同文不同限定不覆盖，读网页保留机器媒体证据，随后摘要不能降级正文',async()=>{
 let calls=0;
 const graph=createResearchGraph({tier:'deep',knowledge:async()=>[{...audio,content:audio.text},{...audio,content:audio.text,coverage:'另一音轨范围，身份仍未知'}],read:async()=>({url,text:'页面公开说明。',coverage:'页面文字，未包含音轨'}),search:async()=>({results:[{url,content:'搜索摘要错误地说已确认身份'}]}),plan:async()=>{
  const actions=[{action:'knowledge',query:'音轨'},{action:'read',source:1},{action:'search',query:'页面'}];return calls<actions.length ? JSON.stringify(actions[calls++]) : complete();
 }});
 const result=await graph.run({id:'read-mixed'}),source=result.sources[0];
 assert.equal(source.passages.length,3);assert.ok(!source.content.includes('搜索摘要错误'));
 assert.equal(result.observations.find(r=>r.action==='read').output.sourceIndex,1);
 assert.deepEqual(new Set(source.passages.map(p=>p.coverage)),new Set([audio.coverage,'另一音轨范围，身份仍未知','页面文字，未包含音轨']));
});

test('超十片段按原十条归档协议分批确认，失败重启和同输入重试不丢失也不重复',async()=>{
 const content=Array.from({length:12},(_,i)=>`第${i}段公开证据。`).join('\n');let cursor=0;
 const passages=Array.from({length:12},(_,i)=>{const text=`第${i}段公开证据。`,start=cursor;cursor+=text.length+1;return {start,end:start+text.length,at:audio.at,evidenceKind:'public-media',coverage:`第${i}段待核实`};});
 const saved=storage(),corpus=createKnowledgeCorpus(saved.options),source={url,content,passages};
 saved.setFail(true);await assert.rejects(corpus.remember('1','2',[source]),/归档未确认/);
 assert.equal(saved.values[corpusKey('1','2')].pending.rows.length,10);
 saved.setFail(false);const restarted=createKnowledgeCorpus(saved.options);
 const rows=await restarted.list('1','2');assert.equal(rows.length,12,'重启读取应自动确认全部片段，无需重新运行研究');assert.deepEqual(saved.archives.map(r=>r.rows.length),[10,2]);
 const sequence=saved.values[corpusKey('1','2')].sequence;await restarted.remember('1','2',[source]);assert.equal(saved.values[corpusKey('1','2')].sequence,sequence);
 assert.equal(new Set(rows.map(r=>r.coverage)).size,12);
});

test('归档失败后的遗忘清除全部待续传片段，重启不能写回尚未归档的数据',async()=>{
 const saved=storage(),corpus=createKnowledgeCorpus(saved.options),content=Array.from({length:11},(_,i)=>String(i).padStart(2,'0')).join('\n');
 const source={url,content,passages:Array.from({length:11},(_,i)=>({start:i*3,end:i*3+2,at:now-1000,coverage:`片段${i}`}))};
 saved.setFail(true);await assert.rejects(corpus.remember('1','2',[source]),/归档未确认/);await assert.rejects(corpus.clear('1','2'),/归档未确认/);
 saved.setFail(false);assert.deepEqual(await createKnowledgeCorpus(saved.options).list('1','2'),[]);assert.deepEqual(saved.archives.map(r=>r.rows.length),[0]);
});

test('损坏的范围、缺口和重叠在写入前拒绝，旧标量知识仍能回存',async()=>{
 const result=await merged(),saved=storage(),corpus=createKnowledgeCorpus(saved.options),source=result.sources[0];
 for(const mutate of [s=>{s.passages[0].end+=2;},s=>{s.passages[1].start+=1;},s=>{s.passages.pop();},s=>{s.passages[0].start=-1;}]){
  const broken=structuredClone(source);mutate(broken);await assert.rejects(corpus.remember('1','2',[broken]));assert.deepEqual(saved.values,{});
 }
 await corpus.remember('1','2',[audio]);assert.equal((await corpus.list('1','2'))[0].coverage,audio.coverage);
});

test('同一原文身份收到矛盾范围时显式拒绝而非最后写者覆盖',async()=>{
 const saved=storage(),corpus=createKnowledgeCorpus(saved.options);await corpus.remember('1','2',[audio]);
 const before=structuredClone(saved.values);await assert.rejects(corpus.remember('1','2',[{...audio,coverage:visual.coverage}]),/范围冲突/);assert.deepEqual(saved.values,before);
});

test('混合范围在长目录和转义字符压力下仍与片段一起披露，截断不拆Unicode字符',async()=>{
 const result=await merged([{...audio,coverage:'\u0000'.repeat(490)+'未知说话人'},{...visual,coverage:'\u0000'.repeat(490)+'未验证身份'}]),source=result.sources[0];
 const sources=Array.from({length:10},(_,i)=>({...source,index:i+1,url:`https://example.org/${i}`,title:'\u0000'.repeat(160)}));
 const view=compactResearchState({sources,observations:[],focus:{source:10,offset:source.passages[1].start}},'贝雷帽');assertDisclosed(view,source);
 assert.ok(view.evidence.some(r=>r.index===10 && r.coverage.endsWith('未验证身份')));
 const long=await merged([{...audio,text:'甲'.repeat(47999)+'😀完整结尾'}]);
 assert.equal(long.sources[0].content.length,47999);assert.ok(long.sources[0].content.endsWith('甲'));
 assert.equal(long.sources[0].passages[0].end,47999);
 const page=await createResearchGraph({initialSources:[url],read:async()=>({url,text:'甲'.repeat(47999)+'😀完整结尾'}),plan:async()=>complete()}).run({id:'unicode-page'});
 assert.equal(page.sources[0].content.length,47999);assert.equal(page.publicSources[0].text.length,47999);
});

test('第二批归档失败后删除待确认片段，其他原文仍可自动续传',async()=>{
 const saved=storage();let acknowledgements=0;
 const corpus=createKnowledgeCorpus({...saved.options,archive:async value=>{if(++acknowledgements===2)throw Error('第二批失败');saved.archives.push(structuredClone(value));}});
 const content=Array.from({length:12},(_,i)=>String(i).padStart(2,'0')).join('\n');
 const source={url,content,passages:Array.from({length:12},(_,i)=>({start:i*3,end:i*3+2,at:now-1000,coverage:`片段${i}`}))};
 await assert.rejects(corpus.remember('1','2',[source]),/第二批失败/);
 const state=saved.values[corpusKey('1','2')],removed=state.rows.find(r=>r.text==='11');
 await createKnowledgeCorpus(saved.options).remove('1','2',removed.id);
 const rows=await createKnowledgeCorpus(saved.options).list('1','2');assert.equal(rows.length,11);assert.ok(!rows.some(r=>r.id===removed.id));
 assert.deepEqual(saved.archives.map(r=>r.rows.length),[10,1]);assert.ok(saved.archives.at(-1).retained.every(id=>id!==removed.id));
});
