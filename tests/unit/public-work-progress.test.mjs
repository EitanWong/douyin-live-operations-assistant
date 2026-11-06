import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectPublicWorks,advanceWorkProgress,parseWorkProgress,PUBLIC_WORK_LIMITS} from '../../src/services/public-work-progress.js';
const now=1800000000000,source={id:'author'},url='https://www.douyin.com/user/author';
const works=[1,2,3].map(id=>({kind:'work',id:String(id),subject:'author',url:`https://www.douyin.com/video/${id}`,publishedAt:id}));

test('已采样的作品满一天后按最早完成时间复查，未来与损坏进度不阻断采集',()=>{
 const visits=[{id:'1',status:'complete',at:now-86400000},{id:'2',status:'complete',at:now-86400001},{id:'3',status:'complete',at:now+1}];
 assert.deepEqual(selectPublicWorks(works,source,visits,now).map(r=>r.id),['3','2']);
 assert.deepEqual(selectPublicWorks(works,source,[{invalid:true}],now).map(r=>r.id),['3','2']);
});
test('进度只接受合法抖音主页、有效状态与时效；按上限保留且重复应用幂等',()=>{
 const visits=Array.from({length:PUBLIC_WORK_LIMITS.works+5},(_,i)=>({id:String(i),at:now-i,status:'complete',text:'不能保存正文'}));
 const saved=advanceWorkProgress(null,url,visits,now);
 assert.equal(saved.profiles[0].works.length,PUBLIC_WORK_LIMITS.works);assert.ok(!JSON.stringify(saved).includes('不能保存正文'));
 assert.deepEqual(advanceWorkProgress(saved,url,visits,now),saved);
 assert.equal(parseWorkProgress(saved,now+PUBLIC_WORK_LIMITS.retentionMs).profiles[0].works.length,0);
 for(const invalid of ['https://evil.example/user/author','https://www.douyin.com/video/1'])assert.deepEqual(parseWorkProgress({version:1,profiles:[{url:invalid,works:[]}]},now).profiles,[]);
 assert.equal(advanceWorkProgress(saved,url,[{id:'new',at:now+1,status:'complete'}],now).profiles[0].works.length,PUBLIC_WORK_LIMITS.works);
});
test('只访问同一作者的合法作品链接，排除跨作品链接与重复项',()=>{
 const rows=[{...works[0],url:works[1].url},{...works[1],subject:'other'},works[2],works[2]];
 assert.deepEqual(selectPublicWorks(rows,source,[],now).map(r=>r.id),['3']);
});
