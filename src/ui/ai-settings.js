import {DOUYIN_RULES} from '../data/douyin-rules.js';
import {MEMORY_LIMITS,validateMemory} from '../services/knowledge.js';

export function aiEnhancementsTemplate(panel) {
  const mediaField=(kind,title)=>`<details><summary>${title}服务</summary>${panel.input(`ai.media.${kind}Endpoint`,`${title}接口地址`)}${panel.input(`ai.media.${kind}Model`,`${title}模型名称`)}<label class="field"><span>${title} API Key</span><input type="password" data-media-key="${kind}" autocomplete="new-password" placeholder="留空使用已保存密钥或同域AI密钥"><small>同一服务域名共用密钥，不随配置导出。</small></label><label class="toggle"><input type="checkbox" data-media-remember="${kind}">记住新密钥（仅此设备）</label><button type="button" data-media-forget="${kind}">清除音视频服务密钥</button></details>`;
  return `<section class="settings-group workspace-wide"><h3>直播音视频识别</h3><p class="group-note">手动选择共享的直播标签页，持续识别画面与语音，为问答提供近期现场线索。每次刷新后需要重新开启。</p>
    <div class="grid">${panel.toggle('ai.media.videoEnabled','识别直播画面')}${panel.toggle('ai.media.audioEnabled','识别直播语音')}${panel.input('ai.media.videoIntervalSec','画面采样间隔 / 秒','number')}${panel.input('ai.media.audioIntervalSec','音频分段时长 / 秒','number')}${panel.input('ai.media.maxPerHour','音视频每小时最多调用 / 次','number')}${panel.input('ai.media.contextAgeSec','识别结果有效期 / 秒','number')}</div>
    <div class="grid"><div>${mediaField('vision','视觉')}</div><div>${mediaField('audio','音频')}</div></div>
    <p class="hint">视觉模型需支持图片输入，音频模型需支持 WAV 音频输入；普通文本模型无法识别。两类服务可分别配置。扩展版需在扩展图标中授权对应接口域名。</p>
    <div class="actions"><button type="button" data-media-start>选择直播标签页并开始识别</button><button type="button" data-media-stop disabled>停止识别</button><button type="button" data-media-clear>清空识别上下文</button></div>
    <p class="hint" role="status" aria-live="polite" data-media-status>尚未开始识别</p><p class="hint" data-media-error hidden></p>
    <details><summary>近期识别结果</summary><div data-media-results><p class="empty">开启后显示带时间的画面描述和语音转写。</p></div></details>
    <p class="hint">选屏时选择直播标签页，并勾选“同时分享标签页音频”。共享区域的截图与音频片段会发往你配置的服务；原始媒体只在本机内存短暂处理，不写入配置、日志或账本。识别可能延迟和出错，不用于自动处罚。忙时跳过采样；连续失败或额度用完会停止。</p>
  </section>
  <section class="settings-group workspace-wide"><h3>背景记忆</h3>${panel.toggle('ai.memory.enabled','允许 AI 使用已保存的背景记忆')}<p class="group-note">在当前主播直播间保存长期背景，例如主播介绍、固定排期、商品口径。只由你添加、编辑或删除；弹幕和模型不能自动改写记忆。每次问答最多检索8条相关资料。</p><div data-memory-list></div><p class="empty" data-memory-empty>还没有背景记忆。添加已核实的资料，让回答有据可查。</p><button type="button" data-memory-add>添加背景记忆</button><p class="hint">保存设置后持久记住，刷新后仍在；随该直播间配置导出和导入。到期或停用的条目不再进入 AI 上下文。每条正文最多2000字，共40条，正文总计最多20000字。</p></section>
  <section class="settings-group workspace-wide"><h3>抖音直播与 PK 规则依据</h3><p class="group-note">核对日期：2026-11-01。内置公开条款摘要和采集边界，所有 AI 功能共用。规则会更新，具体活动、加成和段位任务以平台当期说明为准。</p><details><summary>查看规则摘要与来源</summary>${DOUYIN_RULES.map(row=>`<div class="editor-row"><strong>${row.id} · ${row.authority==='official' ? '官方条款摘要' : '助手事实边界'}</strong><p>${row.text}</p>${row.source.url ? `<a href="${row.source.url}" target="_blank" rel="noopener noreferrer">${row.source.title} · ${row.source.publishedOn}</a>` : '<small>本助手的使用限制，不是平台官方条款。</small>'}</div>`).join('')}</details><p class="hint">最新政策或不明活动条件需要联网核对官方来源。未找到、资料冲突或采集不足时，AI 应说明无法确认，不补造价格、承诺或计分公式。</p></section>`;
}

const fields=[['title','资料标题','text'],['content','背景正文','textarea'],['source','资料来源 / 确认人','text'],['expiresOn','到期日期（可留空，当日仍有效）','date']];
export class AISettings {
  constructor(root,{dirty,start,stop,clear,forget,error}) {
    this.root=root;this.dirty=dirty;this.error=error;
    const edited=event=>{if(event.target.matches('[data-memory-field],[data-media-key],[data-media-remember]'))dirty();};
    root.addEventListener('input',edited);root.addEventListener('change',edited);
    root.querySelector('[data-memory-add]').addEventListener('click',()=>{
      if(this.list.children.length>=MEMORY_LIMITS.entries){error(new Error('背景记忆最多40条'));return;}
      this.add({id:crypto.randomUUID(),title:'',content:'',source:'用户填写',updatedAt:Date.now(),expiresOn:'',enabled:true});this.empty();dirty();this.list.lastElementChild.querySelector('input').focus();
    });
    root.querySelector('[data-media-start]').addEventListener('click',()=>{
      try {Promise.resolve(start()).catch(error);}catch(reason){error(reason);}
    });
    root.querySelector('[data-media-stop]').addEventListener('click',()=>stop());
    root.querySelector('[data-media-clear]').addEventListener('click',()=>clear());
    for(const button of root.querySelectorAll('[data-media-forget]'))button.addEventListener('click',()=>{void Promise.resolve(forget(button.dataset.mediaForget)).catch(error);});
    for(const kind of ['vision','audio'])root.querySelector(`[data-field="ai.media.${kind}Endpoint"]`).addEventListener('input',()=>{root.querySelector(`[data-media-key="${kind}"]`).value='';});
  }
  get list(){return this.root.querySelector('[data-memory-list]');}
  empty(){this.root.querySelector('[data-memory-empty]').hidden=Boolean(this.list.children.length);}
  add(record){
    const row=document.createElement('div');row.className='editor-row';row.record=structuredClone(record);
    row.innerHTML='<div class="row-head"><b>背景资料</b><button type="button" data-memory-remove>删除这条记忆</button></div>';
    for(const [name,title,type] of fields){
      const label=document.createElement('label');label.className='field';const span=document.createElement('span');span.textContent=title;
      const control=document.createElement(type==='textarea' ? 'textarea' : 'input');if(type!=='textarea')control.type=type;
      control.dataset.memoryField=name;control.value=record[name];control.maxLength=name==='content' ? 2000 : name==='title' ? 80 : 200;label.append(span,control);row.append(label);
    }
    const label=document.createElement('label');label.className='toggle';const enabled=document.createElement('input');enabled.type='checkbox';enabled.dataset.memoryField='enabled';enabled.checked=record.enabled;label.append(enabled,'使用这条资料');row.append(label);
    const checked=document.createElement('small');checked.textContent=`核对时间：${new Date(record.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}`;row.append(checked);
    row.querySelector('[data-memory-remove]').addEventListener('click',()=>{row.remove();this.empty();this.dirty();});
    this.list.append(row);
  }
  populate(memory){this.list.replaceChildren();for(const record of memory.entries)this.add(record);this.empty();for(const input of this.root.querySelectorAll('[data-media-key]'))input.value='';}
  read(){
    const memory={enabled:this.root.querySelector('[data-field="ai.memory.enabled"]').checked,entries:[...this.list.children].map(row=>{
      const result={...row.record};for(const input of row.querySelectorAll('[data-memory-field]'))result[input.dataset.memoryField]=input.type==='checkbox' ? input.checked : input.value.trim();
      if(Object.keys(result).some(key=>result[key]!==row.record[key]))result.updatedAt=Date.now();return result;
    })};
    return validateMemory(memory);
  }
  credentials(){return Object.fromEntries(['vision','audio'].map(kind=>[kind,{key:this.root.querySelector(`[data-media-key="${kind}"]`).value.trim(),remember:this.root.querySelector(`[data-media-remember="${kind}"]`).checked}]));}
  state({state,skipped=0,errors=0}){
    this.root.querySelector('[data-media-start]').disabled=state!=='idle';this.root.querySelector('[data-media-stop]').disabled=state==='idle';
    this.root.querySelector('[data-media-status]').textContent=`${({idle:'识别已停止',starting:'等待选择共享的直播标签页',running:'正在持续识别所选共享内容'})[state]} · 忙时跳过 ${skipped} 次 · 失败 ${errors} 次`;
    if(state==='starting')this.showError('');
  }
  showError(message){const target=this.root.querySelector('[data-media-error]');target.textContent=message;target.hidden=!message;}
  observations(rows){
    const target=this.root.querySelector('[data-media-results]');target.replaceChildren();
    if(!rows.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='当前没有有效识别结果。';target.append(empty);}
    for(const row of rows){const p=document.createElement('p');p.textContent=`${new Date(row.at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} · ${row.kind==='video' ? '画面' : '语音'}：${row.text}`;target.append(p);}
  }
}
