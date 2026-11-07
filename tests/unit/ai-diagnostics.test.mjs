import {test} from 'node:test';
import assert from 'node:assert/strict';
import {aiDiagnostics} from '../../src/ai/diagnostics.js';
import {mergeConfig} from '../../src/core/engine.js';

test('AI诊断报告实际运行配置、已到期知识与有界来源，不能泄露人物事实或凭据',()=>{
 const now=Date.parse('2026-11-02T15:00:00Z');
 const config=mergeConfig({ai:{enabled:true,assistant:{memoryEnabled:false},memory:{entries:[{id:'old',title:'资料',content:'不要暴露的个人资料',source:'秘密',updatedAt:now,expiresOn:'2026-11-01',enabled:true}]}}});
 const rows=aiDiagnostics({config,context:{context:[{text:'不要暴露的弹幕'}],mediaContext:null},mediaState:'idle',memoryCount:2,knownGaps:3,now});
 const text=rows.join('\n');assert.match(text,/已保存/);assert.match(text,/过期 1/);assert.match(text,/观众记忆.*开启.*2/);assert.match(text,/缺口 3/);assert.match(text,/未开启/);
 assert.doesNotMatch(text,/个人资料|秘密|不要暴露的弹幕|Bearer|api-key/);
});

test('诊断区分感知已接入和模型结果已完成，不把空观察当作实时感知成功',()=>{
 const config=mergeConfig(),base={config,context:{context:[],mediaContext:{coverage:'no-current-observation',observations:[]}},mediaState:'running',memoryCount:0,knownGaps:0,now:Date.now()};
 assert.match(aiDiagnostics(base).join('\n'),/等待.*观察/);
 assert.match(aiDiagnostics({...base,context:{...base.context,mediaContext:{coverage:'realtime-native-stream',observations:[{text:'不回显媒体正文'}]}}}).join('\n'),/完成观察 1/);
});
