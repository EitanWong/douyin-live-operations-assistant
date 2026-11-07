import {createElement as h,useEffect,useRef} from 'react';
import {Textarea,NativeSelect,MultiSelect,Group,Badge} from '@mantine/core';
import {Button} from './motion.js';
import {RELATIONSHIP_STATUS_LABELS,NETWORK_COLORS} from '../relationship-network.js';
import {networkInsights} from '../network-insights.js';
import {PERSON_FACETS} from '../../ai/person-dossier.js';
const at=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const options=map=>Object.entries(map).map(([value,label])=>({value,label}));
const empty=text=>h('p',{className:'product-workbench-empty'},text);
function Evidence({rows=[],action}){
 return h('div',{className:'network-evidence'},rows.length ? rows.map((row,i)=>h('article',{key:`${row.recordId || 'evidence'}:${i}`},h('div',{className:'network-evidence-meta'},h(Badge,{variant:'light',color:row.trust==='verified' ? 'teal' : row.trust==='observed' ? 'blue' : 'yellow'},RELATIONSHIP_STATUS_LABELS[row.trust] || '待核实'),h('small',null,`${row.source} · ${at(row.at)}${row.scope ? ` · 房间${row.scope.room}` : ''}`)),h('p',null,row.text),row.attribution ? h('small',null,row.attribution) : null,row.recordId ? h(Button,{variant:'subtle',size:'xs',onClick:()=>action({type:'original',recordId:row.recordId})},'查看完整原文') : null)) : empty('尚无对应原话，保留未知。'));
}
export function Dossier({person,view,action}){
 const dossier=person?.dossier;if(!person)return empty('选择人物后查看有来源的档案。');
 if(!dossier)return empty('此人物尚无可展示档案，可先查看关系证据。');
 return h('div',{className:'network-dossier'},dossier.profiles.map(url=>h('a',{key:url,href:url,target:'_blank',rel:'noopener noreferrer'},'抖音公开主页 ↗')),
 h('div',{className:'network-facets'},dossier.facets.map((r,i)=>h('article',{key:i},h('small',null,PERSON_FACETS[r.category]),h('p',null,r.text),h('small',null,`${RELATIONSHIP_STATUS_LABELS[r.trust]} · ${r.source} · ${at(r.at)}${r.evidenceCount>1 ? ` · ${r.evidenceCount}条同内容记录` : ''}`),h(Button,{variant:'subtle',size:'xs',onClick:()=>action({type:'original',recordId:r.recordId})},'核对原文')))),
 (dossier.analysis || []).length ? h('section',null,h('h4',null,'心理与互动解读（待核实假设）'),h(Evidence,{rows:dossier.analysis.map(r=>({...r,text:`${r.text} ${r.limitations}`})),action})) : null,
 dossier.gifting ? h('article',null,h('h4',null,'送礼观测'),[...(dossier.gifting.observed ? [dossier.gifting.observed] : []),...(dossier.gifting.byScope || [])].map((r,i)=>h('p',{key:i},`房间 ${r.room || r.scope?.room || '当前'} · 30天观测 ${r.count} 件`)),h('small',null,`${dossier.gifting.basis}；未来送礼概率未知。`)) : null,
 h('h4',null,'事件与记忆'),h(Evidence,{rows:dossier.events,action}),dossier.speechSamples.length ? h('section',null,h('h4',null,'说话样本'),h(Evidence,{rows:dossier.speechSamples,action})) : null,
 dossier.leads.length ? h('section',null,h('h4',null,'待核实公开线索'),h(Evidence,{rows:dossier.leads,action})) : null,
 dossier.missing.length ? h('small',null,`资料缺口：${dossier.missing.map(key=>PERSON_FACETS[key]).join('、')}`) : null,
 null);
}
export function Relations({person,edge,graph,action}){
 const names=new Map(graph.entities.map(n=>[n.id,n.name]));
 if(edge)return h('div',null,h(Group,{gap:6},[edge.from,edge.to].map(id=>h(Button,{key:id,variant:'subtle',onClick:()=>action({type:'select',selection:{kind:'entity',id}})},names.get(id)))),h('h4',null,`${edge.negative ? '不是' : ''}${edge.predicate} · ${RELATIONSHIP_STATUS_LABELS[edge.status]}`),h(Evidence,{rows:edge.evidence,action}));
 if(!person)return empty('点选一个人物查看直接关系，或点选连线核对原话。');
 const edges=graph.relations.filter(r=>r.from===person.id || r.to===person.id);
 return h('div',{className:'network-relation-list'},edges.length ? edges.map(r=>h(Button,{key:r.id,variant:'light',fullWidth:true,onClick:()=>action({type:'select',selection:{kind:'relation',id:r.id}})},h('span',null,h('strong',null,`${names.get(r.from)} ${r.symmetric ? '↔' : '→'} ${names.get(r.to)}`),h('small',null,`${r.negative ? '不是' : ''}${r.predicate} · ${RELATIONSHIP_STATUS_LABELS[r.status]} · ${r.evidence?.length || 0} 条证据`)))) : empty('当前筛选下没有明确的直接关系。'),h(Evidence,{rows:person.evidence,action}));
}
export function Questions({view,action,person}){
 const input=useRef(null);useEffect(()=>{input.current?.focus({preventScroll:true});},[]);
 return h('div',{className:'network-questions'},h(NativeSelect,{label:'问答范围',value:view.questionScope,data:options({single:'选中人物 / 关系两端',group:'多人对比（最多6人）',global:'全局人物与关系'}),onChange:e=>action({type:'questionScope',value:e.currentTarget.value})}),
 view.questionScope==='group' ? h(MultiSelect,{label:'参与问答的人物',placeholder:'搜索并选择人物',searchable:true,maxValues:6,comboboxProps:{withinPortal:false},value:view.people,data:view.graph.entities.map((n,i)=>({value:n.id,label:`${n.name} · ${n.role} · ${i+1}`})),onChange:value=>action({type:'people',value})}) : null,
 h('small',null,view.questionScope==='global' ? '综合已保存的全局人物资料；结果受可用证据与检索预算限制。' : person ? `围绕「${person.name}」梳理，按来源区分事实与线索。` : '请先选择人物或关系，或切换到全局问答。'),
 h(Group,{gap:6},['综合人物画像与资料缺口','梳理直接关系与时间变化','比较兴趣与互动差异','有哪些矛盾或未知'].map(text=>h(Button,{key:text,size:'xs',variant:'light',onClick:()=>action({type:'question',value:text})},text))),
 h(Textarea,{ref:input,label:'关系问题',placeholder:'例如：综合画像、关系变化与原文依据，有哪些待核实内容？',value:view.question,maxLength:1000,autosize:true,minRows:2,maxRows:5,onChange:e=>action({type:'question',value:e.currentTarget.value})}),
 h(Group,{gap:6},h(Button,{onClick:()=>action({type:'ask'}),loading:view.answering,disabled:!view.question.trim()},'后台深度分析'),view.answering ? h(Button,{variant:'subtle',onClick:()=>action({type:'cancel'})},'取消') : null),
 h('p',{role:'status',className:'network-question-status'},view.questionStatus),
 view.trace?.length ? h('section',null,h('h4',null,'实际研究步骤'),h('ol',{className:'network-research-trace'},view.trace.map((r,i)=>h('li',{key:i},h('time',null,at(r.at)),r.detail || r.step)))) : null,
 view.answer ? h('article',{className:'network-answer'},h('small',null,`${at(view.answer.at)} · ${view.answer.names.length ? view.answer.names.join('、') : '全局资料'}`),h('h4',null,view.answer.question),h('p',null,view.answer.answer),h('h4',null,'本次提供的关系依据'),h(Evidence,{rows:view.answer.relations.flatMap(r=>r.evidence || []),action}),view.answer.sources?.length ? h('section',{className:'network-source-list'},h('h4',null,'本次检索来源'),view.answer.sources.map((row,i)=>h('p',{key:i},h('a',{href:row.url,target:'_blank',rel:'noopener noreferrer'},`${row.index || i+1}. ${row.title || row.url}`)))) : null) : null);
}

function Metrics({rows}){return h('div',{className:'network-metrics'},rows.map(([label,value])=>h('div',{key:label},h('strong',null,value),h('small',null,label))));}
export function Overview({graph,person,action}){
 const insight=networkInsights(graph,person?.id);
 return h('section',{className:'network-overview','aria-label':person ? '人物画像概览' : '全局资料概览'},
 h(Metrics,{rows:person ? [['直接关联',insight.neighbors],['原始记录',insight.records],['画像维度',`${insight.dimensions.length}/${Object.keys(PERSON_FACETS).length}`]] : [['人物',insight.people],['关系',insight.relations],['来源',insight.sources]]}),
 person ? h('section',null,h('h4',null,'画像维度 · 已有资料 / 待补充'),h('div',{className:'network-dimensions'},Object.entries(PERSON_FACETS).map(([key,label])=>h('span',{key,'data-known':insight.dimensions.includes(key)},`${insight.dimensions.includes(key) ? '●' : '○'} ${label}`)))) : h(Group,{gap:6},Object.entries(insight.roles).map(([role,count])=>h(Badge,{key:role,variant:'light'},`${role} ${count}`))),
 h('h4',null,'关系证据分布'),h('div',{className:'network-trust-bars'},Object.entries(RELATIONSHIP_STATUS_LABELS).map(([key,label])=>h('div',{key,style:{'--network-color':NETWORK_COLORS[key]}},h('span',null,label),h('meter',{min:0,max:Math.max(1,insight.relations),value:insight.statuses[key] || 0,'aria-label':label}),h('span',null,insight.statuses[key] || 0)))),
 h('h4',null,'最近证据时间线'),insight.timeline.length ? h('ol',{className:'network-timeline'},insight.timeline.map((r,i)=>h('li',{key:i},h('small',null,`${at(r.at)} · ${r.source}`),h('p',null,r.text),r.recordId ? h(Button,{variant:'subtle',size:'xs',onClick:()=>action({type:'original',recordId:r.recordId})},'查看完整原文') : null))) : empty('暂无带时间的证据。'),
 h('small',null,`覆盖 ${insight.sources} 种来源 · ${insight.rooms} 个房间；仅统计本次提供的资料，维度覆盖不代表可信度。`));
}
export function PersonFloat({person,graph,people=[],action,onClose}){
 const insight=networkInsights(graph,person.id),facts=person.dossier?.facets.slice(0,2) || [];
 const open=tab=>action({type:'inspectorTab',value:tab});
 return h('section',{key:person.id,className:'network-person-float','aria-label':`${person.name}人物速览`,onKeyDown:e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();}}},
 h('header',null,h('strong',null,person.name),h(Button,{style:{color:'#d2f7ff'},className:'network-float-close',variant:'subtle','aria-label':'关闭人物速览',onClick:onClose},'×')),
 h('small',null,`${person.role || '人物提及'}${person.aliases?.length ? ` · 别名 ${person.aliases.join('、')}` : ''}`),
 h('small',{className:'network-float-stats'},`${insight.neighbors} 直接关联 · ${insight.records} 记录 · ${insight.dimensions.length} 画像维度`),
 facts.length ? facts.map((r,i)=>h('p',{key:i},`${PERSON_FACETS[r.category]}：${r.text.length>90 ? `${r.text.slice(0,90)}…` : r.text}`)) : h('p',null,'档案待补充，可先核对关系或向 AI 提问。'),
 h(Group,{gap:4},h(Button,{style:{color:'#d2f7ff'},variant:'light',onClick:()=>open('dossier')},'查看档案'),h(Button,{style:{color:'#d2f7ff'},variant:'light',onClick:()=>{action({type:'questionScope',value:'single'});open('questions');}},'问这个人'),h(Button,{style:{color:'#d2f7ff'},variant:'subtle',onClick:()=>{action({type:'people',value:[...new Set([...people,person.id])]});action({type:'questionScope',value:'group'});open('questions');}},'加入对比')));
}
