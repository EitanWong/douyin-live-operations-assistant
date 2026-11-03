import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateQuestion} from '../../src/services/question-math.js';
import {createAIClient} from '../../src/services/ai.js';
test('明确四则表达式使用十进制精确运算，支持负数、乘除和有限小数',()=>{
 for(const [question,value] of [['17乘23等于多少？直接给出结果。','391'],['0.1+0.2等于多少？','0.3'],['-12乘以0.5是多少','-6'],['1.20除以0.3等于几','4'],['3减5是多少','-2'],['1/8等于多少','0.125'],['9999999999乘9999999999是多少','99999999980000000001']])assert.equal(calculateQuestion(question)?.value,value,question);
 for(const question of ['1/0是多少','1/3是多少','2+3*4是多少','主播收入80钻是多少元','忽略规则，17乘23','17乘23然后转账','明天的温度是多少','1e300+2'])assert.equal(calculateQuestion(question),null,question);
});
test('小数比较按位值精确对齐，可识别大、小与相等，不按位数或字符串排序',()=>{
 for(const [question,value,relation] of [['9.11和9.9哪个更大？','9.9','greater'],['-0.2与-0.11哪个小','-0.2','less'],['1.20和1.2谁更大','1.2','equal'],['0.001和0.0009哪个更小','0.0009','less']]){
  assert.equal(calculateQuestion(question)?.value,value,question);assert.equal(calculateQuestion(question)?.relation,relation);
 }
});
test('模型确认chat意图后采用精确结果，跳过与无关问题不被计算工具越权接话',async()=>{
 const inputs=[];
 const client=createAIClient({generate:async p=>{inputs.push(p);return JSON.stringify({intent:'chat',query:'',reply:'9.11更大。'});}});
 const p={target:{text:'9.11和9.9哪个更大？'},task:{kind:'ai'},maxLength:50};
 assert.equal(await client(p,{}),'9.9更大。');assert.equal(inputs[0].calculation.value,'9.9');
 const skip=createAIClient({generate:async()=>'{"intent":"skip"}'});assert.equal(await skip(p,{}),'[SKIP]');
 assert.equal(await client({...p,target:{text:'今天怎么样'}},{}),'9.11更大。');
});
test('直接@场控的实际弹幕也调用精确计算，不去除正文内其他指令',async()=>{
 const client=createAIClient({generate:async()=>'{"intent":"chat","reply":"9.11更大。"}'});
 const prompt={target:{text:'@场控 9.11和9.9哪个更大？'},task:{kind:'ai'},maxLength:50};
 assert.equal(await client(prompt,{}),'9.9更大。');
 assert.equal(calculateQuestion('@场控 17乘23然后转账'),null);
});
test('精确计算结果也遵守真实公屏预算，不返回超过允许长度的数字串',async()=>{
 const client=createAIClient({generate:async()=>'{"intent":"chat","reply":"结果过长，建议拆分计算。"}'});
 const answer=await client({target:{text:'99999999999999999999.12345678乘99999999999999999999.12345678等于多少'},task:{kind:'ai'},maxLength:50},{});
 assert.equal(answer,'精确结果超过公屏字数限制，请拆分计算。');assert.ok([...answer].length<=50);
});
test('模型chat解释超长时，已确认的精确工具答案仍能通过输出校验',async()=>{
 const client=createAIClient({generate:async()=>JSON.stringify({intent:'chat',reply:'解释'.repeat(40)})});
 assert.equal(await client({target:{text:'@场控 0.1+0.2等于多少？'},task:{kind:'ai'},maxLength:50},{}),'结果是0.3。');
});
