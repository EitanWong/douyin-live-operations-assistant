import {element,organizePage} from './workspace-pages.js';
import {WorkspaceGrid} from './workspace-grid.js';
// Present existing controls in named groups without cloning fields or changing
// their owners. The same nodes survive navigation and responsive layout changes.
const field=path=>`[data-field="${path}"]`;
const groups={
  gift:[['感谢规则',field('gift.responseMode'),field('gift.templates')],['感谢话术与价格补充',field('gift.templates')]],
  welcome:[['欢迎条件',field('welcome.responseMode'),field('welcome.templates')],['欢迎话术',field('welcome.templates')]],
  likes:[['感谢方式',field('like.responseMode'),field('like.templates')],['感谢话术',field('like.templates')]],
  keywords:[['回复规则',field('keyword.responseMode')]],
  timers:[['消息计划','[data-list="timers"]']],
  'auto-like':[['点赞计划','[data-auto-like="batch"]','[data-action="auto-like-start"]'],['执行与进度','[data-action="auto-like-start"]','details.advanced']],
  'auto-gift':[['礼物与账户','[data-action="auto-gift-refresh"]','[data-auto-gift="batch"]'],['数量与额度','[data-auto-gift="batch"]','[data-action="auto-gift-start"]'],['执行与进度','[data-action="auto-gift-start"]','details.advanced']]
};
function siblingOf(node,parent){while(node && node.parentElement!==parent)node=node.parentElement;return node;}
function groupRange(page,[title,selector,endSelector]){
  const node=page.querySelector(selector);if(!node)return;
  let start=node.closest('.field,.grid,.actions') || node;
  // A field in a grid belongs to that whole grid.
  if(start.parentElement?.classList.contains('grid'))start=start.parentElement;
  const parent=start.parentElement,end=endSelector ? siblingOf(page.querySelector(endSelector),parent) : null;
  if(!parent || start===end)return;
  const section=page.ownerDocument.createElement('section');section.className='settings-group workspace-group';
  const heading=page.ownerDocument.createElement('h3');heading.textContent=title;section.append(heading);parent.insertBefore(section,start);
  for(let current=start;current && current!==end;){const next=current.nextSibling;section.append(current);current=next;}
}
function organize(page){
  for(const group of groups[page.dataset.page] || [])groupRange(page,group);
  for(const column of page.querySelectorAll('.settings-column')){
    if(column.querySelector(':scope>h3,:scope>.settings-group,:scope>section'))continue;
    column.classList.add('workspace-card');
  }
  if(page.dataset.page==='rewards'){
    const section=page.querySelector('.settings-group');
    if(section && !section.querySelector('h3')){const h=page.ownerDocument.createElement('h3');h.textContent='参与设置';section.prepend(h);}
  }
  for(const input of page.querySelectorAll('.toggle input[type=checkbox],.giveaway-option input[type=checkbox]'))input.setAttribute('role','switch');
  organizePage(page);
}
function isVisible(node,page){for(let current=node;current && current!==page;current=current.parentElement)if(current.hidden)return false;return true;}

export class WorkspaceLayout {
  constructor(root){
    this.root=root;this.document=root.host.ownerDocument;this.pages=new Map();
    for(const page of root.querySelectorAll('[data-page]')){
      organize(page);const heading=page.querySelector('h2');heading?.classList.add('workspace-source-title');
      this.pages.set(page.dataset.page,{page,title:heading?.textContent || page.getAttribute('aria-label') || page.dataset.page});
    }
    this.toolbar=this.document.createElement('header');this.toolbar.className='workspace-toolbar';this.toolbar.dataset.workspaceToolbar='';this.toolbar.setAttribute('aria-label','当前页面与常用操作');
    this.toolbar.innerHTML='<div class="workspace-heading"><span data-workspace-category></span><h2 data-workspace-title></h2></div><label class="workspace-jump"><span>本页分区</span><select data-page-sections aria-label="跳转到本页分区"></select></label>';
    this.toolbar.append(root.querySelector('.foot'));root.querySelector('.workspace-content').prepend(this.toolbar);
    this.select=this.toolbar.querySelector('select');
    this.views=element(this.toolbar,'div','workspace-views','data-workspace-views');this.toolbar.after(this.views);
    this.subviews=new Map();for(const [key,selector] of [['anchor','.anchor-views'],['ai','.ai-section-tabs']]){const node=root.querySelector(selector);if(node){this.views.append(node);this.subviews.set(key,node);}}
    this.status=element(this.toolbar,'footer','workspace-status','data-workspace-status');this.status.setAttribute('aria-label','运行状态与消息');
    this.status.append(root.querySelector('.shell-status'));root.querySelector('.workspace-content').append(this.status);
    this.messages=element(this.status,'details','workspace-messages','data-workspace-messages');this.messageTitle=element(this.messages,'summary');this.messageTitle.textContent='消息';this.messages.append(this.messageTitle);
    this.messageBody=element(this.messages,'div','workspace-message-list');this.messageBody.setAttribute('aria-label','消息与提醒');
    for(const node of root.querySelectorAll('.toast,.panel>.banner'))this.messageBody.append(node);
    this.messages.append(this.messageBody);this.status.append(this.messages);
    this.messageSignature='';this.syncMessages=()=>{const visible=[...this.messageBody.children].filter(node=>!node.hidden),signature=visible.filter(node=>node.matches('.toast,[data-runtime-alert],[data-ai-alert]')).map(node=>node.textContent).join('\n');this.messageTitle.textContent=visible.length ? `消息 · ${visible.length}` : '暂无新消息';if(signature && signature!==this.messageSignature)this.messages.open=true;if(!signature)this.messages.open=false;this.messageSignature=signature;};
    this.messageObserver=new this.document.defaultView.MutationObserver(this.syncMessages);this.messageObserver.observe(this.messageBody,{subtree:true,attributes:true,attributeFilter:['hidden'],childList:true,characterData:true});this.syncMessages();
    this.grid=new WorkspaceGrid(root);
    this.onJump=()=>{
      const target=this.targets.get(this.select.value);if(!target)return;
      for(let parent=target.parentElement;parent && parent!==this.page;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
      if(target.tagName==='SUMMARY')target.parentElement.open=true;
      target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView?.({block:'start',behavior:'instant'});
    };
    this.select.addEventListener('change',this.onJump);
    this.onSection=event=>{if(event.target.closest('[data-ai-section-tab],[data-anchor-view],[data-field="ai.pipeline.mode"],[data-field^="ai.media."]'))this.document.defaultView.queueMicrotask(()=>{if(!this.destroyed)this.show(this.key);});};
    root.addEventListener('click',this.onSection);root.addEventListener('change',this.onSection);
  }
  show(key){
    const data=this.pages.get(key);if(!data)return;this.key=key;this.page=data.page;
    for(const [page,node] of this.subviews)node.hidden=page!==key;this.views.hidden=!this.subviews.has(key);
    this.toolbar.querySelector('[data-workspace-title]').textContent=data.title;
    const tab=this.root.querySelector(`[data-tab="${key}"]`),group=tab?.closest('[data-nav-group]');
    this.toolbar.querySelector('[data-workspace-category]').textContent=group?.querySelector('.nav-group-title')?.textContent || '直播运营';
    this.targets=new Map();this.select.replaceChildren(new this.document.defaultView.Option('跳转到…',''));
    let serial=0;
    for(const heading of this.page.querySelectorAll('h3,legend,details>summary')){
      if(!isVisible(heading,this.page) || heading.closest('[data-list],[data-memory-list],[data-workspace-help]'))continue;
      const value=String(++serial),label=(heading.querySelector('.pk-broadcast-title')?.textContent || heading.textContent).trim();if(!label)continue;
      this.targets.set(value,heading);this.select.add(new this.document.defaultView.Option(label,value));
    }
    this.select.closest('label').hidden=this.targets.size<2;
  }
  destroy(){this.destroyed=true;this.grid.destroy();this.messageObserver.disconnect();this.root.removeEventListener('change',this.onSection);this.select.removeEventListener('change',this.onJump);this.root.removeEventListener('click',this.onSection);}
}
