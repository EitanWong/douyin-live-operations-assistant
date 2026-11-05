export const clamp=(n,low=0,high=1)=>Math.max(low,Math.min(high,n));
export const mean=rows=>rows.length ? rows.reduce((s,x)=>s+x,0)/rows.length : 0;
export const variance=rows=>{const m=mean(rows);return rows.length>1 ? rows.reduce((s,x)=>s+(x-m)**2,0)/(rows.length-1) : 0;};
export const quantile=(sorted,q)=>{const p=(sorted.length-1)*q,i=Math.floor(p);return sorted.length ? sorted[i]+(sorted[Math.ceil(p)]-sorted[i])*(p-i) : null;};
export function distribution(values){const v=[...values].sort((a,b)=>a-b);return {point:quantile(v,.5),low:quantile(v,.1),high:quantile(v,.9)};}
export function random(seed){let n=2166136261;for(const c of String(seed))n=Math.imul(n^c.charCodeAt(0),16777619);return ()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
export const normal=r=>Math.sqrt(-2*Math.log(Math.max(1e-12,r())))*Math.cos(2*Math.PI*r());
export function gamma(shape,rate,r){
 if(shape<1)return gamma(shape+1,rate,r)*r()**(1/shape);
 const d=shape-1/3,c=1/Math.sqrt(9*d);
 for(let i=0;i<100;i++){const x=normal(r),v=(1+c*x)**3,u=r();if(v>0 && (u<1-.0331*x**4 || Math.log(u)<.5*x*x+d*(1-v+Math.log(v))))return d*v/rate;}
 return shape/rate;
}
export function poisson(lambda,r){
 if(lambda>40)return Math.max(0,Math.round(lambda+Math.sqrt(lambda)*normal(r)));
 let k=0,p=1;const stop=Math.exp(-lambda);do{k++;p*=r();}while(p>stop && k<1000);return k-1;
}
export function compound(lambda,amounts,r){
 const n=poisson(lambda,r),m=mean(amounts);
 if(n>80)return Math.max(0,n*m+Math.sqrt(n*variance(amounts))*normal(r));
 let value=0;for(let i=0;i<n;i++)value+=amounts[Math.floor(r()*amounts.length)];return value;
}
export const sigmoid=x=>1/(1+Math.exp(-clamp(x,-30,30)));
export function featureVector(user,at,pk=false){return [1,clamp(Math.log1p(user.giftGroups || 0)/5),user.lastGiftAt && at-user.lastGiftAt<300000 ? 1:0,clamp(Math.log1p(user.chats || 0)/5),user.intent==='support' ? 1:0,pk ? 1:0];}
export function giftProbability(model,x){const base=(model.positives+1)/(model.trials+2),offset=Math.log(base/(1-base));return sigmoid(offset+x.reduce((s,v,i)=>s+v*(model.weights?.[i] || 0),0));}
export function learnGift(model,x,y,issuedProbability){
 model.trials ||=0;model.positives ||=0;model.weights ||=Array(6).fill(0);model.brier ||=0;model.buckets ||=Array.from({length:10},()=>({n:0,sum:0,positive:0}));
 const p=giftProbability(model,x),rate=.05/Math.sqrt(1+model.trials/100);
 model.weights=model.weights.map((w,i)=>clamp(w+rate*((y-p)*x[i]-.01*w),-5,5));
 const evaluated=Number.isFinite(issuedProbability)?clamp(issuedProbability):p;
 model.brier+=(evaluated-y)**2;const bucket=model.buckets[Math.min(9,Math.floor(evaluated*10))];bucket.n++;bucket.sum+=evaluated;bucket.positive+=y;
 model.trials++;model.positives+=y;return model;
}
