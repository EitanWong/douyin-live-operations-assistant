const number='-?\\d{1,20}(?:\\.\\d{1,8})?';
const arithmetic=new RegExp(`^(${number})(乘以|乘|×|\\*|除以|除|÷|/|加上|加|\\+|减去|减|-)(${number})(?:等于多少|是多少|等于几|等于|多少|结果是什么)?$`,'u');
const comparison=new RegExp(`^(${number})(?:和|与|、|,|，)(${number})(?:哪个|哪一个|谁)(?:更|比较)?(大|小)$`,'u');
function decimal(text){const [whole,fraction='']=text.split('.');return {digits:BigInt(whole+fraction),scale:fraction.length};}
function format(digits,scale){
 const negative=digits<0n,raw=(negative ? -digits : digits).toString().padStart(scale+1,'0');
 const value=scale ? `${raw.slice(0,-scale)}.${raw.slice(-scale)}`.replace(/0+$/u,'').replace(/\.$/u,'') : raw;
 return `${negative && digits!==0n ? '-' : ''}${value}`;
}
function divide(a,b){
 if(b.digits===0n)return null;
 let numerator=a.digits*10n**BigInt(b.scale),denominator=b.digits*10n**BigInt(a.scale),scale=0;
 while(numerator%denominator!==0n && scale<12){numerator*=10n;scale++;}
 return numerator%denominator===0n ? format(numerator/denominator,scale) : null;
}
// Only complete, unambiguous arithmetic questions enter this tool. No eval,
// live metrics, conversions, multi-step instructions or inferred operands.
export function calculateQuestion(question){
 const text=question.trim().replace(/^@\S+\s+/u,'').replace(/^请(?:问|计算|算一下)?/u,'').replace(/[？?。！!\s]/gu,'').replace(/直接给出结果$/u,'');
 const compared=comparison.exec(text),computed=arithmetic.exec(text);
 if(!compared && !computed)return null;
 const a=decimal((compared || computed)[1]),b=decimal((compared || computed)[compared ? 2 : 3]),scale=Math.max(a.scale,b.scale);
 const left=a.digits*10n**BigInt(scale-a.scale),right=b.digits*10n**BigInt(scale-b.scale);
 if(compared){
  const relation=left===right ? 'equal' : compared[3]==='大' ? 'greater' : 'less';
  const selected=left===right || (compared[3]==='大' ? left>right : left<right) ? a : b,value=format(selected.digits,selected.scale);
  return {kind:'comparison',value,relation,answer:relation==='equal' ? `两者相等，都是${value}。` : `${value}更${compared[3]}。`};
 }
 const op=computed[2];let value;
 if(['加上','加','+'].includes(op))value=format(left+right,scale);
 else if(['减去','减','-'].includes(op))value=format(left-right,scale);
 else if(['乘以','乘','×','*'].includes(op))value=format(a.digits*b.digits,a.scale+b.scale);
 else value=divide(a,b);
 return value===null ? null : {kind:'arithmetic',value,answer:`结果是${value}。`};
}
