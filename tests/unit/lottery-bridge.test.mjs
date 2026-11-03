import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {PageRequestSender,RequestBridgeClient} from '../../src/browser/request-sender.js';

const lotteryId='7702521633959316287';
function fixture() {
  const page=new JSDOM('',{url:'https://live.douyin.com/123'}).window;
  return {page,close:()=>page.close()};
}
test('福袋准备、提交和撤销通过扩展桥固定语义操作传递',async()=>{
  const f=fixture(),messages=[];
  try {
    const bridge=new RequestBridgeClient(f.page,async message=>{messages.push(message.command);return {ok:true,value:message.command.operation.startsWith('prepare')?{available:true,token:'ticket'}:{submitted:true}};});
    assert.equal((await bridge.prepareLottery(lotteryId,{allowPassword:true})).available,true);
    assert.equal((await bridge.commitLottery('ticket')).submitted,true);
    await bridge.stopLottery('ticket');
    assert.deepEqual(messages.map(({operation,lotteryId,allowPassword,token})=>({operation,lotteryId,allowPassword,token})),[
      {operation:'prepare-lottery',lotteryId,allowPassword:true,token:undefined},
      {operation:'commit-lottery',lotteryId:undefined,allowPassword:undefined,token:'ticket'},
      {operation:'stop-lottery',lotteryId:undefined,allowPassword:undefined,token:'ticket'}
    ]);
    const sender=new PageRequestSender(f.page);
    assert.equal((await sender.prepareLottery(lotteryId)).available,false,'缺少页面上下文不能准备');
    assert.equal((await sender.commitLottery('missing')).dispatched,false);
    assert.equal((await sender.stopLottery('missing')).stopped,true);
  }finally{f.close();}
});
test('福袋准备在取消或超时后迟到时，撤销票据并返回不可用',async()=>{
  for(const mode of ['abort','timeout']) {
    const f=fixture(),controller=new AbortController(),stops=[];let complete,cancel;
    try {
      f.page.setTimeout=fn=>{cancel=fn;return 1;};f.page.clearTimeout=()=>{};
      const bridge=new RequestBridgeClient(f.page,message=>{
        if(message.command.type==='cancel')return {ok:true};
        if(message.command.operation==='stop-lottery'){stops.push(message.command.token);return {ok:true,value:{stopped:true}};}
        return new Promise(resolve=>{complete=resolve;});
      });
      const pending=bridge.prepareLottery(lotteryId,{signal:controller.signal});
      if(mode==='abort')controller.abort();else await cancel();
      complete({ok:true,value:{available:true,token:'late'}});
      assert.equal((await pending).available,false);assert.deepEqual(stops,['late']);
    }finally{f.close();}
  }
});
