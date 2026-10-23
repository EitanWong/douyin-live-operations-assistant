import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { FloatingWindow } from '../../src/ui/floating-window.js';

function floatingFixture({reduced = false, savedWindow, savedLauncher} = {}) {
  const dom = new JSDOM('<body><div id="host"></div>', {url:'https://live.douyin.com/1', pretendToBeVisual:true});
  const view = dom.window, root = view.document.querySelector('#host').attachShadow({mode:'open'});
  root.innerHTML = `<button class="launcher">场控</button><div class="dock-hint"></div><div class="floating-panel"><section class="panel"><header class="head"><h1>助手</h1><button>收起</button></header><input></section>${['n','s','e','w','ne','nw','sw'].map(edge => `<div data-resize="${edge}"></div>`).join('')}<button data-resize="se">缩放</button></div>`;
  Object.defineProperties(view, {innerWidth:{value:1280,writable:true}, innerHeight:{value:900,writable:true}});
  let time = 0, serial = 0, toggles = 0;
  const frames = new Map();
  view.requestAnimationFrame = callback => { frames.set(++serial, callback); return serial; };
  view.cancelAnimationFrame = id => frames.delete(id);
  Object.defineProperty(view.performance, 'now', {value:() => time});
  const media = new view.EventTarget(); media.matches = reduced; view.matchMedia = () => media;
  if (savedWindow) view.localStorage.setItem('douyin-live-assistant:window', JSON.stringify(savedWindow));
  if (savedLauncher) view.localStorage.setItem('douyin-live-assistant:launcher', JSON.stringify(savedLauncher));
  const floating = new FloatingWindow({root, onToggle:() => { toggles++; floating.setOpen(!floating.open); }});
  const tick = (ms = 16) => { time += ms; const work = [...frames.values()]; frames.clear(); for (const callback of work) callback(time); };
  const settle = () => { for (let i = 0; i < 240 && frames.size; i++) tick(); assert.equal(frames.size, 0, 'animation must stop at rest'); };
  const pointer = (target, type, x, y, extra = {}) => {
    const event = new view.Event(type, {bubbles:true,cancelable:true,composed:true});
    Object.assign(event, {clientX:x,clientY:y,pointerId:1,button:0,...extra}); target.dispatchEvent(event);
  };
  return {dom,view,root,floating,tick,settle,media,frames,pointer,get toggles() { return toggles; },
    dispose:() => { floating.destroy(); dom.window.close(); }};
}

test('关闭过程可立即反向，多次切换后旧退出不会隐藏已展开的窗口', () => {
  const f = floatingFixture(), w = f.floating;
  try {
    f.root.querySelector('input').focus(); w.setOpen(false);
    assert.equal(f.root.activeElement, w.launcher);
    assert.equal(w.shell.inert, true); assert.equal(w.shell.hidden, false);
    f.tick(60);
    const {value,velocity} = w.presence;
    assert.ok(value > 0 && value < 1); assert.ok(velocity < 0);
    w.setOpen(true);
    assert.equal(w.presence.value,value); assert.equal(w.presence.velocity,velocity);
    assert.equal(w.shell.inert,false);
    f.tick(16); w.setOpen(false); f.tick(16); w.setOpen(true); f.settle();
    assert.equal(w.shell.hidden,false); assert.equal(w.presence.value,1);
    w.setOpen(false); f.settle(); assert.equal(w.panel.hidden,true);
    w.setOpen(true); f.settle();
    f.root.querySelector('input').dispatchEvent(new f.view.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    assert.equal(w.open,false); assert.equal(f.root.activeElement,w.launcher);
  } finally { f.dispose(); }
});

test('拖动按帧合并，松手吸附继承速度；吸附中重新抓取不跳位', () => {
  const f = floatingFixture(), w = f.floating;
  try {
    const x = w.x.value + 20, y = w.y.value + 20;
    f.pointer(w.launcher,'pointerdown',x,y);
    f.pointer(f.view,'pointermove',x-300,y-90); f.tick();
    assert.equal(w.x.value,x-20-300);
    f.pointer(f.view,'pointerup',x-300,y-90);
    assert.ok(w.x.velocity < 0); assert.notEqual(w.x.value,w.x.target);
    const saved = JSON.parse(f.view.localStorage.getItem('douyin-live-assistant:launcher'));
    assert.equal(saved.left,w.x.target);
    w.launcher.click(); assert.equal(f.toggles,0,'a drag must not toggle the panel');
    f.tick();
    const position = w.x.value;
    f.pointer(w.launcher,'pointerdown',position+20,w.y.value+20);
    assert.equal(w.x.value,position);
    f.pointer(f.view,'pointermove',position-80,w.y.value-20); f.tick();
    f.pointer(f.view,'pointerup',position-80,w.y.value-20); f.settle();
    assert.equal(w.x.value,w.x.target);
    assert.equal(w.hintPresence.value,0);
  } finally { f.dispose(); }
});

test('额外触点、丢失捕获、越界拖动和暂停后松手均能安全收敛', () => {
  const f = floatingFixture(), w = f.floating;
  try {
    f.pointer(w.launcher,'pointerdown',w.x.value,w.y.value);
    f.pointer(w.launcher,'pointerdown',0,0,{pointerId:2});
    f.pointer(f.view,'pointermove',-1000,-1000,{pointerId:2}); f.tick();
    assert.equal(w.gesture.moved,false);
    f.pointer(f.view,'pointermove',-1000,-1000); f.tick();
    assert.ok(w.x.value >= w.launcherBounds().minX-24);
    f.tick(120);
    f.pointer(w.launcher,'lostpointercapture',-1000,-1000);
    assert.equal(w.gesture,null); assert.equal(w.x.velocity,0); f.settle();
    assert.equal(w.x.value,w.launcherBounds().minX);
    assert.ok(w.y.value>=w.launcherBounds().minY);
    f.pointer(w.launcher,'pointerdown',w.x.value,w.y.value);
    f.pointer(f.view,'pointermove',100,100); f.tick();
    f.view.dispatchEvent(new f.view.Event('blur')); f.settle(); assert.equal(w.gesture,null);
  } finally { f.dispose(); }
});

test('八个方向缩放保持对侧边固定并限制在视口内，最终尺寸持久化', () => {
  const f = floatingFixture(), w = f.floating;
  try {
    for (const direction of ['n','s','e','w','ne','nw','se','sw']) {
      w.preferredSize={width:600,height:500}; w.applySize(); w.manual=true; w.px.jump(300); w.py.jump(150);
      const handle=f.root.querySelector(`[data-resize="${direction}"]`);
      f.pointer(handle,'pointerdown',500,400);
      f.pointer(f.view,'pointermove',540,430); f.tick();
      if (direction.includes('w')) assert.equal(w.px.value+w.width,900);
      else assert.equal(w.px.value,300);
      if (direction.includes('n')) assert.equal(w.py.value+w.height,650);
      else assert.equal(w.py.value,150);
      f.pointer(f.view,'pointerup',540,430);
      const saved=JSON.parse(f.view.localStorage.getItem('douyin-live-assistant:window'));
      assert.equal(saved.width,w.width); assert.equal(saved.height,w.height);
      assert.equal(saved.manual,true);
    }
    const handle=f.root.querySelector('[data-resize="se"]');
    f.pointer(handle,'pointerdown',0,0); f.pointer(f.view,'pointermove',5000,5000); f.tick();
    assert.ok(w.width+w.px.value<=1270); assert.ok(w.height+w.py.value<=890);
    f.pointer(f.view,'pointercancel',5000,5000); f.settle();
    w.preferredSize={width:600,height:500}; w.applySize(); w.px.jump(100); w.py.jump(100);
    f.pointer(handle,'pointerdown',700,600); f.pointer(f.view,'pointermove',680,580); f.tick();
    f.pointer(f.view,'pointerup',660,560);
    assert.equal(w.width,560); assert.equal(w.height,460,'release coordinates must survive a missed last move');
  } finally { f.dispose(); }
});

test('键盘缩放、恢复默认、标题栏移动及视口缩小后恢复偏好尺寸', () => {
  const f=floatingFixture({savedWindow:{width:720,height:600,left:100,top:80,manual:true}}),w=f.floating;
  try {
    const grip=f.root.querySelector('[data-resize="se"]');
    grip.dispatchEvent(new f.view.KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true}));
    assert.equal(w.width,760);
    f.view.innerWidth=360; f.view.innerHeight=480; f.view.dispatchEvent(new f.view.Event('resize'));
    assert.equal(w.width,340); assert.equal(w.height,460); assert.equal(w.preferredSize.width,760);
    f.view.innerWidth=1280; f.view.innerHeight=900; f.view.dispatchEvent(new f.view.Event('resize'));
    assert.equal(w.width,760); assert.equal(w.height,600);
    f.pointer(f.root.querySelector('.head'),'pointerdown',w.px.value+30,w.py.value+20);
    f.pointer(f.view,'pointermove',500,180); f.tick(); f.pointer(f.view,'pointerup',500,180);
    assert.equal(w.manual,true); assert.ok(w.px.value>100);
    grip.dispatchEvent(new f.view.KeyboardEvent('keydown',{key:'Home',bubbles:true}));
    assert.equal(w.width,620); assert.equal(w.manual,false);
    assert.equal(f.view.localStorage.getItem('douyin-live-assistant:window'),null);
  } finally { f.dispose(); }
});

test('减少动态效果移除空间动画，修改系统偏好会终止在途运动', () => {
  const f=floatingFixture({reduced:true}),w=f.floating;
  try {
    w.setOpen(false); f.tick(50);
    assert.match(w.panel.style.transform,/scale\(1\)/);
    assert.match(w.panel.style.transform,/translate3d\(0,0px,0\)/);
    f.pointer(w.launcher,'pointerdown',w.x.value,w.y.value);
    f.pointer(f.view,'pointermove',100,200); f.tick(); f.pointer(f.view,'pointerup',100,200);
    assert.equal(w.x.value,w.x.target); assert.equal(w.hintPresence.value,0);
    f.media.matches=false; f.media.dispatchEvent(Object.assign(new f.view.Event('change'),{matches:false}));
    w.setOpen(true); f.tick(40); assert.ok(w.presence.active);
    f.media.matches=true; f.media.dispatchEvent(Object.assign(new f.view.Event('change'),{matches:true}));
    assert.equal(w.presence.active,false); assert.equal(f.frames.size,0);
  } finally { f.dispose(); }
});

test('保存的吸附边和纵向比例适配新视口；销毁清理动画和监听器', () => {
  const f=floatingFixture({savedLauncher:{left:20,top:100,edge:'right',ratio:.25}}),w=f.floating;
  assert.equal(w.x.value,w.launcherBounds().maxX);
  const b=w.launcherBounds(); assert.equal(w.y.value,b.minY+(b.maxY-b.minY)*.25);
  w.setOpen(false); assert.ok(f.frames.size>0);
  const value=w.presence.value; w.destroy(); f.tick(1000);
  assert.equal(w.presence.value,value); assert.equal(f.frames.size,0);
  f.pointer(w.launcher,'pointerdown',100,100); assert.equal(w.gesture,null);
  f.dom.window.close();
});
