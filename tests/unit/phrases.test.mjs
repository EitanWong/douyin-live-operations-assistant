import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, copy, mergeConfig, validateConfig, renderTemplate } from '../../src/core/engine.js';
import { DEFAULT_PHRASES, DEFAULT_TIMER_PHRASES, DEFAULT_KEYWORD_RULES } from '../../src/core/phrases.js';
import { LEGACY_PHRASES, LEGACY_TIMER_PHRASES, PREVIOUS_DEFAULT_PHRASES } from '../../src/core/legacy-phrases.js';

test('旧默认话术自动更新，保留模块开关和定时组参数，不修改输入或共享默认数组', () => {
  const input = copy(DEFAULTS);
  for (const feature of ['gift', 'welcome', 'like']) input[feature].templates = copy(LEGACY_PHRASES[feature]);
  Object.assign(input.timers[0], {enabled:true, intervalSec:720, start:'22:00', end:'02:00', quietSec:60, messages:['喜欢直播内容的朋友，可以点点关注～', '欢迎新来的朋友，一起聊聊吧！']});
  input.keyword.rules = [{keywords:['几点开播'],reply:'{user}，开播时间请看主播主页公告～',exact:false}];
  const before = copy(input), result = validateConfig(mergeConfig(input));
  for (const feature of ['gift', 'welcome', 'like']) {
    assert.deepEqual(result[feature].templates, DEFAULT_PHRASES[feature]);
    assert.equal(result[feature].enabled, input[feature].enabled);
    assert.notEqual(result[feature].templates, DEFAULT_PHRASES[feature]);
  }
  assert.deepEqual(result.timers[0], {...before.timers[0],messages:DEFAULT_TIMER_PHRASES});
  assert.notEqual(result.timers[0].messages, DEFAULT_TIMER_PHRASES);
  assert.deepEqual(result.keyword.rules, DEFAULT_KEYWORD_RULES);
  assert.deepEqual(input, before);
  assert.deepEqual(mergeConfig(result), result);
});

test('改过、重排或清空的话术不会被升级覆盖，自定义 AI 风格也保留', () => {
  const input = copy(DEFAULTS);
  input.gift.templates = [...LEGACY_PHRASES.gift, '谢啦 {user}，欢迎来玩'];
  input.welcome.templates = [...LEGACY_PHRASES.welcome].reverse();
  input.like.templates = []; input.like.enabled = false;
  input.keyword.rules = [{keywords:['几点开播'], reply:'今晚八点开播', exact:true}];
  input.timers[0].messages = ['我们的开场白'];
  input.ai.persona = '说话简单一点';
  assert.deepEqual(mergeConfig(input), input);
});

test('内置话术变量能完整渲染，定时内容和常用昵称下的回复不超过公屏限制', () => {
  const variables = {user:'青山姐',gift:'星星',count:3};
  for (const list of [...Object.values(DEFAULT_PHRASES), DEFAULT_TIMER_PHRASES, DEFAULT_KEYWORD_RULES.map(rule=>rule.reply)]) {
    assert.equal(new Set(list).size, list.length);
    for (const template of list) {
      const text = renderTemplate(template, variables);
      assert.ok(!/\{[a-z]+\}/iu.test(text), text);
      assert.ok([...text].length <= DEFAULTS.sending.maxLength, text);
    }
  }
});

test('各版未修改的定时默认内容均更新，自定义内容和各组参数原样保留', () => {
  const input = copy(DEFAULTS);
  input.timers = LEGACY_TIMER_PHRASES.map((messages, index) => ({...input.timers[0],id:`old-${index}`,enabled:index===0,intervalSec:600+index,messages:copy(messages)}));
  input.timers.push({...input.timers[0],id:'custom',messages:[...LEGACY_TIMER_PHRASES[1],'自己的话术']});
  const before=copy(input), result=mergeConfig(input);
  for (let index=0;index<LEGACY_TIMER_PHRASES.length;index++) assert.deepEqual(result.timers[index],{...before.timers[index],messages:DEFAULT_TIMER_PHRASES});
  assert.deepEqual(result.timers.at(-1),before.timers.at(-1));
  assert.deepEqual(input,before);
});

test('上一版默认招呼更新为简短话术，自定义数组及风格保留',()=>{
  const input=copy(DEFAULTS);
  for (const feature of ['gift','welcome','like']) input[feature].templates=copy(PREVIOUS_DEFAULT_PHRASES[feature]);
  const result=mergeConfig(input);
  for (const feature of ['gift','welcome','like']) assert.deepEqual(result[feature].templates,DEFAULT_PHRASES[feature]);
  input.welcome.templates.push('自定义欢迎');input.ai.persona='自己的语气';
  assert.deepEqual(mergeConfig(input).welcome.templates,input.welcome.templates);
  assert.equal(mergeConfig(input).ai.persona,'自己的语气');
});
