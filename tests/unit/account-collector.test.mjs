import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectAccount} from '../../extension/account-collector.js';
function fixture({allowed=true,redirect=false,rows=[]}={}){
 const removed=[],scripts=[];
 const chrome={permissions:{contains:async()=>allowed},tabs:{create:async()=>({id:1}),get:async()=>({url:redirect ? 'https://www.douyin.com/user/other' : 'https://www.douyin.com/user/target'}),remove:async id=>removed.push(id)},
  scripting:{executeScript:async options=>{scripts.push(options);return [{result:rows}];}}};
 return {chrome,removed,scripts};
}
test('native account collector observes the selected page and closes only its own temporary tab',async()=>{
 const f=fixture({rows:[{kind:'work',title:'已采集'}]});
 assert.equal((await collectAccount(f.chrome,'https://www.douyin.com/user/target'))[0].title,'已采集');assert.deepEqual(f.removed,[1]);assert.equal(f.scripts[0].world,'MAIN');
 const denied=fixture({allowed:false});await assert.rejects(collectAccount(denied.chrome,'https://www.douyin.com/user/target'),/权限|允许/);assert.deepEqual(denied.removed,[]);
 const redirect=fixture({redirect:true});await assert.rejects(collectAccount(redirect.chrome,'https://www.douyin.com/user/target'),/跳转/);assert.deepEqual(redirect.removed,[1]);
 const c=new AbortController();c.abort();const cancelled=fixture();await assert.rejects(collectAccount(cancelled.chrome,'https://www.douyin.com/user/target',{signal:c.signal}),/取消/);assert.deepEqual(cancelled.removed,[1]);
});
test('a script result arriving after cancellation is discarded and its temporary page is closed',async()=>{
 const f=fixture(),cancel=new AbortController();
 f.chrome.scripting.executeScript=async()=>{cancel.abort();return [{result:[{kind:'work',title:'late'}]}];};
 await assert.rejects(collectAccount(f.chrome,'https://www.douyin.com/user/target',{signal:cancel.signal}),/取消/);
 assert.deepEqual(f.removed,[1]);
});
