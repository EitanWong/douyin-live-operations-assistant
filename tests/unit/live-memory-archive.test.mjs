import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LiveMemoryArchive,mergeLiveMemory} from '../../src/ai/live-memory.js';
const at=1800000000000;
test('感知原文和观众记忆跨重启及主播切换保存，检索有限原文且保留时间和来源',async()=>{
 const rows=new Map(),options={room:'1',now:()=>at,get:(key,fallback)=>rows.get(key) ?? fallback,set:async(key,value)=>rows.set(key,structuredClone(value))};
 let store=new LiveMemoryArchive(options);
 store.current('10').perception.observe({kind:'audio',id:'a',text:'今天用白瓷盖碗泡茶',at:at-1000,endedAt:at,isFinal:true,inputSource:'native'});
 for(let i=0;i<60;i++)store.current('10').perception.observe({kind:'video',id:'v'+i,text:'桌面有茶盘'+i,at:at-1000,endedAt:at,isFinal:true});
 store.current('10').audience.observe({id:'c',type:'chat',source:'socket',user:{id:'1',name:'小雨'},text:'我喜欢陶瓷'});
 store.current('20').perception.observe({kind:'audio',id:'b',text:'另一个主播的声音',at,endedAt:at,isFinal:true});
 await store.persist(store.capture());assert.equal(store.capture().length,0);
 store=new LiveMemoryArchive(options);
 assert.equal(store.current('10').perception.snapshot().observations.length,61);
 const selected=store.current('10').perception.context('白瓷盖碗');
 assert.ok(selected.records.some(row=>row.text.includes('白瓷')));assert.ok(selected.records.length<=3);
 assert.equal(selected.records[0].at,at-1000);assert.match(selected.coverage,/historical/);
 assert.ok(!JSON.stringify(selected).includes('另一个主播'));
 assert.match(store.current('10').audience.context({id:'1'}).recentStatements[0].text,/陶瓷/);
 store.current('10').audience.forget('uid:1');await store.persist(store.capture());
 assert.equal(new LiveMemoryArchive(options).current('10').audience.context({id:'1'}),null);
});

test('两个页面的存档合并不覆盖彼此，较旧写入不能复活删除或清空的内容',()=>{
 let time=at;const make=()=>new LiveMemoryArchive({room:'1',get:(_k,f)=>f,set:async()=>{},now:()=>time});
 const a=make(),b=make(),event=(id,text)=>({id,type:'chat',source:'socket',receivedAt:time,user:{id:'1',name:'小雨'},text});
 a.current('10').audience.observe(event('a','白瓷'));b.current('10').audience.observe(event('b','陶瓷'));
 const old=a.capture()[0].state,combined=mergeLiveMemory(old,b.capture()[0].state);
 assert.equal(combined.audience.viewers[0].statements.length,2);
 const loaded=new LiveMemoryArchive({room:'1',get:()=>combined,set:async()=>{},now:()=>time});
 time+=1;loaded.current('10').audience.forget('uid:1');const forgotten=loaded.capture()[0].state;
 time+=86400000;loaded.current('10').audience.snapshot();
 assert.equal(mergeLiveMemory(forgotten,old).audience.viewers.length,0);
 loaded.current('10').perception.observe({kind:'audio',id:'x',text:'还在说话',at:time,endedAt:time,isFinal:true});
 const beforeClear=loaded.capture()[0].state;time+=1;loaded.current('10').perception.clear();
 assert.equal(mergeLiveMemory(loaded.capture()[0].state,beforeClear).perception.observations.length,0);
});
test('写入失败保持待存档内容，可重试；旧写入完成不能清掉新修改，旧运行快照可迁移',async()=>{
 let fail=true;const rows=new Map();
 const store=new LiveMemoryArchive({room:'1',get:(key,f)=>rows.get(key) ?? f,set:async(key,value)=>{if(fail)throw Error('disk full');rows.set(key,structuredClone(value));},legacy:{version:1,anchor:'10',viewers:[{key:'uid:1',name:'小雨',firstAt:at,lastAt:at,statements:[],gifts:[],notes:['人工确认']}],forgetBefore:0,forgotten:[]},now:()=>at});
 const memory=store.current('10'),old=store.capture();
 await assert.rejects(store.persist(old),/disk full/);assert.ok(store.capture().length);
 memory.audience.annotate('uid:1','新的确认');fail=false;await store.persist(old);assert.ok(store.capture().length);
 await store.persist(store.capture());assert.equal(store.capture().length,0);
 const restored=new LiveMemoryArchive({room:'1',get:(key,f)=>rows.get(key) ?? f,set:async()=>{},now:()=>at});
 assert.deepEqual(restored.current('10').audience.context({id:'1'}).verifiedOperatorNotes,['人工确认','新的确认']);
});

test('重放不重复累计；损坏的存档拒绝覆盖；超过近期窗口的感知进入模型时仍标记历史',async()=>{
 const {makeAIRequest}=await import('../../src/services/ai.js');const {mergeConfig}=await import('../../src/core/engine.js');
 const rows=new Map(),store=new LiveMemoryArchive({room:'1',get:(k,f)=>rows.get(k) ?? f,set:async(k,v)=>rows.set(k,structuredClone(v)),now:()=>at});
 const memory=store.current('10').perception,row={id:'a',kind:'audio',text:'白瓷盖碗用温水清洗',at:at-86400000,endedAt:at-86400000+1000,isFinal:true};
 memory.observe(row);assert.equal(memory.observe(row),false);assert.equal(memory.snapshot().observations.length,1);
 const config=mergeConfig(),request=makeAIRequest({task:{kind:'ai'},target:{text:'白瓷盖碗怎么清洗'},maxLength:50,getPerceptionMemory:query=>memory.context(query)},config.ai);
 const data=JSON.parse(request.messages[1].content);assert.match(data.evidence_context.perceptionHistory.coverage,/historical/);assert.equal(data.evidence_context.perceptionHistory.records[0].at,row.at);
 rows.set('live-assistant:live-memory:1:20',{version:1,anchor:'20',audience:{broken:true}});
 assert.throws(()=>store.current('20'),/损坏/);assert.deepEqual(rows.get('live-assistant:live-memory:1:20').audience,{broken:true});
});

test('后台原生存档独立于页面，持续记忆并绑定开始时的主播，重复回放不增加记录',async()=>{
 const {persistNativeMemory}=await import('../../extension/live-memory.js');
 const rows=new Map([['live-assistant:config:1',{anchorId:'20',ai:{assistant:{memoryEnabled:true}}}]]),time=Date.now(),row={id:'backstage',kind:'omni',at:time,endedAt:time,text:'白瓷盖碗'};
 const options={room:'1',row,scope:{anchorId:'10'},read:async key=>rows.get(key),write:async(key,value)=>rows.set(key,structuredClone(value)),transaction:work=>work()};
 await persistNativeMemory(options);await persistNativeMemory(options);
 assert.equal(rows.get('live-assistant:live-memory:1:10').perception.observations.length,1);assert.equal(rows.has('live-assistant:live-memory:1:20'),false);
 rows.get('live-assistant:config:1').ai.assistant.memoryEnabled=false;
 await persistNativeMemory({...options,row:{...row,id:'disabled'}});assert.equal(rows.get('live-assistant:live-memory:1:10').perception.observations.length,2);
});

test('导出包含尚未打开的本房存档和当前未写修改，长记录的相关结尾也可检索',()=>{
 const rows=new Map([['live-assistant:live-memory:1:20',{version:1,anchor:'20',raw:'尚未打开的存档'}],['live-assistant:live-memory:2:30',{anchor:'30'}],['live-assistant:api-key:https://example.org','secret']]);
 const store=new LiveMemoryArchive({room:'1',get:(k,f)=>rows.get(k) ?? f,set:async()=>{},all:()=>Object.fromEntries(rows),now:()=>at});
 const memory=store.current('10').perception,text='其他内容。'.repeat(100)+'白瓷盖碗用温水清洗';
 memory.observe({id:'long',kind:'audio',at,endedAt:at,text,isFinal:true});
 assert.match(JSON.stringify(memory.context('白瓷盖碗清洗')),/温水清洗/);assert.equal(memory.snapshot().observations[0].text,text);
 const exported=store.export();assert.equal(exported.length,2);assert.match(JSON.stringify(exported),/尚未打开/);assert.doesNotMatch(JSON.stringify(exported),/secret|"30"/);
});
