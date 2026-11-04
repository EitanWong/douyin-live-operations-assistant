import {AI_TEST_CASES} from '../services/ai-playground.js';
import {append,renderPlaygroundResult,intents} from './ai-playground-result.js';

export function aiPlaygroundTemplate(){return `<div data-ai-playground class="workspace-grid">
 <h2>AI 问答测试</h2>
 <section class="workspace-card"><h3>提出测试问题</h3><p class="hint" data-playground-config>读取已保存配置</p>
 <details><summary>配置与调用说明</summary><p class="hint">使用已保存的回复模型、联网搜索、知识库和当前直播上下文，直接查看 AI 会怎样回答。无需开始场控，测试结果只在这里显示，不发公屏。</p><p class="hint" data-playground-guidance>先在 AI 设置保存模型、密钥和搜索配置。这里会调用实际服务并产生费用；模型测试额度独立计数，按已保存的每小时上限执行，搜索沿用搜索服务额度。测试不写入联网知识缓存。</p></details>
 <label class="field"><span>测试问题</span><textarea data-playground-question maxlength="1000" rows="3" placeholder="例如：抖音直播PK加成规则是什么？请结合搜索来源回答。"></textarea></label>
 <div class="grid"><label class="field"><span>问答模式</span><select data-playground-mode><option value="direct">直接问答（模拟 @ 场控）</option><option value="contextual">弹幕接话判断（允许不回复）</option></select></label><label class="toggle"><input type="checkbox" data-playground-fresh>跳过联网缓存，重新查证</label></div>
 <div class="actions"><button type="button" class="primary" data-playground-run>测试回复</button><button type="button" data-playground-cancel disabled>取消测试</button><button type="button" data-playground-clear>清空对话</button></div>
 <p role="status" aria-live="polite" data-playground-status>输入问题后开始测试。</p><details><summary>评测汇总与记录说明</summary><p role="status" data-playground-summary>尚未运行质量评测。</p><p class="hint">保留本页最近20次结果；连续提问带入最近6轮测试对话，失败和取消不带入。刷新页面后清空。导出只含问题、回复和测试依据，不含密钥或完整直播上下文。</p></details></section>
 <section class="workspace-card" data-playground-output hidden><div class="row"><h3>本次回答与处理过程</h3><button type="button" data-playground-export disabled>导出测试记录</button></div><div data-playground-results aria-live="polite">尚无测试记录。</div></section>
 <details class="workspace-card workspace-wide"><summary>回答质量评测 · 展开选择场景</summary><p class="hint">点击场景只填入问题，按当前真实资料问答；“运行全部场景”使用固定测试资料与直播数据，调用已保存模型逐项评测${AI_TEST_CASES.length}项，不消耗搜索服务额度。覆盖事实、天气日期、追问、计算、错误前提、未知数据、矛盾与网页指令。模型只看问题与资料，看不到评分答案。每项独立，执行失败或取消后停止。全部检查通过才计达标；这套有限评测不能替代真实问题的人工核对。</p>
 <div class="actions">${AI_TEST_CASES.map(row=>`<button type="button" data-playground-case="${row.id}">${row.label}</button>`).join('')}<button type="button" data-playground-suite>运行全部场景</button></div></details>
 </div>`;}

export class AIPlayground {
 constructor(root,{service,describe=()=>'',exportReport=()=>{}}){
  Object.assign(this,{root,service,describe,exportReport});this.records=[];this.serial=0;this.closed=false;this.listeners=[];
  const on=(selector,event,fn)=>{const node=this.node(selector);node.addEventListener(event,fn);this.listeners.push(()=>node.removeEventListener(event,fn));};
  on('[data-playground-run]','click',()=>void this.run());
  on('[data-playground-suite]','click',()=>void this.run(true));
  on('[data-playground-cancel]','click',()=>this.cancel());
  on('[data-playground-clear]','click',()=>{this.cancel();this.serial++;this.records=[];this.suite=[];this.active=null;this.render();this.status('对话与测试记录已清空。');});
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
  this.setBusy(true);this.updateConfig();if(suite){this.suite=[];this.render();}
  try{
   for(const entry of suite ? AI_TEST_CASES : [{question}]){
    if(controller.signal.aborted)break;
    this.status(suite ? `正在测试：${entry.label}` : '正在生成回复…');
    this.active={question:entry.question,status:'running',trace:[]};this.render();
    let result;
    try{result=await this.service.run({question:entry.question,mode:suite ? 'direct' : mode,fresh,turns:suite ? [] : turns,signal:controller.signal,testCase:suite ? entry : undefined,
     onProgress:row=>{if(this.closed || serial!==this.serial || controller.signal.aborted)return;this.active={...this.active,trace:row.trace || this.active.trace};this.render();this.status(row.stage==='search' ? `正在联网查询：${row.query}` : row.stage==='intent' ? `识别意图：${intents[row.intent] || row.intent}` : '正在生成回复…');}});
    }catch(error){result={question:entry.question,status:'failed',error:error.message,answer:''};}
    if(this.closed || serial!==this.serial)return;
    if(controller.signal.aborted)result={...result,status:'cancelled',answer:'',error:'测试已取消'};
    this.active=null;if(suite)this.suite.push(result);
    this.records=[...this.records,{...result,scenario:suite ? entry.id : null}].slice(-20);this.render();
    if(result.status==='failed' || result.status==='cancelled')break;
   }
   if(!this.closed && serial===this.serial)this.status(controller.signal.aborted ? '测试已取消。' : '测试完成，请核对回复与来源。');
  }finally{if(!this.closed && serial===this.serial){this.setBusy(false);this.controller=null;}else if(!this.closed && this.controller===controller){this.setBusy(false);this.controller=null;}}
 }
 render(){
  const target=this.node('[data-playground-results]');target.replaceChildren();
  const [latest,...history]=[...(this.active ? [this.active] : []),...this.records.slice().reverse()];
  this.node('[data-playground-output]').hidden=!latest;
  if(latest)renderPlaygroundResult(target,latest,{latest:true});else target.textContent='尚无测试记录。';
  if(history.length){const details=append(target,'details','','ai-result-history');details.dataset.playgroundHistory='';append(details,'summary',`历史记录 · ${history.length} 条`);for(const row of history)renderPlaygroundResult(details,row);}
  if(this.suite?.length){const passed=this.suite.filter(row=>row.status==='succeeded' && row.checks?.length && row.checks.every(check=>check.pass)).length;this.node('[data-playground-summary]').textContent=`质量评测：已运行 ${this.suite.length}/${AI_TEST_CASES.length}，达标 ${passed}，待改进 ${this.suite.length-passed}。目标为全部达标，请逐项核对未通过原因。`;}
  else this.node('[data-playground-summary]').textContent='尚未运行质量评测。';
  this.node('[data-playground-export]').disabled=!this.records.length;
 }
 close(){this.closed=true;this.serial++;this.controller?.abort();for(const off of this.listeners)off();}
}
