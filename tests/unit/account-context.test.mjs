import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accountSource,normalizeAccountPayload,AccountContext} from '../../src/ai/account-context.js';
const url='https://www.douyin.com/user/MS4wLjAB-test';
test('native account IDs stay strings, author mismatch/private records are rejected, unknown counts stay null',()=>{
 assert.throws(()=>accountSource('https://evil.example/user/a'));
 const source=accountSource(url),at=1800000000000;
 const rows=normalizeAccountPayload({user:{sec_uid:'MS4wLjAB-test',uid:'9999999999999999999',nickname:'茶友',signature:'喜欢陶艺',follower_count:0},aweme_list:[
  {aweme_id:'7777777777777777777',desc:'青瓷杯的制作',author:{sec_uid:'MS4wLjAB-test'},statistics:{}},
  {aweme_id:'888',desc:'他人作品',author:{sec_uid:'other'}},
  {aweme_id:'889',desc:'私密作品',author:{sec_uid:'MS4wLjAB-test'},status:{is_private:1}}
 ]},source,at);
 assert.equal(rows.length,2);const profile=rows.find(r=>r.kind==='profile'),work=rows.find(r=>r.kind==='work');assert.equal(profile.counts.followers,0);assert.equal(profile.counts.following,null);assert.equal(work.counts.likes,null);assert.equal(work.id,'7777777777777777777');
 assert.equal(normalizeAccountPayload({user:{sec_uid:'MS4wLjAB-test',nickname:'私密',secret:1}},source,at).length,0);
});
test('scoped account retrieval uses fresh relevant sources and deletion removes future context',()=>{
 let at=1800000000000;const store=new AccountContext({now:()=>at});
 const rows=normalizeAccountPayload({user:{sec_uid:'MS4wLjAB-test',nickname:'茶友',signature:'喜欢陶艺'}},accountSource(url),at);
 store.replace('anchor',url,rows);assert.equal(store.context('other','陶艺').length,0);assert.equal(store.context('anchor','陶艺')[0].source,url);
 at+=25*3600000;assert.equal(store.context('anchor','陶艺').length,0);at-=25*3600000;store.forget('anchor',url);assert.equal(store.context('anchor','陶艺').length,0);
});
test('restored evidence rejects executable links and duplicate work sources do not break retrieval',()=>{
 const at=Date.now(),source=accountSource(url),row=normalizeAccountPayload({aweme_detail:{aweme_id:'7777',desc:'陶艺制作',author:{sec_uid:source.id}}},source,at)[0];
 const store=new AccountContext({snapshot:[{...row,anchor:'anchor',url:'javascript:alert(1)'}]});assert.equal(store.list('anchor').length,0);
 store.replace('anchor',url,[row]);const workURL='https://www.douyin.com/video/7777';store.replace('anchor',workURL,[{...row,source:workURL}]);
 assert.equal(store.context('anchor','陶艺').length,1);
});
test('public profile handles, verification and work topics retain their original descriptive evidence',()=>{
 const source=accountSource(url),rows=normalizeAccountPayload({user:{sec_uid:source.id,nickname:'茶友',signature:'分享陶艺',unique_id:'pottery-live',custom_verify:'陶艺创作者'},aweme_list:[{aweme_id:'55',desc:'青瓷杯',author:{sec_uid:source.id},text_extra:[{hashtag_name:'手工陶艺'}],music:{title:'背景曲'}}]},source);
 assert.match(rows.find(r=>r.kind==='profile').text,/pottery-live/);assert.match(rows.find(r=>r.kind==='profile').text,/陶艺创作者/);
 assert.match(rows.find(r=>r.kind==='work').text,/手工陶艺/);assert.match(rows.find(r=>r.kind==='work').text,/背景曲/);
});
test('a sparse work author cannot erase the richer profile in the same native payload',()=>{
 const source=accountSource(url),rows=normalizeAccountPayload({user:{sec_uid:source.id,nickname:'茶友',signature:'每周六分享陶艺',follower_count:42},aweme_list:[{aweme_id:'56',desc:'作品',author:{sec_uid:source.id,nickname:'茶友'}}]},source);
 const profile=rows.find(r=>r.kind==='profile');assert.match(profile.text,/每周六/);assert.equal(profile.counts.followers,42);
});
test('historical works survive a restart with dated evidence and only enter context for the matching subject',()=>{
 let at=Date.now();const store=new AccountContext({now:()=>at}),source=accountSource(url);
 const payload={user:{sec_uid:source.id,nickname:'主播',signature:'旧简介'},aweme_list:[{aweme_id:'70',desc:'青瓷杯拉坯教程',author:{sec_uid:source.id}}]};
 store.replace('host',url,normalizeAccountPayload(payload,source,at),{role:'anchor'});
 const other='https://www.douyin.com/user/other';store.replace('host',other,normalizeAccountPayload({aweme_detail:{aweme_id:'71',desc:'另一个人的青瓷杯',author:{sec_uid:'other'}}},accountSource(other),at),{role:'viewer'});
 at+=25*3600000;const restored=new AccountContext({now:()=>at,snapshot:store.snapshot()});
 assert.deepEqual(restored.context('host','青瓷'),[],'legacy current-evidence lookup never revives stale data');
 const rows=restored.context('host','青瓷',{subjects:[source.id],includeHistory:true});
 assert.equal(rows.length,1);assert.equal(rows[0].subject,source.id);assert.equal(rows[0].historical,true);assert.equal(rows[0].role,'anchor');assert.match(rows[0].coverage,/历史/);assert.doesNotMatch(rows[0].content,/旧简介/);
 restored.invalidate('host',url);assert.deepEqual(restored.context('host','青瓷',{subjects:[source.id],includeHistory:true}),[],'failed refresh makes all evidence unavailable');
 restored.forget('host',url);assert.equal(restored.history('host').length,1,'forget removes that source from retained history, preserving unrelated people');
});
test('automatic viewer records do not become general anchor background without matching subject identity',()=>{
 const store=new AccountContext(),source=accountSource(url);
 store.replace('host',url,normalizeAccountPayload({user:{sec_uid:source.id,nickname:'观众',signature:'周末做陶艺'}},source),{role:'viewer'});
 assert.deepEqual(store.context('host','陶艺'),[]);
 assert.equal(store.context('host','陶艺',{subjects:[source.id]})[0].subject,source.id);
 assert.deepEqual(store.context('host','陶艺',{subjects:['another']}),[]);
});
