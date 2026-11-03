export const ADAPTIVE_LAYOUT_CSS = `
/* One reading order, from the live decision to evidence. No duplicated views or
   remounted forms when the user crosses a window-size breakpoint. */
.pk-overview,.pk-workspace,.pk-analysis,.anchor-workspace,.anchor-live-workspace,.settings-workspace,.income-workspace{display:grid;grid-template-columns:minmax(0,1fr);gap:0 24px;align-items:start}
:is(.pk-overview,.pk-workspace,.pk-analysis,.anchor-workspace,.anchor-live-workspace,.settings-workspace,.income-workspace)>*{min-width:0}
.settings-workspace>.workspace-wide{grid-column:1/-1}
.settings-workspace>.settings-column{container:settings-column / inline-size}
@container settings-column (max-width:360px){.grid{grid-template-columns:minmax(0,1fr)}}
.pk-visual{padding-block:16px;border-top:1px solid var(--line)}
.pk-visual>h3{font-size:13px;font-weight:600;margin:0 0 12px}
.pk-visual .pk-chart-head{margin:0 0 12px;min-height:34px}
.adaptive-detail{border-top:1px solid var(--line);padding-block:4px}
.adaptive-detail>summary{font-weight:600;color:var(--ink);min-height:40px;padding-block:10px;box-sizing:border-box}
.adaptive-detail-body{min-width:0;padding-block:4px 12px}
.adaptive-detail-body>.section:first-child{margin-top:0;padding-top:0;border-top:0}
.pk-outlook .pk-reading{margin-top:0}.pk-outlook .pk-prob{margin-block:12px}
.pk-outlook .grid p{margin:4px 0 12px;font-size:12px;font-variant-numeric:tabular-nums}
.pk-outlook .section{padding-top:12px;margin-top:8px}
.pk-gap-visual>summary,.pk-activity-visual>summary{margin-bottom:8px}
.pk-analysis .pk-table{min-width:280px}.pk-analysis .adaptive-detail-body{overflow-x:auto}
.settings-workspace>.hint{grid-column:1/-1}.settings-column>.subhead{margin:14px 0}
.pk-overview-main .status{margin-bottom:10px}.pk-overview-main .pk-verdict{padding-bottom:16px}
.anchor-workspace .anchor-section{min-width:0}.anchor-workspace>.pk-note{grid-column:1/-1}
.income-records .income-toolbar{margin-top:4px}
@container workspace (min-width:720px){
  .scroll{padding:20px 24px}
  .pk-overview{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:28px;margin-bottom:8px}
  .pk-outlook{border-top:0;border-left:1px solid var(--line);padding:0 0 0 24px}
  .pk-outlook>summary{padding-top:0;min-height:28px}
  .pk-outlook .pk-reading strong{font-size:18px}.pk-outlook .pk-prob b{font-size:22px}
  .pk-outlook .pk-reading>div,.pk-outlook .pk-prob>div{padding:8px 0;background:transparent}
  .pk-workspace{grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:0 24px}
  .pk-workspace .pk-chart{height:244px}.pk-workspace .pk-chart-gap{height:244px}
  .pk-workspace .pk-chart-contributions{height:248px}
  .pk-workspace .pk-chart-empty{min-height:180px}
  .pk-analysis,.anchor-workspace,.anchor-live-workspace,.settings-workspace{grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px}
  .anchor-trend-section .stat-bar-track{height:144px}
  .anchor-exhibition-section,.anchor-battles-section{grid-column:1/-1}
  .anchor-workspace .anchor-battles-section .pk-data-scroll{max-height:400px}
  .anchor-metrics b{font-size:28px}.anchor-metrics>div{padding-block:18px}
  .anchor-views{max-width:400px}
  .anchor-controls{display:grid;grid-template-columns:minmax(240px,.8fr) minmax(0,1.6fr);gap:20px;align-items:end}
  .anchor-controls .anchor-filter{margin:0 0 10px}
  .anchor-controls .anchor-toolbar{justify-content:space-between}
  .anchor-workspace .stat-bar-track{width:min(100%,56px)}
  .gift-workspace .gift-totals{margin-top:0}.gift-workspace .rule-summary{margin-top:0}
  .gift-workspace .recent-gifts{margin-top:0}.gift-workspace>.settings-column{padding-block:16px}
  .moderation-terms{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 24px}
  .moderation-terms>:is(h3,p){grid-column:1/-1}
  [data-page=auto-like]>.grid{grid-template-columns:repeat(3,minmax(0,1fr))}
  .income-workspace{grid-template-columns:minmax(200px,.75fr) minmax(0,1.65fr);gap:24px;margin-top:20px}
  .income-summary .income-hero{margin-top:0}.income-summary .income-meta{flex-direction:column;gap:12px}
  [data-list=keywords],[data-list=timers]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 28px}
  [data-list=keywords]>.editor-row,[data-list=timers]>.editor-row{min-width:0}
}
@container workspace (min-width:1100px){
  .scroll{padding:22px 28px}
  .pk-overview{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
  .pk-overview-main .pk-scoreboard{padding-block:28px}.pk-scoreboard strong{font-size:36px}
  .pk-outlook .grid{grid-template-columns:repeat(4,minmax(0,1fr))}
  [data-page=features] .settings-workspace{grid-template-columns:repeat(3,minmax(0,1fr))}
  [data-page=features] .settings-group{padding-block:20px}
  .anchor-workspace{grid-template-columns:repeat(3,minmax(0,1fr))}
  .anchor-exhibition-section{grid-column:span 2}
  .anchor-battles-section{grid-column:1/-1}
  .pk-workspace .pk-chart{height:268px}.pk-workspace .pk-chart-gap{height:268px}
}
@container workspace (max-width:560px){
  .pk-overview-main .pk-verdict strong{font-size:16px}
  .pk-workspace .pk-chart{height:192px}.pk-workspace .pk-chart-gap{height:160px}
  .pk-workspace .pk-chart-contributions{height:224px}
  .pk-outlook .grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .pk-workspace .pk-chart-head select{width:auto}
}
@container assistant (max-height:600px) and (min-width:900px){
  .pk-workspace .pk-chart{height:192px}.pk-workspace .pk-chart-gap{height:192px}
  .pk-workspace .pk-chart-contributions{height:220px}
}
`;
