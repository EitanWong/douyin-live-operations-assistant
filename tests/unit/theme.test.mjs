import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installTheme, THEME_KEY } from '../../src/ui/theme.js';

function surface(chrome) {
  const dom = new JSDOM('<select><option value="system">系统</option><option value="light">亮</option><option value="dark">暗</option></select>', { url:'https://live.douyin.com/123' });
  if (chrome) dom.window.chrome = chrome;
  const target = dom.window.document.documentElement, select = target.querySelector('select');
  const choose = async value => { select.value = value; select.dispatchEvent(new dom.window.Event('change')); await new Promise(resolve => setImmediate(resolve)); };
  return { dom, target, select, choose };
}

test('外观默认跟随系统，固定主题立即保存，重开恢复；恢复系统也会持久化', async () => {
  const s = surface();
  let controller = installTheme(s);
  try {
    await controller.ready;
    assert.equal(s.target.dataset.theme, 'system');
    await s.choose('light');
    assert.equal(s.target.dataset.theme, 'light');
    assert.equal(s.dom.window.localStorage.getItem(THEME_KEY), 'light');
    controller.destroy();
    controller = installTheme(s); await controller.ready;
    assert.equal(s.select.value, 'light');
    await s.choose('system');
    assert.equal(s.dom.window.localStorage.getItem(THEME_KEY), 'system');
  } finally { controller.destroy(); s.dom.window.close(); }
});

test('扩展存储在弹窗和面板间同步外观，删除偏好回到跟随系统，销毁后取消订阅', async () => {
  const listeners = new Set();
  const data = { [THEME_KEY]:'dark' };
  const chrome = { storage:{ local:{
    async get() { return { ...data }; },
    async set(values) { Object.assign(data,values); for (const listener of listeners) listener({ [THEME_KEY]:{newValue:values[THEME_KEY]} },'local'); }
  }, onChanged:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)} } };
  const a = surface(chrome), b = surface(chrome), ca = installTheme(a), cb = installTheme(b);
  try {
    await Promise.all([ca.ready,cb.ready]);
    assert.equal(a.select.value,'dark'); assert.equal(b.select.value,'dark');
    await a.choose('light');
    assert.equal(b.target.dataset.theme,'light'); assert.equal(b.select.value,'light');
    for (const listener of listeners) listener({[THEME_KEY]:{}},'local');
    assert.equal(a.select.value,'system'); assert.equal(b.select.value,'system');
    ca.destroy(); cb.destroy(); assert.equal(listeners.size,0);
  } finally { ca.destroy(); cb.destroy(); a.dom.window.close(); b.dom.window.close(); }
});

test('受限内容脚本通过扩展后台读取和保存外观，不直接访问扩展存储', async () => {
  const listeners = new Set(), data = { [THEME_KEY]:'dark' };
  const chrome = { runtime:{
    async sendMessage(message) {
      if (message.type === 'theme-get') return {ok:true,value:data[THEME_KEY]};
      data[THEME_KEY] = message.value;
      for (const listener of listeners) listener({[THEME_KEY]:{newValue:message.value}},'local');
      return {ok:true,value:true};
    }
  }, storage:{ local:{
    async get() { throw new Error('Access to storage is not allowed from this context.'); },
    async set() { throw new Error('Access to storage is not allowed from this context.'); }
  }, onChanged:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)} } };
  const s = surface(chrome), errors = [], controller = installTheme({...s,onError:message=>errors.push(message)});
  try {
    await controller.ready;
    assert.equal(s.select.value,'dark');
    await s.choose('light');
    assert.equal(data[THEME_KEY],'light');
    assert.equal(s.target.dataset.theme,'light');
    assert.deepEqual(errors,[]);
  } finally { controller.destroy(); s.dom.window.close(); }
});

test('慢存储读取不能覆盖用户刚选择的模式', async () => {
  let release;
  const s = surface({storage:{local:{get:()=>new Promise(resolve=>release=resolve),set:async()=>{}}}});
  const controller = installTheme(s);
  try {
    await s.choose('light');
    release({[THEME_KEY]:'dark'}); await controller.ready;
    assert.equal(s.select.value,'light'); assert.equal(s.target.dataset.theme,'light');
  } finally { controller.destroy(); s.dom.window.close(); }
});

test('保存失败恢复先前模式并给出反馈，不显示已持久化的假象', async () => {
  const errors = [];
  const s = surface({storage:{local:{get:async()=>({[THEME_KEY]:'dark'}),set:async()=>{throw new Error('quota');}}}});
  const controller = installTheme({...s,onError:message=>errors.push(message)});
  try {
    await controller.ready; await s.choose('light');
    assert.equal(s.target.dataset.theme,'dark'); assert.equal(s.select.value,'dark');
    assert.match(errors[0],/保存失败/);
  } finally { controller.destroy(); s.dom.window.close(); }
});

test('用户脚本接收同源窗口外观变化，未知值安全回到系统模式', async () => {
  const s = surface(), controller = installTheme(s);
  try {
    await controller.ready;
    s.dom.window.dispatchEvent(new s.dom.window.StorageEvent('storage',{key:THEME_KEY,newValue:'dark'}));
    assert.equal(s.select.value,'dark');
    s.dom.window.dispatchEvent(new s.dom.window.StorageEvent('storage',{key:THEME_KEY,newValue:'unexpected'}));
    assert.equal(s.select.value,'system');
    controller.destroy();
    s.dom.window.dispatchEvent(new s.dom.window.StorageEvent('storage',{key:THEME_KEY,newValue:'light'}));
    assert.equal(s.select.value,'system');
  } finally { controller.destroy(); s.dom.window.close(); }
});
