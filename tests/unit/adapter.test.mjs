import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readAudienceContributions,readRoomSnapshot} from '../../src/browser/adapter.js';

test('读取直播间主文档的在线人数与点赞总数，并只统计可见贡献榜行数', () => {
  const dom = new JSDOM(`<div id="chatroom">
    <div><span>在线观众</span><span>·</span><span>1.2万</span></div>
    <p>1000贡献用户(2)</p>
    <div><div class="LyAdeVIF sBRqUw32"><div></div><div></div><div><div><div><div><div>
      <div><span>1</span><span>观众甲</span><span>1,200</span></div>
      <div><span>2</span><span>观众乙</span><span>1,000</span></div>
    </div></div></div></div></div></div></div>
  </div><div><span>6,553本场点赞</span></div>`);
  const snapshot = readRoomSnapshot(dom.window.document);
  assert.equal(snapshot.source, 'dom');
  assert.equal(snapshot.onlineCount, 12000);
  assert.equal(snapshot.likeTotal, 6553);
  assert.equal(snapshot.visibleContributionRows, 2);
  assert.ok(Number.isFinite(snapshot.capturedAt));
  dom.window.close();
});

test('DOM 快照遇到重复或不完整指标时保留未知，不跨区域猜测', () => {
  const dom = new JSDOM(`<div id="chatroom"><div><span>在线观众</span><span>未公开</span></div></div>
    <div><span>100本场点赞</span><span>101本场点赞</span></div>`);
  const snapshot = readRoomSnapshot(dom.window.document);
  assert.equal(snapshot.onlineCount, null);
  assert.equal(snapshot.likeTotal, null);
  assert.equal(snapshot.visibleContributionRows, 0);
  assert.equal(readRoomSnapshot(new JSDOM('<div>offline</div>').window.document), null);
  dom.window.close();
});

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

test('独立用户榜无需千票标题；嵌套资料链接只归属本行，不能从兄弟行借UID',()=>{
  const dom=new JSDOM(`<div id="chatroom"><p>用户榜</p><div>
    <div><a href="/user/12345678"><span>用户甲</span></a><span>1,200</span></div>
    <div><span>用户乙</span><span>1,000</span></div>
  </div></div>`);
  const rows=readAudienceContributions(dom.window.document);
  assert.deepEqual(rows.map(({name,userId,score})=>({name,userId,score})),[
    {name:'用户甲',userId:'12345678',score:1200},{name:'用户乙',userId:'',score:1000}
  ]);
  dom.window.close();
});

test('同名不同UID榜单独立保留，同UID重复榜单取最高值',()=>{
  const dom=new JSDOM(`<div id="chatroom"><p>用户榜</p><div>
    <div data-uid="12345678"><span>同名</span><span>1200</span></div>
    <div data-uid="87654321"><span>同名</span><span>1300</span></div>
    <div data-uid="12345678"><span>同名</span><span>1500</span></div>
  </div></div>`);
  assert.deepEqual(readAudienceContributions(dom.window.document).map(({userId,score})=>({userId,score})),[
    {userId:'12345678',score:1500},{userId:'87654321',score:1300}
  ]);
  dom.window.close();
});

test('指定观众榜按昵称和分数字段读取，粉丝牌、纯数字昵称与未排名不导致漏行',()=>{
  const dom=new JSDOM(`<div id="chatroom"><div><div class="LyAdeVIF sBRqUw32">
    <div></div><div></div><div><div><div><div><div>
      <div class="LLkRvMAV"><div>1</div><div class="_QlQGbi1">LILAC</div><div class="Ql4e1dvM"><span>岁小孩</span>6297</div></div>
      <div class="LLkRvMAV"><div>2</div><div class="_QlQGbi1">12345</div><div class="Ql4e1dvM">1001</div></div>
      <div class="LLkRvMAV"><div>-</div><div class="_QlQGbi1">萌面兔</div><div class="Ql4e1dvM">0</div></div>
    </div></div></div></div></div>
  </div></div></div>`);
  assert.deepEqual(readAudienceContributions(dom.window.document).map(({name,score})=>({name,score})),[
    {name:'LILAC',score:6297},{name:'12345',score:1001},{name:'萌面兔',score:0}
  ]);
  dom.window.close();
});
