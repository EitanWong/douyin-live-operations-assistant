import { icon } from './icons.js';
import { Spring } from './spring.js';
import { bundledTools } from '../tools/bundled.js';

export const NAVIGATION_GROUPS = [
  {key:'interaction',label:'直播互动',items:[
    ['anchor','主播数据','chart-no-axes-combined'],['pk','PK 预测','swords'],
    ['gift','礼物感谢','gift'],['welcome','进场欢迎','hand'],['likes','点赞感谢','heart'],
    ['keywords','关键词回复','messages-square'],['bot','@机器人','bot'],['timers','定时消息','timer']
  ]},
  {key:'tools',label:'扩展工具',items:[]},
  {key:'settings',label:'设置',items:[
    ['features','功能开关','sliders-horizontal'],['appearance','外观','palette'],
    ['moderation','内容治理','activity'],['ai','AI 设置','sparkles'],['runtime','运行规则','play'],['profiles','主播管理','users-round'],
    ['diagnostics','连接诊断','activity']
  ]}
];

export function navigationTemplate(activeTab = 'pk', tools = bundledTools) {
  const groups = NAVIGATION_GROUPS.map(group => group.key === 'tools' ? {...group,items:[...group.items,...tools.list().map(tool => [tool.id,tool.label,tool.icon])]} : group);
  return `<nav class="nav" aria-label="功能导航">
    <div class="compact-navigation"><label><span>功能分类</span><select data-nav-category aria-label="功能分类"></select></label><label><span>功能页面</span><select data-nav-page aria-label="功能页面"></select></label></div>
    <div class="sidebar-heading"><span class="nav-label">功能导航</span><button type="button" data-sidebar-toggle aria-expanded="true" aria-controls="assistant-navigation-items" aria-label="折叠侧边栏" title="折叠侧边栏">${icon('panel-right')}</button></div>
    <div class="primary-nav" role="group" aria-label="功能分类">${groups.map(group=>`<button type="button" data-category="${group.key}" aria-pressed="${group.key==='interaction'}">${group.label}</button>`).join('')}</div>
    <div id="assistant-navigation-items">${groups.map(group=>`<section class="nav-group" data-nav-group="${group.key}"><h2 class="nav-group-title">${group.label}</h2><div class="subnav" data-subnav="${group.key}" role="tablist" aria-label="${group.label}功能" aria-orientation="horizontal" ${group.key!=='interaction'?'hidden':''}>${group.items.map(([key,label,glyph])=>`<button type="button" role="tab" id="tab-${key}" aria-controls="page-${key}" data-tab="${key}" title="${label}" aria-label="${label}" aria-selected="${key===activeTab}" tabindex="${key===activeTab?0:-1}">${icon(glyph)}<span class="nav-label">${label}</span></button>`).join('')}</div></section>`).join('')}</div>
  </nav>`;
}

// Presentation and navigation preferences are independent of room automation.
// Reuse the same tab nodes in both layouts so draft state and focus survive.
export class Navigation {
  constructor(root, {onError = () => {},onNavigate=()=>{}} = {}) {
    this.root = root;
    this.view = root.host.ownerDocument.defaultView;
    this.workspace = root.querySelector('.workspace');
    this.select = root.querySelector('select[data-sidebar-side]');
    this.toggle = root.querySelector('[data-sidebar-toggle]');
    this.nav = root.querySelector('.nav');
    this.collapsed = false;
    this.side = 'left'; this.layout = 'top'; this.category = 'interaction';
    this.onError = onError;this.onNavigate=onNavigate;
    this.categorySelect=root.querySelector('[data-nav-category]');this.pageSelect=root.querySelector('[data-nav-page]');
    this.onCategory=()=>{const group=root.querySelector(`[data-subnav="${this.categorySelect.value}"]`);const tab=[...group.querySelectorAll('[data-tab]')].find(tab=>!tab.hidden);if(tab)this.onNavigate(tab.dataset.tab);};
    this.onPage=()=>this.onNavigate(this.pageSelect.value);
    this.categorySelect.addEventListener('change',this.onCategory);this.pageSelect.addEventListener('change',this.onPage);
    this.storageKey = 'douyin-live-assistant:sidebar-side';
    try { this.side = this.normalize(this.view.localStorage.getItem(this.storageKey)); } catch {}
    this.collapseKey = 'douyin-live-assistant:sidebar-collapsed';
    try { this.collapsed = this.view.localStorage.getItem(this.collapseKey) === 'true'; } catch {}
    this.width = new Spring(this.collapsed ? 56 : 172, 30, .1);
    this.media = this.view.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.onMotionChange = () => { if (this.media.matches) this.finishMotion(); };
    this.media?.addEventListener('change', this.onMotionChange);
    this.applySide();
    this.applyCollapsed();
    this.onChange = () => this.setSide(this.select.value);
    this.onToggle = () => this.setCollapsed(!this.collapsed);
    this.onStorage = event => {
      if (event.key === this.storageKey || event.key === null) {this.side=this.normalize(event.newValue);this.applySide();}
      if (event.key === this.collapseKey || event.key === null) {this.collapsed=event.newValue === 'true';this.applyCollapsed();}
    };
    this.select.addEventListener('change', this.onChange);
    this.toggle.addEventListener('click', this.onToggle);
    this.view.addEventListener('storage', this.onStorage);
    const shell = root.querySelector('.floating-panel');
    this.update(shell.getBoundingClientRect().width);
    if (this.view.ResizeObserver) {
      this.observer = new this.view.ResizeObserver(entries => this.update(entries[0].contentRect.width));
      this.observer.observe(shell);
    }
  }
  normalize(value) { return value === 'right' ? 'right' : 'left'; }
  setSide(value) {
    const next = this.normalize(value);
    try { this.view.localStorage.setItem(this.storageKey, next); }
    catch { this.select.value=this.side;this.onError('侧边栏位置保存失败，请重试。');return; }
    this.side = next; this.applySide();
  }
  applySide() {
    this.workspace.dataset.navSide = this.side;
    this.select.value = this.side;
    this.toggle.innerHTML = icon(this.side === 'left' ? 'panel-left' : 'panel-right');
  }
  setCollapsed(value) {
    try { this.view.localStorage.setItem(this.collapseKey, String(Boolean(value))); }
    catch { this.onError('侧边栏折叠状态保存失败，请重试。');return; }
    this.collapsed = Boolean(value);
    this.applyCollapsed();
  }
  applyCollapsed() {
    this.workspace.dataset.navCollapsed = String(this.collapsed);
    this.toggle.setAttribute('aria-expanded', String(!this.collapsed));
    const label = this.collapsed ? '展开侧边栏' : '折叠侧边栏';
    this.toggle.setAttribute('aria-label', label);this.toggle.title = label;
    this.width.target = this.collapsed ? 56 : 172;
    if (this.layout !== 'sidebar' || this.media?.matches) {this.finishMotion();return;}
    if (this.frame) return;
    this.lastFrame = this.view.performance.now();
    this.frame = this.view.requestAnimationFrame(time => this.animate(time));
  }
  animate(time) {
    this.frame = null;
    this.width.step(Math.max(0, (time - this.lastFrame) / 1000));
    this.lastFrame = time;
    this.renderWidth();
    if (this.width.active) this.frame = this.view.requestAnimationFrame(next => this.animate(next));
  }
  renderWidth() {
    if (this.layout === 'sidebar') {
      this.nav.style.flexBasis = `${this.width.value}px`;
      this.nav.style.width = `${this.width.value}px`;
    } else {this.nav.style.removeProperty('flex-basis');this.nav.style.removeProperty('width');}
  }
  finishMotion() {
    this.view.cancelAnimationFrame(this.frame);this.frame = null;
    this.width.jump(this.width.target);this.renderWidth();
  }
  update(width) {
    if (!width) return;
    const next = width >= 820 ? 'sidebar' : 'top';
    if (next === this.layout && this.workspace.dataset.navLayout) return;
    this.layout = next;
    this.finishMotion();
    this.workspace.dataset.navLayout = this.layout;
    this.sync();
    const focused = this.root.activeElement;
    if(next==='top' && (focused===this.toggle || focused?.closest('[data-subnav]')))this.pageSelect.focus();
    if(next==='sidebar' && (focused===this.pageSelect || focused===this.categorySelect || focused?.closest('.primary-nav')))this.nav.querySelector('[data-tab][aria-selected="true"]')?.focus();
  }
  sync(category = this.category) {
    this.category = category;
    for (const group of this.root.querySelectorAll('.nav [data-subnav]')) {
      const available = [...group.querySelectorAll('[data-tab]')].filter(tab=>!tab.hidden);
      group.hidden = !available.length || (this.layout === 'top' && group.dataset.subnav !== category);
      group.setAttribute('aria-orientation', this.layout === 'sidebar' ? 'vertical' : 'horizontal');
      const selected = available.some(tab=>tab.getAttribute('aria-selected') === 'true');
      // Each visible tablist has one keyboard entry point, even if its page is
      // in the other category. Arrow keys stay within that labelled group.
      for (const [index,tab] of available.entries()) tab.tabIndex = tab.getAttribute('aria-selected') === 'true' || (!selected && index === 0) ? 0 : -1;
      group.closest('.nav-group').hidden = !available.length;
    }
    this.syncCompact();
    if (this.root.activeElement?.closest('[data-subnav]')?.hidden) {
      this.nav.querySelector('[data-tab][aria-selected="true"]')?.focus();
    }
  }
  syncCompact(){
    const option=(label,value)=>new this.view.Option(label,value);
    this.categorySelect.replaceChildren();this.pageSelect.replaceChildren();
    for(const group of this.root.querySelectorAll('.nav [data-subnav]')){
      const tabs=[...group.querySelectorAll('[data-tab]')].filter(tab=>!tab.hidden);if(!tabs.length)continue;
      this.categorySelect.add(option(group.closest('.nav-group').querySelector('h2').textContent,group.dataset.subnav));
      if(group.dataset.subnav!==this.category)continue;
      for(const tab of tabs)this.pageSelect.add(option(tab.getAttribute('aria-label'),tab.dataset.tab));
      this.pageSelect.value=tabs.find(tab=>tab.getAttribute('aria-selected')==='true')?.dataset.tab || tabs[0].dataset.tab;
    }
    this.categorySelect.value=this.category;
  }
  destroy() {
    this.categorySelect.removeEventListener('change',this.onCategory);this.pageSelect.removeEventListener('change',this.onPage);
    this.observer?.disconnect();
    this.select.removeEventListener('change', this.onChange);
    this.toggle.removeEventListener('click', this.onToggle);
    this.view.cancelAnimationFrame(this.frame);
    this.media?.removeEventListener('change', this.onMotionChange);
    this.view.removeEventListener('storage', this.onStorage);
  }
}
