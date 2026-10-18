import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readAudienceContributions} from '../../src/browser/adapter.js';

test('读取在线贡献榜行的昵称与最高分，不把榜单总人数当成用户贡献', () => {
  const dom = new JSDOM(`<div id="chatroom">
    <div><div><div><div><div><p>1000贡献用户(1)</p></div></div></div></div></div>
    <div><div class="LyAdeVIF sBRqUw32"><div></div><div></div><div><div><div><div><div>
      <div><span>1</span><span>观众甲</span><span>粉丝牌</span><span>1,200</span></div>
      <div><span>2</span><span>岁小孩 800</span></div>
    </div></div></div></div></div></div>
  </div>`);
  const rows=readAudienceContributions(dom.window.document);
  assert.deepEqual(rows.map(({name,score})=>({name,score})),[
    {name:'观众甲',score:1200},{name:'岁小孩',score:800}
  ]);
  dom.window.close();
});

test('没有在线观众1000贡献标签时不误读其他页面数字', () => {
  const dom=new JSDOM('<div id="chatroom"><div><span>观众</span><span>1000</span></div></div>');
  assert.deepEqual(readAudienceContributions(dom.window.document),[]);
  dom.window.close();
});

test('直播间更换榜单外层类名后仍能从1000贡献标签附近识别榜单行', () => {
  const dom=new JSDOM(`<div id="chatroom"><div><div><div><div><p>1000贡献用户(1)</p></div></div></div></div><div><div><span>1</span><span>观众丙</span><span>1.2万</span></div></div></div>`);
  assert.deepEqual(readAudienceContributions(dom.window.document).map(({name,score})=>({name,score})),[{name:'观众丙',score:12000}]);
  dom.window.close();
});

test('读取千票榜专属区域，并解析昵称与分数合并的用户项', () => {
  const dom=new JSDOM(`<div id="chatroom"><div><div class="LyAdeVIF sBRqUw32">
    <div></div><div></div><div><div><div>
      <div><div class="Ypyh0f2S"><span>主播支持者 1.2万</span></div></div>
      <div><div class="Ypyh0f2S"><span>另一位支持者 1,000</span></div></div>
    </div></div></div>
  </div></div><p>1000贡献用户(1)</p></div>`);
  assert.deepEqual(readAudienceContributions(dom.window.document).map(({name,score})=>({name,score})),[
    {name:'主播支持者',score:12000},{name:'另一位支持者',score:1000}
  ]);
  dom.window.close();
});

test('按提供的千票榜选择器读取只有昵称的用户并标记1000分下限', () => {
  const dom = new JSDOM(`<div id="chatroom">
    <div><div class="LyAdeVIF sBRqUw32">
      <div></div><div></div><div><div><div><div></div><div><div class="Ypyh0f2S">
        <div data-user-id="12345678"><span>1</span><span>榜单用户甲</span></div>
        <div data-user-id="87654321"><span>2</span><span>榜单用户乙</span></div>
      </div></div></div></div></div>
    </div></div>
    <p>1000贡献用户(2)</p>
  </div>`);
  assert.equal(dom.window.document.querySelectorAll('#chatroom > div > div.LyAdeVIF.sBRqUw32 > div:nth-child(3) > div > div > div:nth-child(2) > div.Ypyh0f2S').length, 1);
  const rows = readAudienceContributions(dom.window.document);
  assert.deepEqual(rows.map(({name,score,scoreIsFloor,userId})=>({name,score,scoreIsFloor,userId})), [
    {name:'榜单用户甲',score:1000,scoreIsFloor:true,userId:'12345678'},
    {name:'榜单用户乙',score:1000,scoreIsFloor:true,userId:'87654321'}
  ]);
  dom.window.close();
});
