export const FLOATING_WINDOW_CSS = `
/* Geometry lives on the shell, presence on the panel, press feedback on the
   launcher. Each transform has a single owner, so gestures never fight CSS. */
.floating-panel{position:fixed;container:assistant / size;pointer-events:none;isolation:isolate;z-index:2}
.floating-panel>.panel{position:absolute;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;animation:none;border:0;border-radius:16px;box-shadow:inset 0 0 0 1px var(--sg-inner),0 16px 48px -16px var(--sg-shade),0 4px 12px -4px var(--sg-contact)}
.floating-panel[data-interactive=false],.floating-panel[data-interactive=false] *{pointer-events:none!important}
button.launcher,button.launcher:active:not(:disabled),button.launcher.dragging,button.launcher.dragging:hover:not(:disabled),button.launcher.dragging:active:not(:disabled){transition:background-color 140ms ease-out;outline:none}
.launcher{z-index:1;max-width:calc(100vw - 16px)}
button.launcher:focus-visible{outline:2px solid var(--sg-focus);outline-offset:3px}
button.launcher.dragging{box-shadow:var(--sg-pane-shadow)}
.dock-hint{position:fixed;left:0;top:0;width:4px;height:56px;border-radius:4px;background:var(--sg-brand);opacity:0;pointer-events:none;transform-origin:center;z-index:1}
.head{touch-action:none;cursor:move;user-select:none;-webkit-user-select:none}
.head button{cursor:pointer;flex-shrink:0;min-width:44px;min-height:36px}
.head-title>div{min-width:0}.head h1{overflow-wrap:anywhere}.head-mark{flex-shrink:0}
.window-resize{position:absolute;z-index:3;pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none}
.window-resize[data-resize=n],.window-resize[data-resize=s]{left:16px;right:16px;height:10px;cursor:ns-resize}
.window-resize[data-resize=n]{top:-4px}.window-resize[data-resize=s]{bottom:-4px}
.window-resize[data-resize=e],.window-resize[data-resize=w]{top:16px;bottom:16px;width:10px;cursor:ew-resize}
.window-resize[data-resize=e]{right:-4px}.window-resize[data-resize=w]{left:-4px}
.window-resize[data-resize=nw],.window-resize[data-resize=ne],.window-resize[data-resize=sw],.window-resize[data-resize=se]{width:20px;height:20px}
.window-resize[data-resize=nw]{left:-4px;top:-4px;cursor:nwse-resize}.window-resize[data-resize=ne]{right:-4px;top:-4px;cursor:nesw-resize}.window-resize[data-resize=sw]{left:-4px;bottom:-4px;cursor:nesw-resize}
button.window-resize[data-resize=se]{right:0;bottom:0;width:24px;height:24px;min-height:0;padding:0;border:0;border-radius:0 0 16px 0;background:transparent;color:var(--muted);box-shadow:none;cursor:nwse-resize;transition:color 140ms ease-out;transform:none}
button.window-resize[data-resize=se]:hover{color:var(--ink);background:transparent;box-shadow:none}
button.window-resize[data-resize=se]:focus-visible{outline-offset:-3px}
.window-resize svg{position:absolute;right:4px;bottom:4px;width:12px;height:12px;pointer-events:none}
.window-help{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.floating-panel.resizing,.floating-panel.moving{user-select:none;-webkit-user-select:none}
.floating-panel.resizing .panel,.floating-panel.moving .panel{pointer-events:none}
.foot{padding-right:28px}
.panel :is(input,select,textarea){min-width:0;max-width:100%}
.panel :is(.grid,.row,.actions,.inline,.status,.head-title,.shell-status,.anchor-toolbar,.pk-chart-head,.anchor-pagination)>*{min-width:0}
.panel :is(.page p,.notice,.hint,.group-note,.rule-summary,.room,.shell-status,.anchor-pagination){overflow-wrap:anywhere}
.panel :is(.actions,.inline,.status,.anchor-periods,.anchor-pagination,.pk-chart-head,.shell-status){flex-wrap:wrap}
.panel .inline input{flex-basis:140px}.panel .inline button{flex-shrink:0}
.panel .scroll{scrollbar-gutter:stable;scroll-padding-block:16px}
.panel .pk-data-scroll,.panel .income-table-wrap{max-width:100%;overscroll-behavior:contain}
.panel .primary-nav button[aria-pressed=true]{background:var(--sg-solid);color:var(--ink);box-shadow:0 1px 3px var(--sg-contact)}
.panel :is(.subnav button,.primary-nav button,.anchor-views button,.anchor-periods button){transition:background-color 140ms cubic-bezier(.2,.8,.2,1),color 140ms ease-out}
/* Container queries follow the TOOL'S size, including on a wide live page. */
@container assistant (max-width:560px){
  .grid,.income-controls{grid-template-columns:minmax(0,1fr)}
  .head{padding:14px}.head h1{font-size:16px}.head-mark{width:30px;height:30px}
  .scroll{padding:16px}.banner{padding:9px 14px}.nav{padding-inline:10px}
  .foot{padding:10px 28px 10px 14px}.foot small{max-width:140px}.foot .primary{min-width:110px}
  .row{gap:8px}.candidate{grid-template-columns:54px minmax(0,1fr)}
  .gift-activity{grid-template-columns:minmax(60px,1fr) minmax(65px,1fr) auto;gap:5px;font-size:11px}
  .gift-total-grid b{font-size:24px}.gift-totals{padding:14px}.income-hero>b{font-size:26px}
  .anchor-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
  .anchor-metrics>div:nth-child(3){border-left:0;padding-left:0;border-top:1px solid var(--line)}
  .anchor-metrics>div:nth-child(4){border-top:1px solid var(--line)}
  .anchor-exhibition-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .anchor-filter{align-items:stretch;flex-direction:column}.anchor-filter button{width:100%}
  .anchor-periods{flex:1}.anchor-periods button{flex:1;padding:6px 8px}
  .anchor-gifts{grid-template-columns:minmax(0,1fr)}.anchor-rank{flex-wrap:wrap}
}
@container assistant (max-width:400px){
  .head{gap:8px}.head-title{gap:8px}.head h1{font-size:15px}.head-mark{display:none}
  .scroll{padding:14px 12px}.nav{padding-inline:8px}
  .subnav{flex-wrap:nowrap;overflow-x:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--sg-scroll) transparent;padding-bottom:5px}
  .subnav button{flex-shrink:0;min-height:38px;padding-inline:10px}
  .primary-nav button{min-height:36px}
  .overview-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.overview-metric:last-child{border-left:0;padding-left:0}
  .pk-prob,.pk-reading,.gift-total-grid{grid-template-columns:minmax(0,1fr)}
  .gift-total-grid>div+div{border-left:0;padding-left:0;border-top:1px solid var(--line);padding-top:12px}
  .pk-scoreboard{gap:6px;padding-inline:8px}.pk-scoreboard strong{font-size:24px}
  .income-meta{gap:10px}.feature-row{gap:9px}.feature-title small{font-size:11px}
  .foot{gap:8px;flex-wrap:wrap}.foot small{max-width:none;flex:1 1 80px}.foot .actions{margin-left:auto}
  .pk-chart-head{align-items:flex-start;gap:8px}.pk-chart-head select{width:100%}
  .income-table th,.income-table td{padding-inline:4px}
}
@container assistant (max-height:520px){
  .head{padding-block:9px}.room{margin-top:2px}.shell-status{padding-block:5px}
  .primary-nav{margin-top:5px;margin-bottom:3px}.nav{padding-bottom:4px}
  .banner{padding-block:6px}.foot{padding-block:7px}.scroll{padding-block:12px}
}
@container assistant (max-height:340px){
  .floating-panel>.panel{overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--sg-scroll) transparent}
  .panel .scroll{overflow:visible;flex:none;min-height:auto}.panel .room{display:none}
}
@media (pointer:coarse){.window-resize[data-resize=e],.window-resize[data-resize=w]{width:16px}.window-resize[data-resize=n],.window-resize[data-resize=s]{height:16px}button.window-resize[data-resize=se]{width:28px;height:28px}}
@media (prefers-reduced-motion:reduce){.dock-hint{display:none}}
`;
