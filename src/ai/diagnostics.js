import {REPLY_FREQUENCIES,replyProfile} from './turn-taking.js';
import {beijingDate} from '../services/knowledge.js';
import {AI_PIPELINE_MODES,pipelineConfig,resolveReplyConfig} from '../services/ai-pipeline.js';

// Summarize saved runtime state only. Never return credentials or source content.
export function aiDiagnostics({config,context,mediaState,memoryCount,knownGaps,now=Date.now()}){
 const ai=config.ai,pipeline=pipelineConfig(ai),reply=resolveReplyConfig(ai),today=beijingDate(now),entries=ai.memory.entries;
 const frequency=REPLY_FREQUENCIES.find(([key])=>key===ai.replyFrequency)?.[1] || REPLY_FREQUENCIES[0][1],profile=replyProfile(ai);
 const disabled=entries.filter(row=>!row.enabled).length,expired=entries.filter(row=>row.enabled && row.expiresOn && row.expiresOn<today).length;
 const observations=context.mediaContext?.observations?.length || 0;
 return [
  `已保存的运行配置：AI ${ai.enabled ? '开启' : '关闭'} · ${AI_PIPELINE_MODES.find(([key])=>key===pipeline.mode)?.[1] || '自定义'} · 回复模型 ${reply.model}`,
  '本页未保存的修改不代表后台已生效；诊断不保存设置、不调用模型、不发送弹幕。',
  `弹幕上下文：${context.context.length} 条；只包含本机已采集且仍有效的内容。`,
  `本地知识库：${ai.memory.enabled ? '开启' : '关闭'} · 有效 ${entries.length-disabled-expired} · 过期 ${expired} · 停用 ${disabled}；实际按问题检索。`,
  `观众记忆：${ai.assistant.memoryEnabled ? '开启' : '关闭'} · 已存 ${memoryCount} 位；只记录来源可靠、身份明确的近期互动。`,
  mediaState==='running' ? `直播感知：已接入 · ${observations ? `完成观察 ${observations}` : '等待模型完成观察'}；仅使用当前主播仍有效的观察。` : `直播感知：${mediaState==='starting' ? '正在启动，尚未确认完成观察' : '未开启'}。`,
  `接话策略：${frequency}；先按语境判断对话归属，再受实际发言节奏约束。持续感知不代表持续发言。`,
  `自动感知：${ai.media.autoStart ? '随 AI 场控开启（手动共享需点击）' : '关闭'}；内容互动：${ai.replyFrequency==='mentions' ? '仅回应 @ 模式下静默' : ai.proactiveEnabled ? `开启 · 最短间隔 ${Math.max(profile.proactiveGap/1000,ai.proactiveIntervalSec)} 秒` : '关闭'}；冷场互动：${ai.idleEnabled && ai.chatEnabled ? '开启' : '关闭'}。`,
  `采集完整性：已知缺口 ${knownGaps}（事件或帧）；现场数据是本机采集的部分记录，不能当作平台完整账单。`
 ];
}
