import {AI_TEST_CASES} from '../services/ai-playground.js';

export function aiPlaygroundTemplate(){return `<section class="page" role="tabpanel" id="page-ai-playground" aria-labelledby="tab-ai-playground" data-page="ai-playground" hidden>
 <h2>AI 问答测试</h2><p class="intro">使用已保存的回复模型、联网搜索、知识库和当前直播上下文，直接查看 AI 会怎样回答。无需开始场控，测试结果只在这里显示，不发公屏。</p>
 <section class="workspace-card"><h3>问一句</h3><p class="hint" data-playground-config>读取已保存配置</p>
 <p class="hint">先在 AI 设置保存模型、密钥和搜索配置。这里会调用实际服务并产生费用；模型测试额度独立计数，按已保存的每小时上限执行，搜索沿用搜索服务额度。测试不写入联网知识缓存。</p>
 <label class="field"><span>测试问题</span><textarea data-playground-question maxlength="1000" rows="3" placeholder="例如：抖音直播PK加成规则是什么？请结合搜索来源回答。"></textarea></label>
 <div class="grid"><label class="field"><span>问答模式</span><select data-playground-mode><option value="direct">直接问答（模拟 @ 场控）</option><option value="contextual">弹幕接话判断（允许不回复）</option></select></label><label class="toggle"><input type="checkbox" data-playground-fresh>跳过联网缓存，重新查证</label></div>
 <div class="actions"><button type="button" class="primary" data-playground-run>测试回复</button><button type="button" data-playground-cancel disabled>取消测试</button><button type="button" data-playground-clear>清空对话</button></div>
 <p role="status" aria-live="polite" data-playground-status>输入问题后开始测试。</p></section>
 <section class="workspace-card"><h3>常用场景测试</h3><p class="hint">点击场景填入问题；也可依次测试全部4项。联网问答通常需要两次模型调用。每项独立，不带入测试对话；失败或取消后停止。基本检查只验证意图、格式和引用，事实内容仍需人工核对。</p>
 <div class="actions">${AI_TEST_CASES.map(row=>`<button type="button" data-playground-case="${row.id}">${row.label}</button>`).join('')}<button type="button" data-playground-suite>运行全部场景</button></div></section>
 <section class="workspace-card"><div class="row"><h3>回复与测试记录</h3><button type="button" data-playground-export disabled>导出测试记录</button></div><p class="hint">保留本页最近20次结果；连续提问带入最近6轮测试对话，失败和取消不带入。刷新页面后清空。导出只含问题、回复和测试依据，不含密钥或完整直播上下文。</p><div data-playground-results aria-live="polite">尚无测试记录。</div></section>
 </section>`;}

const statusLabels={succeeded:'已回答',skipped:'选择不回复',failed:'失败',cancelled:'已取消'};
const intents={'live-data':'直播数据','web-search':'联网查询',knowledge:'复用知识',chat:'日常对话',clarify:'澄清条件',skip:'不回复'};
function append(parent,tag,text){const node=parent.ownerDocument.createElement(tag);node.textContent=text;parent.append(node);return node;}
function renderResult(parent,row){
 const item=append(parent,'article','');item.className='editor-row';
 append(item,'h4',`${statusLabels[row.status] || row.status} · ${row.question}`);
 append(item,'p',`${row.provider==='edge' ? '本地' : row.provider==='cloud' ? '云端' : '未完成'} · ${row.model || '—'} · ${row.elapsedMs || 0}ms · 云端 ${row.calls?.cloud || 0} / 本地 ${row.calls?.local || 0} 次`);
 append(item,'p',`意图：${intents[row.intent] || '未完成识别'}${row.cached ? ' · 复用有效历史缓存' : ''}`);
 append(item,'p',row.answer==='[SKIP]' ? '模型判断当前不需要回复。' : row.answer || row.error || '未生成回复');
 if(row.query)append(item,'p',`搜索词：${row.query}`);
 if(row.searchedAt)append(item,'p',`资料采集：${new Date(row.searchedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}`);
 if(row.searchError)append(item,'p',`查询提示：${row.searchError}`);
 for(const check of row.checks || [])append(item,'p',`${check.pass ? '通过' : '需核对'}：${check.label}`);
 if(row.context)append(item,'p',`上下文：${row.context.chat}条对话 · ${row.context.media}条音画观察 · 知识库${row.context.knowledge ? '开启' : '关闭'}`);
 if(row.sources?.length){
  const details=append(item,'details','');append(details,'summary',`查看 ${row.sources.length} 条来源与依据`);
  for(const source of row.sources){
   const block=append(details,'div','');append(block,'strong',`[${source.index}] ${source.title || '来源'}`);
   try{const url=new URL(source.url);if(['http:','https:'].includes(url.protocol) && !url.username && !url.password){const link=append(block,'a',url.href);link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';}}catch{}
   append(block,'p',source.content || source.snippet || '没有正文摘要');
  }
 }
}

export class AIPlayground {
 constructor(root,{service,describe=()=>'',exportReport=()=>{}}){
  Object.assign(this,{root,service,describe,exportReport});this.records=[];this.serial=0;this.closed=false;this.listeners=[];
  const on=(selector,event,fn)=>{const node=this.node(selector);node.addEventListener(event,fn);this.listeners.push(()=>node.removeEventListener(event,fn));};
  on('[data-playground-run]','click',()=>void this.run());
  on('[data-playground-suite]','click',()=>void this.run(true));
  on('[data-playground-cancel]','click',()=>this.cancel());
  on('[data-playground-clear]','click',()=>{this.cancel();this.serial++;this.records=[];this.render();this.status('对话与测试记录已清空。');});
  on('[data-playground-export]','click',()=>{try{this.exportReport({schemaVersion:1,createdAt:Date.now(),results:structuredClone(this.records)});}catch(error){this.status(`导出失败：${error.message}`);}});
  for(const button of root.querySelectorAll('[data-playground-case]')){
   const fn=()=>{const row=AI_TEST_CASES.find(row=>row.id===button.dataset.playgroundCase);this.node('[data-playground-question]').value=row.question;this.node('[data-playground-question]').dispatchEvent(new root.ownerDocument.defaultView.Event('input',{bubbles:true}));this.node('[data-playground-question]').focus();};
   button.addEventListener('click',fn);this.listeners.push(()=>button.removeEventListener('click',fn));
  }
  this.updateConfig();this.render();
 }
 node(selector){return this.root.querySelector(selector);}
 status(text){this.node('[data-playground-status]').textContent=text;}
 updateConfig(){try{this.node('[data-playground-config]').textContent=this.describe();}catch(error){this.node('[data-playground-config]').textContent=`请检查已保存配置：${error.message}`;}}
 setBusy(value){this.busy=value;for(const selector of ['[data-playground-run]','[data-playground-suite]','[data-playground-mode]','[data-playground-fresh]'])this.node(selector).disabled=value;this.node('[data-playground-cancel]').disabled=!value;}
 cancel(){this.controller?.abort();if(this.busy)this.status('正在取消测试…');}
 async run(suite=false){
  if(this.busy || this.closed)return;
  const question=this.node('[data-playground-question]').value.trim();
  if(!suite && (!question || [...question].length>1000)){this.status('请填写1–1000字的测试问题。');return;}
  const serial=++this.serial,controller=this.controller=new AbortController(),mode=this.node('[data-playground-mode]').value,fresh=this.node('[data-playground-fresh]').checked;
  const turns=this.records.filter(row=>!row.scenario && row.status==='succeeded' && row.checks?.every(check=>check.pass)).map(({question,answer,contextRevision})=>({question,answer,contextRevision}));
  this.setBusy(true);this.updateConfig();
  try{
   for(const entry of suite ? AI_TEST_CASES : [{question}]){
    if(controller.signal.aborted)break;
    this.status(suite ? `正在测试：${entry.label}` : '正在生成回复…');
    let result;
    try{result=await this.service.run({question:entry.question,mode:suite ? 'direct' : mode,fresh,turns:suite ? [] : turns,signal:controller.signal,testCase:suite ? entry : undefined,
     onProgress:row=>{if(this.closed || serial!==this.serial || controller.signal.aborted)return;this.status(row.stage==='search' ? `正在联网查询：${row.query}` : row.stage==='intent' ? `识别意图：${intents[row.intent] || row.intent}` : '正在生成回复…');}});
    }catch(error){result={question:entry.question,status:'failed',error:error.message,answer:''};}
    if(this.closed || serial!==this.serial)return;
    if(controller.signal.aborted)result={...result,status:'cancelled',answer:'',error:'测试已取消'};
    this.records=[...this.records,{...result,scenario:suite ? entry.id : null}].slice(-20);this.render();
    if(result.status==='failed' || result.status==='cancelled')break;
   }
   if(!this.closed && serial===this.serial)this.status(controller.signal.aborted ? '测试已取消。' : '测试完成，请核对回复与来源。');
  }finally{if(!this.closed && serial===this.serial){this.setBusy(false);this.controller=null;}else if(!this.closed && this.controller===controller){this.setBusy(false);this.controller=null;}}
 }
 render(){
  const target=this.node('[data-playground-results]');target.replaceChildren();
  if(!this.records.length)target.textContent='尚无测试记录。';
  for(const row of [...this.records].reverse())renderResult(target,row);
  this.node('[data-playground-export]').disabled=!this.records.length;
 }
 close(){this.closed=true;this.serial++;this.controller?.abort();for(const off of this.listeners)off();}
}
