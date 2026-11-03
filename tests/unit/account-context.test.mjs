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
