import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Navigation,navigationTemplate} from '../../src/ui/navigation.js';

function fixture({side,collapsed,reduced=false}={}) {
  const dom=new JSDOM('<body><div id="host"></div>',{url:'https://live.douyin.com/1',pretendToBeVisual:true});
  const view=dom.window,root=view.document.querySelector('#host').attachShadow({mode:'open'});
  root.innerHTML=`<div class="floating-panel"><div class="workspace">${navigationTemplate()}<main class="workspace-content"><select data-sidebar-side><option value="left">左</option><option value="right">右</option></select><input value="草稿"></main></div></div>`;
  if(side)view.localStorage.setItem('douyin-live-assistant:sidebar-side',side);
  if(collapsed)view.localStorage.setItem('douyin-live-assistant:sidebar-collapsed','true');
  let time=0,serial=0;const frames=new Map();
  view.requestAnimationFrame=fn=>{frames.set(++serial,fn);return serial;};view.cancelAnimationFrame=id=>frames.delete(id);
  Object.defineProperty(view.performance,'now',{value:()=>time});
  const media=new view.EventTarget();media.matches=reduced;view.matchMedia=()=>media;
  const errors=[],nav=new Navigation(root,{onError:message=>errors.push(message)});
  const tick=ms=>{time+=ms;const work=[...frames.values()];frames.clear();for(const fn of work)fn(time);};
  const settle=()=>{for(let i=0;i<240&&frames.size;i++)tick(16);assert.equal(frames.size,0);};
  return {dom,view,root,nav,frames,media,errors,tick,settle,close(){nav.destroy();dom.window.close();}};
}

test('侧栏顶部按钮只折叠，左右位置独立保存；折叠后保留全部图标入口及可访问名称',()=>{
  const f=fixture({side:'right'});
  try {
    f.nav.update(1240);const page=f.root.querySelector('main'),input=page.querySelector('input');
    f.nav.toggle.click();f.settle();
    assert.equal(f.nav.side,'right');assert.equal(f.nav.width.value,56);
    assert.equal(f.nav.toggle.getAttribute('aria-expanded'),'false');
    assert.equal(f.view.localStorage.getItem('douyin-live-assistant:sidebar-side'),'right');
    assert.equal(f.view.localStorage.getItem('douyin-live-assistant:sidebar-collapsed'),'true');
    for(const tab of f.root.querySelectorAll('[data-tab]'))assert.ok(tab.getAttribute('aria-label')&&tab.querySelector('svg'));
    f.nav.setSide('left');assert.equal(f.nav.width.value,56);assert.equal(f.nav.collapsed,true);
    f.nav.toggle.click();f.settle();assert.equal(f.nav.width.value,172);
    assert.equal(page.querySelector('input'),input);assert.equal(input.value,'草稿');
  } finally {f.close();}
});

test('折叠弹簧可反向，保留位置速度；退出宽窗口停止帧循环且不丢失折叠偏好',()=>{
  const f=fixture();
  try {
    f.nav.update(1240);f.nav.setCollapsed(true);f.tick(60);
    const {value,velocity}=f.nav.width;assert.ok(value>56&&value<172);assert.ok(velocity<0);
    f.nav.setCollapsed(false);assert.equal(f.nav.width.value,value);assert.equal(f.nav.width.velocity,velocity);
    f.tick(16);f.nav.setCollapsed(true);f.nav.update(620);
    assert.equal(f.frames.size,0);assert.equal(f.nav.nav.style.flexBasis,'');
    assert.equal(f.nav.collapsed,true);assert.equal(f.nav.workspace.dataset.navLayout,'top');
    f.nav.update(1240);assert.equal(f.nav.width.value,56);assert.equal(f.nav.nav.style.flexBasis,'56px');
    f.nav.setCollapsed(false);f.nav.destroy();assert.equal(f.frames.size,0);
  } finally {f.close();}
});

test('宽窗口显示两组垂直选项，窄窗口恢复当前分类；禁用功能不会被重新显示',()=>{
  const f=fixture();
  try {
    const gift=f.root.querySelector('[data-tab="gift"]');gift.hidden=true;
    f.nav.update(1240);f.nav.sync('settings');
    for(const group of f.root.querySelectorAll('[data-subnav]')){assert.equal(group.hidden,false);assert.equal(group.getAttribute('aria-orientation'),'vertical');}
    assert.equal(gift.hidden,true);
    f.nav.update(620);
    assert.equal(f.root.querySelector('[data-subnav="interaction"]').hidden,true);
    assert.equal(f.root.querySelector('[data-subnav="settings"]').hidden,false);
    assert.equal(f.root.querySelector('[data-subnav="settings"]').getAttribute('aria-orientation'),'horizontal');
    f.nav.update(0);assert.equal(f.nav.layout,'top');
  } finally {f.close();}
});

test('存储恢复、跨页偏好变更和减少动态效果会正确同步，存储失败保留当前状态',()=>{
  const f=fixture({side:'right',collapsed:true,reduced:true});
  try {
    f.nav.update(1240);assert.equal(f.nav.width.value,56);
    f.view.dispatchEvent(new f.view.StorageEvent('storage',{key:'douyin-live-assistant:sidebar-side',newValue:'left'}));assert.equal(f.nav.side,'left');
    f.nav.setCollapsed(false);assert.equal(f.nav.width.value,172);assert.equal(f.frames.size,0);
    f.media.matches=false;f.nav.setCollapsed(true);f.tick(30);
    f.media.matches=true;f.media.dispatchEvent(new f.view.Event('change'));assert.equal(f.nav.width.value,56);assert.equal(f.frames.size,0);
    Object.defineProperty(f.view,'localStorage',{get(){throw new Error('storage blocked');}});
    f.nav.setSide('right');f.nav.setCollapsed(false);
    assert.equal(f.nav.side,'left');assert.equal(f.nav.collapsed,true);assert.equal(f.errors.length,2);
  } finally {f.close();}
});
