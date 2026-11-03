const n=value=>Number.isFinite(value)?value:null;
const line=(name,data,extra={})=>({name,type:'line',data,showSymbol:false,connectNulls:false,lineStyle:{width:2},...extra});
const date=value=>new Date(value).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'});
const colors=['#0a8f80','#8c65d5','#d45f78','#c28b29','#4c83b9'];
function base(unit,time=true){return {animation:false,color:colors,aria:{enabled:true},textStyle:{fontFamily:'PingFang SC,Microsoft YaHei,sans-serif',fontSize:11},tooltip:{trigger:'axis',confine:true,renderMode:'richText'},legend:{type:'scroll',top:0,left:0,right:0,textStyle:{fontSize:11}},grid:{left:14,right:16,top:52,bottom:12,containLabel:true},xAxis:{type:time?'time':'category',axisLabel:{hideOverlap:true,...(time?{formatter:date}:{})},splitLine:{show:false}},yAxis:{type:'value',name:unit,splitNumber:4,splitLine:{lineStyle:{type:'dashed',opacity:.3}}}};}
function band(lower,upper){return [line('80%区间下界',lower,{stack:'band',lineStyle:{opacity:0},symbol:'none',tooltip:{show:false}}),line('80%模型区间',upper.map((p,i)=>[p[0],p[1]==null?null:p[1]-lower[i][1]]),{stack:'band',lineStyle:{opacity:0},itemStyle:{color:colors[1]},areaStyle:{color:colors[1],opacity:.13},symbol:'none',tooltip:{show:false}})];}
function timeline(rows,value,stamp=row=>row.at){const result=[];rows.forEach((row,i)=>{if(i && row.at-rows[i-1].at>60000)result.push([rows[i-1].at+60000,null]);result.push([stamp(row),value(row)]);});return result;}
function revenue(r){
 const rows=r.timeline || [],total=rows.reduce((s,row)=>s+(row.diamonds || 0),0);let accumulated=Math.max(0,(r.observedDiamonds || 0)-total);
 const actual=timeline(rows,row=>{accumulated+=row.diamonds || 0;return row.coverageMs>=54000?accumulated:null;},row=>Math.min(r.asOf,row.at+60000));
 const end=r.asOf+300000,observed=r.observedDiamonds || 0,flow=r.flow || {},ready=flow.status==='ready';
 const mid=[[r.asOf,observed],[end,ready?observed+flow.point:null]],low=[[r.asOf,observed],[end,ready?observed+flow.low:null]],high=[[r.asOf,observed],[end,ready?observed+flow.high:null]];
 return {...base('钻石'),series:[line('已采集累计钻石',actual),...band(low,high),line('未来5分钟累计中位数',mid,{lineStyle:{type:'dashed',width:2},itemStyle:{color:colors[1]}})]};
}
function online(r){
 const rows=r.timeline || [],last=rows.filter(row=>row.online!=null && row.onlineAt<=r.asOf).at(-1),forecast=(r.online || []).filter(row=>row.status==='ready');
 const start=[r.asOf,forecast.length?last?.online ?? null:null],series=forecast.map(row=>[r.asOf+row.horizonMinutes*60000,row.point]),low=[start,...forecast.map(row=>[r.asOf+row.horizonMinutes*60000,row.low])],high=[start,...forecast.map(row=>[r.asOf+row.horizonMinutes*60000,row.high])];
 return {...base('人'),series:[line('已观察在线人数',timeline(rows,row=>n(row.online),row=>row.onlineAt || row.at)),...band(low,high),line('预测中位数',[start,...series],{lineStyle:{type:'dashed',width:2},itemStyle:{color:colors[1]}})]};
}
export function predictionChartOptions(r){
 const rows=r.timeline || [],activity={...base('次 / 分钟'),series:[['chats','弹幕'],['enters','进场'],['giftUnits','礼物件数']].map(([field,name])=>line(name,timeline(rows,row=>row.coverageMs>=54000?n(row[field]):null)))};
 const contributors=(r.thousand?.rows || []).slice(0,10).reverse(),contribution={...base('钻石',false),legend:{show:false},xAxis:{type:'value'},yAxis:{type:'category',data:contributors.map(row=>String(row.name || '昵称未知').slice(0,16)),axisLabel:{width:90,overflow:'truncate'}},series:[{name:'已识别观众本场贡献',type:'bar',barMaxWidth:18,data:contributors.map(row=>row.observed)}]};
 const intents=Object.entries(r.semantics?.intents || {}),labels={support:'明确支持',decline:'拒绝消费',leave:'离开',question:'提问',other:'其他'},semantics={...base('条',false),legend:{show:false},xAxis:{type:'category',data:intents.map(([key])=>labels[key] || key),axisLabel:{interval:0}},series:[{name:'已观察弹幕意图',type:'bar',barMaxWidth:28,data:intents.map(([,value])=>value)}]};
 const buckets=(r.evaluation?.buckets || []).filter(b=>b.n),calibration={...base('实际送礼比例',false),xAxis:{type:'value',min:0,max:1,name:'预测概率',axisLabel:{formatter:v=>`${Math.round(v*100)}%`}},yAxis:{type:'value',min:0,max:1,axisLabel:{formatter:v=>`${Math.round(v*100)}%`}},series:[line('理想校准',[[0,0],[1,1]],{lineStyle:{type:'dashed',color:'#9b9b9b'}}),line('实测概率桶',buckets.map(b=>[b.sum/b.n,b.positive/b.n]),{showSymbol:true,symbolSize:7})]};
 const grouped=new Map();for(const s of r.sessions || []){if(!s.complete || !(s.endAt>s.startAt))continue;const hour=new Date(s.startAt+8*3600000).getUTCHours(),v=grouped.get(hour) || {diamonds:0,hours:0,n:0};v.diamonds+=s.diamonds;v.hours+=(s.endAt-s.startAt)/3600000;v.n++;grouped.set(hour,v);}
 const hourly={...base('钻石 / 小时',false),legend:{show:false},xAxis:{type:'category',data:Array.from({length:24},(_,i)=>`${i}时`)},series:[{name:'按开播小时分组的小时收益',type:'bar',data:Array.from({length:24},(_,i)=>{const g=grouped.get(i);return g?{value:g.diamonds/g.hours,name:`${g.n}场完整直播`}:null;}),barMaxWidth:18}]};
 const charts={revenue:revenue(r),online:online(r),activity,contribution,semantics,calibration,hourly};
 const descriptions={revenue:'钻石累计趋势：实线为已采集金额，虚线为未来5分钟累计中位数，阴影为80%模型区间。缺测处断开，金额明细见本节统计。',online:'在线人数趋势：实线为已观察在线人数，虚线为未来1、5、15分钟预测，阴影为80%模型区间。数据不足或过期时不显示预测。',activity:'互动频率：每分钟弹幕、进场和礼物件数，缺少完整采集的分钟不作零值展示。',contribution:'本场已识别观众贡献前十，单位为钻石；仅代表已采集事件，明细见本节贡献榜。',semantics:'已观察弹幕的规则意图分布，包括明确支持、拒绝消费、离开、提问和其他；不代表真实心理。',calibration:'送礼概率校准：横轴为预测概率，纵轴为后续实际送礼比例，虚线为理想校准；只有成熟观察窗口进入统计。',hourly:'按开播小时分组的完整场次小时收益，单位为钻石每小时；未采集时段不填零，各组按实际开播时长加权。'};
 for(const [key,option] of Object.entries(charts)){
  option.aria.label={description:descriptions[key]};
  if(key==='revenue' || key==='online')option.legend.data=option.series.filter(s=>s.name!=='80%区间下界').map(s=>s.name);
 }
 return charts;
}
export class PredictionCharts{
 constructor(root){this.root=root;this.options={};}
 render(report){
  this.options=predictionChartOptions(report);
  const style=this.root.ownerDocument.defaultView.getComputedStyle(this.root.host || this.root.documentElement),text=style.getPropertyValue('--ink').trim() || '#727781';
  for(const option of Object.values(this.options)){option.textStyle={...option.textStyle,color:text};option.legend={...option.legend,textStyle:{color:text,fontSize:11}};for(const axis of [option.xAxis,option.yAxis]){axis.axisLabel={...axis.axisLabel,color:text};axis.nameTextStyle={color:text};}}
  // The visible React workspace owns ECharts instances, hover and resize.
  // Plain source controls retain an accessible fallback and data tables.
  for(const element of this.root.querySelectorAll('[data-pred-chart]'))element.textContent='交互图表的数据明细见本节统计与分析档案。';
 }
 clear(){this.options={};}
 destroy(){this.clear();}
}
