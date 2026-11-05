import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOpponentCollector} from '../../extension/opponent-collector.js';

function fixture(){
 const state={},tabs=new Map(),removed=[];let serial=10;
 return {state,tabs,removed,chrome:{storage:{session:{get:async key=>({[key]:state[key]}),set:async value=>Object.assign(state,value)}},
  tabs:{create:async value=>{const tab={id:++serial,...value};tabs.set(tab.id,tab);return tab;},
   get:async id=>{if(!tabs.has(id))throw Error('closed');return tabs.get(id);},
   remove:async id=>{removed.push(id);tabs.delete(id);}}}};
}
test('opponent collection is bounded, read only, restartable and owns only its tabs',async()=>{
 const f=fixture();let c=createOpponentCollector(f.chrome);const owner={frameId:0,tab:{id:1,url:'https://live.douyin.com/123'}};
 const first=await c.open(owner,'456');assert.equal(first.room,'456');assert.equal(f.tabs.size,1);
 const tab=[...f.tabs.values()][0];assert.equal(tab.active,false);
 assert.equal((await c.open(owner,'456')).tabId,first.tabId);
 c=createOpponentCollector(f.chrome);
 const context=await c.context({frameId:0,tab:{id:tab.id,url:tab.url},url:tab.url});
 assert.equal(context.readOnly,true);assert.equal(context.ownerRoom,'123');
 await assert.rejects(c.open(owner,'https://evil.com'),/直播间/);
 await assert.rejects(c.open({...owner,frameId:2},'789'),/来源/);
 const navigated={...tab,url:'https://live.douyin.com/999'};f.tabs.set(tab.id,navigated);
 await c.stop(owner);assert.deepEqual(f.removed,[]);
});
