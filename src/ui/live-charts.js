import { init, use } from 'echarts/core.js';
import { LineChart, BarChart } from 'echarts/charts.js';
import { GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, AriaComponent } from 'echarts/components.js';
import { SVGRenderer } from 'echarts/renderers.js';

use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, AriaComponent, SVGRenderer]);
const clock = new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
const number = value => Number.isFinite(value) ? value : null;

function scorePoints(samples) {
  const byTime = new Map();
  for (const point of samples) {
    if (!Number.isFinite(point.at)) continue;
    const previous = byTime.get(point.at);
    // 同一时间戳可能有多帧增量更新。轴提示会为每个相同 x 的样本生成
    // 一行，先合并为该时刻最新已知值，避免每位主播在提示里出现多次。
    byTime.set(point.at, {
      at:point.at,
      selfScore:number(point.selfScore) ?? previous?.selfScore ?? null,
      opponentScore:number(point.opponentScore) ?? previous?.opponentScore ?? null,
      competitorScores:{...previous?.competitorScores, ...Object.fromEntries(Object.entries(point.competitorScores || {}).filter(([,score])=>Number.isFinite(score)))}
    });
  }
  return [...byTime.values()].sort((left,right)=>left.at-right.at);
}

// Chart options are shared by the panel and its local preview. Missing sides
// remain null: a missing observation must never be plotted as a zero score.
export function pkChartOptions(data, {windowMs = 180000, now = Date.now(), widths = {}, colors = {self:'#006d70',opponent:'#c91d43',text:'#60636d',line:'#e2e3e6'}} = {}) {
  const all = scorePoints(data.trend || data.history?.filter(item=>item.kind === 'score') || []);
  const cutoff = windowMs ? now-windowMs : -Infinity;
  const before = all.filter(item=>item.at < cutoff).at(-1);
  const points = [...(before ? [before] : []), ...all.filter(item=>item.at >= cutoff)];
  const base = {
    animation:false, color:[colors.self,colors.opponent],
    textStyle:{color:colors.text,fontFamily:'"PingFang SC","Microsoft YaHei",sans-serif',fontSize:10},
    aria:{enabled:true,label:{description:'直播观测数据图表。详细数值可在下方数据明细中查看。'},decal:{show:false}},
    grid:{left:8,right:12,top:32,bottom:8,containLabel:true},
    tooltip:{trigger:'axis',renderMode:'richText',confine:true,valueFormatter:value=>Number.isFinite(value) ? value.toLocaleString('zh-CN') : '未观测'},
    legend:{top:0,left:0,itemWidth:16,itemHeight:3,textStyle:{color:colors.text,fontSize:11}},
    xAxis:{type:'time',min:points[0]?.at,max:Math.max(points.at(-1)?.at || now,points[0]?.at+1000 || now),axisLabel:{color:colors.text,hideOverlap:true,formatter:value=>clock.format(value)},axisLine:{lineStyle:{color:colors.line}},splitLine:{show:false}},
    yAxis:{type:'value',axisLabel:{color:colors.text,formatter:value=>Math.abs(value)>=10000 ? `${+(value/10000).toFixed(1)}万` : value},splitLine:{lineStyle:{color:colors.line,type:'dashed'}}}
  };
  const line = (name, values, extra={}) => ({name,type:'line',data:values,showSymbol:points.length<3,symbolSize:5,connectNulls:false,lineStyle:{width:2},...extra});
  const competitors=data.competitors || [];
  const multi=competitors.length>=3;
  const palette=['#007f78','#c4475b','#4267a8','#aa6b16','#7954a1','#277f9e','#b1458d','#6c7d21'];
  const scores = {...base,legend:multi?{...base.legend,type:'scroll',left:0,right:0}:base.legend,series:multi
    ? competitors.map((item,index)=>line(item.name || (item.anchorId===data.anchorId?'己方':item.anchorId),points.map(p=>[p.at,number(p.competitorScores?.[item.anchorId])]),{step:'end',itemStyle:{color:palette[index%palette.length]},lineStyle:{width:item.anchorId===data.anchorId?3:2,type:item.anchorId===data.anchorId?'solid':'dashed'}}))
    : [line('己方比分',points.map(p=>[p.at,number(p.selfScore)]),{step:'end'}),line('对方比分',points.map(p=>[p.at,number(p.opponentScore)]),{step:'end',lineStyle:{width:2,type:'dashed'}})]};
  const gap = {...base,legend:{show:false},series:[line('己方分差',points.map(p=>[p.at,!multi&&Number.isFinite(p.selfScore)&&Number.isFinite(p.opponentScore) ? p.selfScore-p.opponentScore : null]),{step:'end',areaStyle:{opacity:.08},markLine:{silent:true,symbol:'none',label:{show:false},lineStyle:{color:colors.text,type:'dashed'},data:[{yAxis:0}]}})]};
  const users = [...(data.selfUsers || []).map(user=>({...user,side:'己方',color:colors.self})),...(data.opponentUsers || []).map(user=>({...user,side:'对方',color:colors.opponent}))]
    .filter(user=>Number.isFinite(user.score) && user.score>0).sort((a,b)=>b.score-a.score).slice(0,8).reverse();
  const contributions = {...base,legend:{show:false},grid:{left:0,right:44,top:8,bottom:8,containLabel:true},
    xAxis:{type:'value',axisLabel:{color:colors.text},splitLine:{lineStyle:{color:colors.line,type:'dashed'}}},
    yAxis:{type:'category',data:users.map(user=>`${user.side} · ${String(user.name || user.id || '观众').slice(0,10)}`),axisLabel:{color:colors.text,width:110,overflow:'truncate'},axisTick:{show:false},axisLine:{show:false}},
    series:[{name:'已观测贡献分',type:'bar',barMaxWidth:16,label:{show:true,position:'right',color:colors.text,fontSize:10},data:users.map(user=>({value:user.score,itemStyle:{color:user.color,borderRadius:[0,3,3,0]}}))}]
  };
  const buckets=data.activity?.buckets || [], activityPoints=[];
  if(buckets.length)for(let at=Math.max(buckets[0].at,Math.floor((now-590000)/10000)*10000);at<=now;at+=10000)activityPoints.push(buckets.find(item=>item.at===at) || {at,chat:0,enter:0,gift:0});
  const activity={...base,color:[colors.self,colors.opponent,colors.text],legend:{...base.legend,itemHeight:8},xAxis:{...base.xAxis,min:activityPoints[0]?.at,max:now},series:[['chat','弹幕'],['enter','进场'],['gift','礼物件数']].map(([field,name])=>line(name,activityPoints.map(item=>[item.at,item[field]]),{smooth:false}))};
  // Density follows each plot's available area, not the browser viewport. A wide
  // dashboard can still contain a narrow secondary plot.
  for (const [name, option] of Object.entries({scores,gap,activity})) {
    const width = widths[name] || 480;
    option.xAxis = {...option.xAxis,splitNumber:width < 360 ? 2 : width < 600 ? 4 : 6};
    option.yAxis = {...option.yAxis,splitNumber:4};
    option.legend = {...option.legend,type:'scroll',right:0};
  }
  contributions.yAxis.axisLabel.width = (widths.contributions || 480) < 360 ? 76 : 110;
  contributions.xAxis.splitNumber = (widths.contributions || 480) < 360 ? 2 : 4;
  return {scores,gap,contributions,activity,pointCount:points.length,gapCount:points.filter(point=>Number.isFinite(point.selfScore)&&Number.isFinite(point.opponentScore)).length,contributorCount:users.length,activityCount:activityPoints.length};
}

export class LiveCharts {
  constructor(root) {
    this.root=root;this.instances=new Map();this.windowMs=180000;this.lastRender=0;
    const view=root.host.ownerDocument.defaultView;
    this.view=view;
    if (view.ResizeObserver) {
      this.observer=new view.ResizeObserver(()=>this.queueResize());
      for(const element of root.querySelectorAll('[data-pk-chart]'))this.observer.observe(element);
    }
    this.themeObserver=new view.MutationObserver(()=>{this.lastSignature='';if(this.lastData)this.render(this.lastData,true);});
    this.themeObserver.observe(root.host,{attributes:true,attributeFilter:['data-theme']});
    this.media=view.matchMedia?.('(prefers-color-scheme: dark)');
    this.onTheme=()=>{this.lastSignature='';if(this.lastData)this.render(this.lastData,true);};this.media?.addEventListener('change',this.onTheme);
  }
  render(data, force=false) {
    this.lastData=data;
    const target=this.root.querySelector('[data-pk-chart="scores"]');
    // No chart work in a hidden tab, collapsed panel or DOM-only tests.
    if (!target.closest('[data-page]').getBoundingClientRect().width) return;
    if(!force && Date.now()-this.lastRender<750) {
      if(!this.timer)this.timer=this.view.setTimeout(()=>{this.timer=null;this.render(this.lastData,true);},750-(Date.now()-this.lastRender));
      return;
    }
    const signature=`${data.key}:${data.lastScoreAt}:${data.dataQuality?.events}:${this.windowMs}:${Math.floor(Date.now()/1000)}`;
    if (!force && signature===this.lastSignature) return;
    this.lastSignature=signature;this.lastRender=Date.now();
    const style=this.view.getComputedStyle(this.root.host);
    const widths=Object.fromEntries([...this.root.querySelectorAll('[data-pk-chart]')].map(element=>[element.dataset.pkChart,element.clientWidth]));
    const options=pkChartOptions(data,{windowMs:this.windowMs,widths,colors:{self:style.getPropertyValue('--sg-success').trim(),opponent:style.getPropertyValue('--sg-brand').trim(),text:style.getPropertyValue('--sg-muted').trim(),line:style.getPropertyValue('--sg-border').trim()}});
    for(const name of ['scores','gap','contributions','activity']) {
      const element=this.root.querySelector(`[data-pk-chart="${name}"]`);
      const count=name==='contributions' ? options.contributorCount : name==='activity' ? options.activityCount : name==='gap' ? options.gapCount : options.pointCount;
      element.hidden=!count;
      element.nextElementSibling.hidden=Boolean(count);
      if(!count) {
        this.instances.get(name)?.dispose(); this.instances.delete(name);
        continue;
      }
      if(!element.clientWidth || !element.clientHeight)continue;
      try {
        let chart=this.instances.get(name);
        if(!chart) {chart=init(element,null,{renderer:'svg'});this.instances.set(name,chart);}
        // With notMerge, lazyUpdate swaps the model before replacing the old
        // graphics. A mousemove in that frame can call getDataParams on a new
        // series whose data has not been prepared yet (getRawIndex throws).
        chart.setOption(options[name],{notMerge:true,lazyUpdate:false});chart.resize();
      } catch {
        this.instances.get(name)?.dispose(); this.instances.delete(name);
        element.hidden=true;element.nextElementSibling.hidden=false;
        element.nextElementSibling.textContent='图表暂不可用，可展开下方数据明细查看。';
      }
    }
  }
  queueResize() {
    if(this.resizeFrame)return;
    this.resizeFrame=this.view.requestAnimationFrame(()=>{
      this.resizeFrame=null;
      for(const [name,chart] of this.instances) {
        const element=this.root.querySelector(`[data-pk-chart="${name}"]`);
        if(element.clientWidth && element.clientHeight)chart.resize();
      }
      // Resizing stays direct. Rebuild data/axis density after the gesture rests.
      this.view.clearTimeout(this.resizeTimer);
      this.resizeTimer=this.view.setTimeout(()=>{if(this.lastData)this.render(this.lastData,true);},120);
    });
  }
  resize() {this.queueResize();if(this.lastData)this.render(this.lastData,true);}
  destroy() {this.view.clearTimeout(this.timer);this.view.clearTimeout(this.resizeTimer);this.view.cancelAnimationFrame(this.resizeFrame);this.observer?.disconnect();this.themeObserver.disconnect();this.media?.removeEventListener('change',this.onTheme);for(const chart of this.instances.values())chart.dispose();this.instances.clear();}
}
