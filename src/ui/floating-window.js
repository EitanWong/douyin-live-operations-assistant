import { Spring } from './spring.js';

const floatingClamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
const floatingRubber = (value, min, max) => {
  const bound = floatingClamp(value, min, max), distance = value - bound;
  return bound + Math.sign(distance) * 24 * (1 - Math.exp(-Math.abs(distance) / 90));
};
const floatingStorage = { launcher:'douyin-live-assistant:launcher', window:'douyin-live-assistant:window' };

// One frame loop owns the geometry and presence channels; no delayed exit
// callbacks can hide a window that has already been reopened.
export class FloatingWindow {
  constructor({root, onToggle}) {
    this.root = root;
    this.view = root.host.ownerDocument.defaultView;
    this.document = root.host.ownerDocument;
    this.launcher = root.querySelector('.launcher');
    this.shell = root.querySelector('.floating-panel');
    this.panel = root.querySelector('.panel');
    this.hint = root.querySelector('.dock-hint');
    this.onToggle = onToggle;
    this.open = true;
    this.listeners = [];
    this.media = this.view.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.reduced = Boolean(this.media?.matches);
    const savedLauncher = this.read('launcher'), savedWindow = this.read('window');
    this.preferredSize = Number.isFinite(savedWindow?.width) && Number.isFinite(savedWindow?.height)
      ? {width:savedWindow.width, height:savedWindow.height} : null;
    this.manual = Boolean(savedWindow?.manual && Number.isFinite(savedWindow.left) && Number.isFinite(savedWindow.top));
    this.measureLauncher();
    this.applySize();
    const bounds = this.launcherBounds();
    this.edge = ['left','right'].includes(savedLauncher?.edge) ? savedLauncher.edge : null;
    const x = this.edge ? bounds[this.edge === 'left' ? 'minX' : 'maxX'] : Number.isFinite(savedLauncher?.left) ? savedLauncher.left : bounds.maxX - 12;
    const y = Number.isFinite(savedLauncher?.ratio) ? bounds.minY + floatingClamp(savedLauncher.ratio, 0, 1) * (bounds.maxY - bounds.minY)
      : Number.isFinite(savedLauncher?.top) ? savedLauncher.top : bounds.maxY - 12;
    this.x = new Spring(floatingClamp(x, bounds.minX, bounds.maxX), 22, .1);
    this.y = new Spring(floatingClamp(y, bounds.minY, bounds.maxY), 22, .1);
    const position = this.manual ? this.clampPanel(savedWindow.left, savedWindow.top) : this.attachedPosition();
    this.px = new Spring(position.left, 26, .1);
    this.py = new Spring(position.top, 26, .1);
    this.presence = new Spring(1, 26, .001);
    this.press = new Spring(1, 32, .001);
    this.hintPresence = new Spring(0, 30, .001);
    this.channels = [this.x, this.y, this.px, this.py, this.presence, this.press, this.hintPresence];
    this.launcher.style.cssText += ';left:0;top:0;right:auto;bottom:auto;';
    this.shell.style.cssText += ';left:0;top:0;right:auto;bottom:auto;';
    this.render();
    this.bind();
  }
  read(key) { try { return JSON.parse(this.view.localStorage.getItem(floatingStorage[key]) || 'null'); } catch { return null; } }
  write(key, value) { try { this.view.localStorage.setItem(floatingStorage[key], JSON.stringify(value)); } catch {} }
  measureLauncher() {
    this.launcherWidth = this.launcher.offsetWidth || 184;
    this.launcherHeight = this.launcher.offsetHeight || 48;
  }
  viewport() {
    const viewport = this.view.visualViewport;
    return {left:viewport?.offsetLeft || 0, top:viewport?.offsetTop || 0,
      width:viewport?.width || this.view.innerWidth, height:viewport?.height || this.view.innerHeight};
  }
  launcherBounds() {
    const v = this.viewport(), margin = v.width <= 560 ? 8 : 12;
    return {minX:v.left + margin, maxX:Math.max(v.left + margin, v.left + v.width - this.launcherWidth - margin),
      minY:v.top + margin, maxY:Math.max(v.top + margin, v.top + v.height - this.launcherHeight - margin)};
  }
  sizeLimits() {
    const v = this.viewport();
    const maxWidth = Math.max(1, v.width - 20), maxHeight = Math.max(1, v.height - 20);
    return {minWidth:Math.min(320, maxWidth), minHeight:Math.min(360, maxHeight), maxWidth, maxHeight};
  }
  applySize(size = this.preferredSize) {
    const limits = this.sizeLimits(), v = this.viewport();
    this.width = floatingClamp(size?.width ?? 620, limits.minWidth, limits.maxWidth);
    this.height = floatingClamp(size?.height ?? Math.min(800, v.height - (v.width > 560 ? 110 : 24)), limits.minHeight, limits.maxHeight);
    this.shell.style.width = `${this.width}px`;
    this.shell.style.height = `${this.height}px`;
    // The grip is also a keyboard resizing control, with a discoverable size.
    this.root.querySelector('[data-resize="se"]').setAttribute('aria-label', `调整窗口大小，当前 ${Math.round(this.width)} × ${Math.round(this.height)} 像素`);
  }
  clampPanel(left, top) {
    const v = this.viewport();
    return {left:floatingClamp(left, v.left + 10, v.left + v.width - this.width - 10),
      top:floatingClamp(top, v.top + 10, v.top + v.height - this.height - 10)};
  }
  attachedPosition() {
    const v = this.viewport(), center = this.x.value + this.launcherWidth / 2;
    const above = this.y.value - this.height - 12;
    const below = this.y.value + this.launcherHeight + 12;
    const top = above >= v.top + 10 ? above : below + this.height <= v.top + v.height - 10 ? below : above;
    return this.clampPanel(center - this.width / 2, top);
  }
  attach(immediate = false) {
    if (this.manual) return;
    const point = this.attachedPosition();
    if (immediate || this.reduced) { this.px.jump(point.left); this.py.jump(point.top); }
    else { this.px.target = point.left; this.py.target = point.top; }
  }
  persistLauncher(left = this.x.target, top = this.y.target) {
    const b = this.launcherBounds();
    this.write('launcher', {left, top, edge:this.edge, ratio:(top - b.minY) / Math.max(1, b.maxY - b.minY)});
  }
  persistWindow() {
    this.write('window', {...(this.preferredSize || {width:this.width, height:this.height}), manual:this.manual, left:this.px.target, top:this.py.target});
  }
  request() {
    if (this.destroyed || this.frame != null) return;
    this.lastTime ??= this.view.performance.now();
    this.frame = this.view.requestAnimationFrame(time => {
      this.frame = null;
      this.flushGesture();
      const seconds = Math.max(0, (time - this.lastTime) / 1000);
      this.lastTime = time;
      for (const channel of this.channels) channel.step(seconds);
      if (!this.gesture || this.gesture.kind === 'launcher') this.attach();
      this.render();
      if (this.channels.some(channel => channel.active)) this.request();
      else this.lastTime = null;
    });
  }
  render() {
    const x = this.x.value, y = this.y.value, amount = floatingClamp(this.presence.value, 0, 1);
    const scale = this.reduced ? 1 : this.press.value;
    this.launcher.style.transform = `translate3d(${x}px,${y}px,0) scale(${scale})`;
    this.shell.style.transform = `translate3d(${this.px.value}px,${this.py.value}px,0)`;
    const anchorX = floatingClamp(x + this.launcherWidth / 2 - this.px.value, 0, this.width);
    const anchorY = floatingClamp(y + this.launcherHeight / 2 - this.py.value, 0, this.height);
    this.panel.style.transformOrigin = `${anchorX}px ${anchorY}px`;
    const distance = this.reduced ? 0 : 1 - amount;
    this.panel.style.transform = `translate3d(0,${(anchorY < this.height / 2 ? -10 : 10) * distance}px,0) scale(${1 - .055 * distance})`;
    this.shell.style.opacity = String(amount);
    this.shell.hidden = this.panel.hidden = !this.open && !this.presence.active;
    this.shell.dataset.motionState = this.presence.active ? this.open ? 'opening' : 'closing' : this.open ? 'open' : 'closed';
    const b = this.launcherBounds();
    this.hint.style.transform = `translate3d(${this.dockEdge === 'left' ? b.minX - 7 : b.maxX + this.launcherWidth + 3}px,${floatingClamp(y - 4, b.minY, b.maxY)}px,0) scaleY(${.7 + .3 * this.hintPresence.value})`;
    this.hint.style.opacity = String(this.hintPresence.value);
  }
  setOpen(open) {
    if (open === this.open) return;
    if (!open && this.gesture) this.endGesture(null, true);
    this.open = open;
    if (open) {
      const wasHidden = this.shell.hidden;
      this.shell.hidden = this.panel.hidden = false;
      if (wasHidden) this.attach(true);
    }
    if (!open && this.panel.contains(this.root.activeElement)) this.launcher.focus({preventScroll:true});
    this.shell.inert = !open;
    this.shell.setAttribute('aria-hidden', String(!open));
    this.shell.dataset.interactive = String(open);
    this.presence.frequency = open ? 26 : 34;
    this.presence.target = open ? 1 : 0;
    this.render();
    this.request();
  }
  listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.listeners.push(() => target.removeEventListener(type, handler, options));
  }
  bind() {
    this.listen(this.launcher, 'pointerdown', event => this.startGesture(event, 'launcher'));
    this.listen(this.launcher, 'click', event => {
      if (event.detail !== 0 && this.suppressClick) { this.suppressClick = false; return; }
      // Synthetic clicks used by integrations have no detail; suppress only
      // the click dispatched synchronously by the completed drag.
      if (this.suppressClick && !event.isTrusted) { this.suppressClick = false; return; }
      this.onToggle();
    });
    const head = this.root.querySelector('.head');
    head.title = '拖动移动窗口 · 双击恢复默认布局';
    this.listen(head, 'pointerdown', event => {
      if (!event.target.closest('button,input,select,textarea,a')) this.startGesture(event, 'panel');
    });
    this.listen(head, 'dblclick', event => { if (!event.target.closest('button')) this.reset(); });
    for (const handle of this.root.querySelectorAll('[data-resize]')) {
      this.listen(handle, 'pointerdown', event => this.startGesture(event, 'resize', handle.dataset.resize));
      this.listen(handle, 'dblclick', () => this.reset());
    }
    this.listen(this.root.querySelector('[data-resize="se"]'), 'keydown', event => this.resizeKey(event));
    this.listen(this.root, 'keydown', event => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (this.gesture) { this.endGesture(null, true); event.preventDefault(); return; }
      if (this.open) { event.preventDefault(); this.onToggle(); }
    });
    this.listen(this.view, 'pointermove', event => this.moveGesture(event), {passive:false});
    this.listen(this.view, 'pointerup', event => this.endGesture(event));
    this.listen(this.view, 'pointercancel', event => this.endGesture(event, true));
    this.listen(this.root, 'lostpointercapture', event => {
      if (event.target === this.gesture?.target) this.endGesture(event, true);
    });
    this.listen(this.view, 'blur', () => this.endGesture(null, true));
    this.listen(this.view, 'resize', () => this.resizeViewport());
    if (this.view.visualViewport) {
      this.listen(this.view.visualViewport, 'resize', () => this.resizeViewport());
      this.listen(this.view.visualViewport, 'scroll', () => this.resizeViewport());
    }
    this.listen(this.document, 'visibilitychange', () => {
      if (this.document.hidden) { this.endGesture(null, true); this.finish(); }
    });
    if (this.media) this.listen(this.media, 'change', event => {
      this.reduced = event.matches;
      if (this.reduced) this.finish();
    });
  }
  startGesture(event, kind, direction) {
    if (this.gesture || event.button !== 0 || event.isPrimary === false || (kind !== 'launcher' && !this.open)) return;
    this.flushGesture();
    this.measureLauncher();
    const left = kind === 'launcher' ? this.x.value : this.px.value;
    const top = kind === 'launcher' ? this.y.value : this.py.value;
    if (kind === 'launcher') { this.x.jump(left); this.y.jump(top); this.suppressClick = false; this.press.target = .97; }
    else { this.px.jump(left); this.py.jump(top); }
    const target = event.currentTarget;
    this.gesture = {kind, direction, target, id:event.pointerId, startX:event.clientX, startY:event.clientY,
      left, top, width:this.width, height:this.height, moved:false, time:this.view.performance.now(), vx:0, vy:0, lastX:left, lastY:top};
    try { target.setPointerCapture(event.pointerId); } catch {}
    this.request();
  }
  moveGesture(event) {
    const g = this.gesture;
    if (!g || g.id !== event.pointerId) return;
    if (!g.moved && Math.hypot(event.clientX - g.startX, event.clientY - g.startY) < (event.pointerType === 'touch' ? 7 : 4)) return;
    g.moved = true;
    this.pendingPointer = {x:event.clientX, y:event.clientY, time:this.view.performance.now()};
    event.preventDefault();
    this.request();
  }
  flushGesture() {
    const g = this.gesture, point = this.pendingPointer;
    this.pendingPointer = null;
    if (!g || !point) return;
    const dx = point.x - g.startX, dy = point.y - g.startY;
    g.pointerX = point.x; g.pointerY = point.y;
    if (g.kind === 'resize') {
      this.resizeFrom(g, dx, dy);
      this.shell.classList.add('resizing');
    } else if (g.kind === 'panel') {
      this.manual = true;
      const p = this.clampPanel(g.left + dx, g.top + dy);
      this.px.jump(p.left); this.py.jump(p.top);
      this.shell.classList.add('moving');
    } else {
      const b = this.launcherBounds();
      const left = floatingRubber(g.left + dx, b.minX, b.maxX), top = floatingRubber(g.top + dy, b.minY, b.maxY);
      const dt = Math.max(8, point.time - g.time) / 1000;
      g.vx = floatingClamp((left - g.lastX) / dt, -2200, 2200);
      g.vy = floatingClamp((top - g.lastY) / dt, -1800, 1800);
      g.lastX = left; g.lastY = top; g.time = point.time;
      this.x.jump(left); this.y.jump(top);
      this.launcher.classList.add('dragging');
      this.press.target = 1.025;
      this.dockEdge = this.projectDock(g.vx).edge;
      this.hintPresence.target = this.reduced ? 0 : 1;
      this.attach();
    }
    this.render();
  }
  projectDock(vx = 0) {
    const b = this.launcherBounds();
    const projected = this.x.value + this.launcherWidth / 2 + floatingClamp(vx * .14, -180, 180);
    const v = this.viewport();
    // Small hysteresis prevents the dock preview flickering near the center.
    const center = v.left + v.width / 2, hysteresis = 18;
    const edge = projected < center - hysteresis ? 'left' : projected > center + hysteresis ? 'right'
      : this.dockEdge || (projected < center ? 'left' : 'right');
    return {edge, left:edge === 'left' ? b.minX : b.maxX};
  }
  endGesture(event, cancelled = false) {
    const g = this.gesture;
    if (!g || (event && g.id !== event.pointerId)) return;
    // A busy page can omit the final move sample. Commit the release point
    // before persisting, without replacing a fresh velocity with a zero sample.
    if (!cancelled && g.moved && event?.type === 'pointerup' && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
      && (event.clientX !== (this.pendingPointer?.x ?? g.pointerX) || event.clientY !== (this.pendingPointer?.y ?? g.pointerY))) {
      this.pendingPointer = {x:event.clientX,y:event.clientY,time:this.view.performance.now()};
    }
    this.flushGesture();
    this.gesture = null;
    this.press.target = 1;
    this.hintPresence.target = 0;
    this.launcher.classList.remove('dragging');
    this.shell.classList.remove('resizing', 'moving');
    if (g.kind === 'launcher' && g.moved) {
      const fresh = !cancelled && this.view.performance.now() - g.time < 80;
      const vx = fresh ? g.vx : 0, vy = fresh ? g.vy : 0;
      const dock = this.projectDock(vx), b = this.launcherBounds();
      this.edge = dock.edge;
      this.x.target = dock.left;
      this.y.target = floatingClamp(this.y.value + vy * .12, b.minY, b.maxY);
      this.x.velocity = vx; this.y.velocity = vy;
      this.suppressClick = true;
      this.persistLauncher();
    } else if (g.moved) this.persistWindow();
    else if (g.kind === 'launcher') {
      // A tap that interrupts docking still comes to rest at its dock.
      const b = this.launcherBounds();
      if (this.edge) this.x.target = this.edge === 'left' ? b.minX : b.maxX;
    }
    try { g.target.releasePointerCapture(g.id); } catch {}
    if (this.reduced) this.finish();
    else this.request();
  }
  resizeFrom(g, dx, dy) {
    const v = this.viewport(), limits = this.sizeLimits();
    const west = g.direction.includes('w'), north = g.direction.includes('n');
    const horizontal = west || g.direction.includes('e'), vertical = north || g.direction.includes('s');
    const right = g.left + g.width, bottom = g.top + g.height;
    const maxWidth = west ? right - v.left - 10 : v.left + v.width - g.left - 10;
    const maxHeight = north ? bottom - v.top - 10 : v.top + v.height - g.top - 10;
    const width = horizontal ? floatingClamp(g.width + (west ? -dx : dx), limits.minWidth, maxWidth) : g.width;
    const height = vertical ? floatingClamp(g.height + (north ? -dy : dy), limits.minHeight, maxHeight) : g.height;
    this.manual = true;
    this.preferredSize = {width, height};
    this.applySize();
    this.px.jump(west ? right - this.width : g.left);
    this.py.jump(north ? bottom - this.height : g.top);
  }
  resizeKey(event) {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Home') return this.reset();
    const delta = event.shiftKey ? 40 : 10;
    const width = this.width + (event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0);
    const height = this.height + (event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0);
    this.preferredSize = {width, height};
    this.applySize();
    // Keyboard resizing can grow in either direction at a viewport edge.
    this.preferredSize = {width:this.width, height:this.height};
    const p = this.clampPanel(this.px.value, this.py.value);
    this.px.jump(p.left); this.py.jump(p.top);
    this.manual = true;
    this.persistWindow();
    this.render();
  }
  reset() {
    if (this.gesture) this.endGesture(null, true);
    this.preferredSize = null;
    this.manual = false;
    this.applySize(); this.attach(true);
    try { this.view.localStorage.removeItem(floatingStorage.window); } catch {}
    this.render();
  }
  resizeViewport() {
    this.endGesture(null, true);
    this.measureLauncher(); this.applySize();
    const b = this.launcherBounds();
    this.x.jump(this.edge === 'left' ? b.minX : this.edge === 'right' ? b.maxX : floatingClamp(this.x.value, b.minX, b.maxX));
    this.y.jump(floatingClamp(this.y.value, b.minY, b.maxY));
    const p = this.manual ? this.clampPanel(this.px.value, this.py.value) : this.attachedPosition();
    this.px.jump(p.left); this.py.jump(p.top);
    this.persistLauncher();
    this.render();
  }
  finish() {
    for (const channel of this.channels) channel.jump(channel.target);
    this.attach(true);
    if (this.frame != null) this.view.cancelAnimationFrame(this.frame);
    this.frame = this.lastTime = null;
    this.render();
  }
  destroy() {
    this.destroyed = true;
    const gesture = this.gesture;
    this.gesture = this.pendingPointer = null;
    try { gesture?.target.releasePointerCapture(gesture.id); } catch {}
    if (this.frame != null) this.view.cancelAnimationFrame(this.frame);
    for (const remove of this.listeners) remove();
  }
}
