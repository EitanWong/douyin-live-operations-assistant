import {SCROLLBAR_CSS} from '../scrollbar-styles.js';
import {PRODUCT_LIQUID_GLASS_CSS} from '../liquid-glass.js';
import {PRODUCT_DIMENSIONS,PRODUCT_COMPACT_DIMENSIONS} from './layout.js';
const dimensionVariables=values=>Object.entries(values).map(([name,value])=>`--product-${name.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase())}:${value}px`).join(';');
const dimensions=dimensionVariables(PRODUCT_DIMENSIONS);
const fluidDimensions=Object.entries(PRODUCT_DIMENSIONS).map(([name,value])=>{const minimum=PRODUCT_COMPACT_DIMENSIONS[name];return `--product-${name.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase())}:calc(${minimum}px + ${value-minimum}px * var(--product-density,1))`;}).join(';');

// Container queries follow the floating window, not the host page viewport.
export const PRODUCT_CSS=`
:host{${dimensions};--product-line:var(--mantine-color-default-border);all:initial;display:flex;flex:1;min-height:0;min-width:0;contain:layout style;container:product / inline-size;color:var(--mantine-color-text);font:14px/1.55 var(--mantine-font-family)}
:host>div{display:flex;flex:1;min-width:0;min-height:0;width:100%}*{box-sizing:border-box}button,input,textarea,select{font:inherit}a{color:var(--mantine-color-anchor);overflow-wrap:anywhere}img{max-width:100%}
.product-utility-host{display:flex;flex:1;min-width:0;min-height:0;width:100%}
.product-utility-actions{display:flex;gap:4px;padding-inline-start:8px;border-inline-start:1px solid var(--product-line);flex:none}
.product-toolbar-actions .product-utility-button{width:36px;height:36px;min-height:36px;padding:6px;flex:none}.product-utility-button svg{display:block;width:20px;height:20px}
.product-utility-section{display:flex;flex-direction:column;gap:var(--product-gap);min-width:0}.product-utility-section+.product-utility-section{border-top:1px solid var(--product-line);padding-top:var(--product-card-padding)}
.workspace-help-guide{display:flex;flex-direction:column;gap:8px}.workspace-help-guide>h4:not(:first-child){margin-block-start:8px}.product-utility-view :is(ol,ul){margin:0;padding-inline-start:22px}.product-utility-view li+li{margin-top:6px}
.product-record-browser-entry{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--product-gap);padding:var(--product-card-padding);border:1px solid var(--product-line);border-radius:var(--mantine-radius-md)}.product-record-browser-entry p{margin-top:6px}.product-record-list,.product-record-detail{display:flex;flex-direction:column;gap:var(--product-gap);min-width:0}.product-record-list-items{display:flex;flex-direction:column;gap:8px;min-width:0}.product-record-list-items .mantine-Button-root{height:auto;min-height:var(--product-control-height);padding-block:10px;white-space:normal;text-align:start}.product-record-list-items .mantine-Button-label{white-space:normal;overflow-wrap:anywhere}.product-record-detail>button{align-self:flex-start}
.product-shell{display:grid;grid-template-columns:var(--product-sidebar-width,184px) minmax(0,1fr);grid-template-rows:minmax(0,1fr);width:100%;min-height:0;--product-feedback-ease:cubic-bezier(.2,.8,.2,1);background:var(--mantine-color-body);color:var(--mantine-color-text);--product-line:var(--mantine-color-default-border)}
.product-shell .mantine-Button-root{display:inline-flex;align-items:center;justify-content:center}
.product-shell .mantine-Button-inner{width:100%;min-width:0}
.product-shell .mantine-Button-label{height:auto;line-height:1.5;text-box-trim:none}
/* Own the inner grid too: Mantine's Button alignment is on its inner span. */
.product-shell[data-sidebar-side=right]{grid-template-columns:minmax(0,1fr) var(--product-sidebar-width,184px)}
.product-shell[data-sidebar-side=right]>.product-sidebar{grid-column:2;grid-row:1;border-right:0;border-left:1px solid var(--product-line)}
.product-shell[data-sidebar-side=right]>.product-main{grid-column:1;grid-row:1}
.product-shell[data-sidebar-collapsed=true]{grid-template-columns:var(--product-sidebar-width,64px) minmax(0,1fr)}
.product-shell[data-sidebar-collapsed=true][data-sidebar-side=right]{grid-template-columns:minmax(0,1fr) var(--product-sidebar-width,64px)}
.product-sidebar{min-width:0;min-height:0;overflow:auto;scrollbar-gutter:stable both-edges;overscroll-behavior:contain;border-right:1px solid var(--product-line);background:var(--mantine-color-default);padding:0;}
.product-sidebar-inner{padding:12px 8px}
.product-nav{display:flex;flex-direction:column;gap:20px}
.product-nav-label{font-size:12px;font-weight:650;color:var(--mantine-color-dimmed);padding:0 10px;line-height:24px;overflow:hidden}
.product-nav-group{display:flex;flex-direction:column;gap:4px}
.product-nav-toggle{margin-bottom:16px}
.product-sidebar .product-nav-button{display:block;max-width:100%;height:40px;padding:0 10px;font-size:13px;font-weight:500;border-radius:12px}
.product-nav-button .mantine-Button-inner{display:grid;grid-template-columns:18px minmax(0,1fr);gap:10px;align-items:center;justify-content:stretch}
.product-nav-button .mantine-Button-section{margin:0}
.product-nav-button .mantine-Button-label{display:block;min-width:0;text-align:left;text-overflow:ellipsis;overflow:hidden;white-space:nowrap}
.product-icon{width:18px;height:18px;display:inline-flex;flex-shrink:0}.product-icon svg{width:100%;height:100%}

.product-shell[data-sidebar-collapsed=true] .product-nav-button{width:100%;padding:0;margin-inline:0}
.product-shell[data-sidebar-collapsed=true] .product-nav-button .mantine-Button-inner{grid-template-columns:minmax(0,1fr);gap:0}
.product-shell[data-sidebar-collapsed=true] .product-nav-button .mantine-Button-section{justify-self:center;grid-area:1/1}
.product-shell[data-sidebar-collapsed=true] .product-nav-button .mantine-Button-label{position:absolute;width:1px;height:1px;visibility:hidden;overflow:hidden}
.product-shell[data-sidebar-collapsed=true] .product-nav-group+.product-nav-group{border-top:1px solid var(--product-line);padding-top:16px}
.product-main{display:flex;flex-direction:column;min-width:0;min-height:0}.product-toolbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:14px 20px;border-bottom:1px solid var(--product-line);flex:none}.product-heading{display:flex;align-items:center;gap:10px}.product-heading h2{margin:0;font-size:18px;font-weight:650}.product-toolbar-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.product-toolbar-actions small{color:var(--mantine-color-dimmed);font-size:11px}.product-shell .product-menu-button{display:none;font-size:13px}.product-subviews{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:10px 20px;border-bottom:1px solid var(--product-line);flex:none}.product-subviews:empty{display:none}.product-subview-tabs{min-width:0;max-width:100%}.product-subview-tabs .mantine-Tabs-list{flex-wrap:wrap;gap:6px}.product-subview-tabs .mantine-Tabs-tab{font-size:12px;font-weight:600;padding:8px 12px}.product-subview-tabs .mantine-Tabs-tabLabel{white-space:normal}.product-subviews>.mantine-InputWrapper-root{margin-left:auto;max-width:200px}.product-content{min-height:0;min-width:0;flex:1;overflow:auto;padding:var(--product-content-padding);overscroll-behavior:contain;container:content / size}.product-page{display:flex;flex-direction:column;gap:var(--product-section-gap);min-width:0}.product-page p{margin:0;line-height:1.65;overflow-wrap:anywhere}.product-page h3{margin:0;font-size:14px;font-weight:650;scroll-margin:12px}.product-page h4{font-size:13px;margin:0}.product-page small,.hint,.group-note,.choice-hint,.pk-note,.intro,.empty{color:var(--mantine-color-dimmed);font-size:12px}.product-page .mantine-InputWrapper-root{margin:0;min-width:0;width:100%}.product-switch{min-height:var(--product-control-height);padding:4px 0;border-bottom:1px solid var(--product-line)}.product-switch:last-child{border-bottom:0}.product-page .mantine-Paper-root{min-width:0;width:100%;align-self:auto}
.product-layout,.product-full{width:100%;min-width:0;max-width:100%}.product-layout>*{min-width:0;max-width:100%}.product-full{grid-column:1/-1}.product-layout[data-layout=cards]{align-items:stretch}.product-layout[data-layout=cards]>*{margin:0}.product-layout[data-layout=fields]{align-items:start}.product-layout[data-layout=row]{min-height:var(--product-control-height)}.product-layout[data-layout=row]>p{flex:1 1 180px}.product-layout[data-layout=row]>.product-switch{flex:1 1 200px}.anchor-section-head,.pk-chart-head,.workspace-filter-heading,.workspace-filter-controls,.ai-card-heading{justify-content:space-between}.product-page button,.product-toolbar button{height:auto;min-height:var(--product-control-height);padding-block:4px}.product-page button .mantine-Button-label{white-space:normal;overflow-wrap:normal;word-break:normal;text-align:start}.workspace-card>div:empty{display:none}.product-layout[data-layout=metrics]>.product-layout{min-height:var(--product-metric-min-height);padding:var(--product-metric-padding);border:1px solid var(--product-line);border-radius:8px;justify-content:center}.anchor-metrics b,.stats b,.overview-metric b,.anchor-exhibition-grid b,.gift-total-grid b{display:block;font-size:23px;line-height:1.4;font-variant-numeric:tabular-nums}.anchor-metrics span,.anchor-session-times dt,.stats span,.anchor-exhibition-grid span{font-size:12px;color:var(--mantine-color-dimmed)}.anchor-session-times dd{margin:0;font-size:13px}.income-hero>b{display:block;font-size:30px}.feature-title{font-weight:550}.feature-title small{display:block;font-weight:400}.badge,.ai-tag{display:inline-flex;padding:2px 6px;border-radius:5px;background:var(--mantine-color-brand-light);color:var(--mantine-color-brand-light-color);font-size:11px}
.mantine-SimpleGrid-container{min-width:0;width:100%;max-width:100%}.product-table-scroll{width:100%;min-width:0;border:1px solid var(--product-line);border-radius:8px}.product-table-scroll table{min-width:100%;width:max-content;font-size:12px}.product-table-scroll th{position:sticky;top:0;background:var(--mantine-color-body);z-index:1;white-space:nowrap}.product-table-scroll td{max-width:340px;overflow-wrap:anywhere;white-space:normal}.product-table-scroll td small{display:block}.product-disclosure{margin:0;min-width:0;width:100%;padding:var(--product-card-padding)}.product-disclosure:not([data-surface=card]){padding-block:var(--product-metric-padding)}.product-disclosure-heading>.mantine-Button-root{height:auto;min-height:var(--product-control-height);max-width:100%;padding:4px 0}.product-disclosure-heading>.mantine-Button-root .mantine-Button-inner{min-width:0}.product-disclosure-heading>.mantine-Button-root .mantine-Button-label{white-space:normal;text-align:left;overflow-wrap:anywhere;flex:1;min-width:0}.product-disclosure-body{padding:var(--product-gap) 0 0}.product-stat-bars{display:flex;flex-direction:column;gap:12px;margin:12px 0}.stat-progress-label{display:flex;justify-content:space-between;gap:8px;font-size:12px;margin:12px 0 6px}.product-chart{width:100%;height:var(--product-chart-height);flex:none;min-width:0;overflow:hidden}.product-graphic{max-width:100%;overflow:auto}.product-graphic svg{display:block;max-width:100%;height:auto}.product-color-option{display:flex;align-items:center;gap:10px}.product-color-swatch{display:inline-block;width:14px;height:14px;border-radius:50%;border:1px solid var(--product-line);flex:none}.product-image{width:40px;height:40px;object-fit:contain}.editor-row{margin:0}.row-head{justify-content:space-between}.product-status{border-top:1px solid var(--product-line);flex:none;padding:8px 20px;font-size:12px}.product-state{color:var(--mantine-color-dimmed);display:flex;justify-content:space-between;gap:4px 12px;flex-wrap:wrap}.product-messages{display:flex;flex-direction:column;gap:6px;max-height:150px;overflow:auto;margin-top:6px}.product-messages .mantine-Alert-root{padding:8px 12px}.product-messages p{margin:0}.product-messages button{margin-left:8px}.pk-scoreboard{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:12px;padding:12px 0;text-align:center}.pk-scoreboard>.product-layout{gap:4px}.pk-scoreboard>div:first-child strong{color:var(--sg-success)}.pk-scoreboard>div:last-child strong{color:var(--sg-brand)}.pk-scoreboard span{overflow-wrap:anywhere}.pk-scoreboard .vs{gap:2px}.pk-scoreboard strong{display:block;font-size:30px}.pk-scoreboard span{font-size:12px;color:var(--mantine-color-dimmed)}.pk-scoreboard .vs{font-weight:bold;text-align:center}.product-page pre{overflow:auto;max-height:none;font-size:11px}

.product-page .product-switch{width:auto}.product-layout[data-layout=row]>.product-layout{width:auto}.product-layout[data-layout=row]>.mantine-InputWrapper-root{width:auto;flex:0 1 var(--product-field-min-width)}.product-layout[data-layout=row]>button{flex-shrink:0;max-width:100%}.product-page .mantine-InputWrapper-label{overflow-wrap:anywhere}.product-layout[data-layout=metrics]>.product-layout{gap:4px}.product-layout[data-layout=metrics]>.product-layout>span,.product-layout[data-layout=metrics] dt{font-size:12px;line-height:1.5;color:var(--mantine-color-dimmed)}.product-layout[data-layout=fields]>.product-layout{gap:4px}.pk-chart-head>.mantine-InputWrapper-root{flex-basis:var(--product-inline-control-width)}.pk-broadcast-copy{flex:1 1 240px}.pk-broadcast-master>.product-layout{flex:1 1 240px}.product-layout.pk-broadcast-option>.product-switch,.product-layout.pk-broadcast-master>.product-switch{flex:0 0 auto;border:0;padding:0}.pk-broadcast-option{padding-block:12px;border-top:1px solid var(--product-line)}.pk-broadcast-midnight{flex-basis:100%}.pk-broadcast-copy,.pk-verdict{gap:4px}.pk-reading strong,.pk-prob b{font-size:20px;font-variant-numeric:tabular-nums}.pk-lead:empty{display:none}

.product-shell .mantine-Input-input:not(textarea){--input-size:var(--product-control-height);height:var(--product-control-height);min-height:var(--product-control-height)}
.product-shell textarea.mantine-Input-input{min-height:var(--product-textarea-min-height)}
.product-layout[data-surface=card]>h3,.product-layout[data-surface=card]>.product-layout:first-child:has(>h3){min-height:var(--product-control-height);display:flex;align-items:center}
.product-layout.feature-row>.feature-title{flex:1 1 160px}.product-layout.feature-row>.product-switch{flex:0 0 auto;border:0;padding:0}

@container product (max-width:660px){.product-shell,.product-shell[data-sidebar-side=right],.product-shell[data-sidebar-collapsed=true],.product-shell[data-sidebar-collapsed=true][data-sidebar-side=right]{grid-template-columns:1fr}.product-nav-toggle{display:none}.product-shell[data-sidebar-collapsed=true] .product-nav-button .mantine-Button-label{position:static;width:auto;height:auto;visibility:visible}.product-shell[data-sidebar-collapsed=true] .product-nav-button{width:100%;padding:0 10px}.product-shell[data-sidebar-collapsed=true] .product-nav-button .mantine-Button-inner{grid-template-columns:18px minmax(0,1fr);justify-items:stretch;gap:10px}.product-shell[data-sidebar-collapsed=true] .product-nav-button .mantine-Button-section{grid-area:auto;justify-self:start}.product-shell[data-sidebar-collapsed=true] .product-nav-group+.product-nav-group{border:0;padding-top:0}.product-sidebar{display:block;max-height:40%;flex:none;order:1;border-right:0;border-bottom:0}.product-shell[data-menu-open=true]>.product-sidebar{border-bottom:1px solid var(--product-line)}.product-shell{display:flex;flex-direction:column}.product-shell[data-menu-open=true]>.product-sidebar{display:block;flex:none;order:1}.product-shell>.product-main{display:contents}.product-shell .product-toolbar{order:0}.product-shell .product-subviews{order:2}.product-shell .product-content{order:3}.product-shell .product-status{order:4}.product-shell .product-menu-button{display:inline-flex}.product-nav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.product-toolbar,.product-subviews{padding:10px 12px}.product-content{padding:var(--product-content-padding)}.product-status{padding:8px 12px}.product-toolbar-actions{gap:6px}.product-toolbar-actions small{width:100%}.product-heading h2{font-size:16px}}
.product-shell[data-material=glass] .mantine-Paper-root{background:var(--sg-card);box-shadow:inset 0 1px 0 var(--sg-inner),0 1px 2px var(--sg-contact)}
.product-shell[data-material=glass] .mantine-Input-input{background:var(--sg-field);border-color:var(--sg-field-edge);box-shadow:inset 0 1px 0 var(--sg-field-rim),0 1px 2px var(--sg-contact)}
.product-shell .mantine-Button-root[data-variant=light]{color:var(--sg-brand);background:var(--sg-brand-wash)}
.product-shell .mantine-Button-root[data-variant=subtle]{color:var(--sg-brand)}.product-nav .mantine-Button-root[data-variant=subtle]{color:var(--sg-muted)}
.product-shell .mantine-Input-input:focus,.product-shell .mantine-Input-input:focus-within{border-color:var(--sg-focus)}
.product-shell[data-material=solid]{background:var(--sg-solid)}
/* Feedback changes state immediately; animations only explain that change. */
.product-reveal{overflow:hidden;min-width:0}.product-page-entrance{min-width:0}
.product-chevron{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;margin-inline:2px}.product-chevron svg{width:100%;height:100%}
.product-menu-button .mantine-Button-label{gap:6px;align-items:center}
.product-sidebar{overflow-x:hidden}
.product-shell .product-sidebar .product-nav-button{transition:padding-inline 240ms var(--product-feedback-ease),background-color 140ms ease-out,box-shadow 140ms ease-out}
.product-nav-button .mantine-Button-inner{transition:gap 240ms var(--product-feedback-ease)}
.product-nav-group+.product-nav-group{transition:padding-top 240ms var(--product-feedback-ease)}.product-sidebar[aria-hidden=true]{pointer-events:none}
.product-shell :is(button,a,input,textarea,select,[role=slider]):focus-visible{outline:2px solid var(--sg-focus);outline-offset:3px}
.product-shell :is(.mantine-Button-root,.mantine-Tabs-tab){transition:background-color 140ms ease-out,border-color 140ms ease-out,box-shadow 140ms ease-out,color 140ms ease-out;touch-action:manipulation}
.product-shell .mantine-Input-input{transition:border-color 140ms ease-out,box-shadow 140ms ease-out,background-color 140ms ease-out}
.product-shell .mantine-Input-input:focus{box-shadow:0 0 0 3px var(--sg-brand-wash)}
.product-shell .mantine-Switch-track{transition:background-color 160ms ease-out,border-color 160ms ease-out}
.product-shell .mantine-Switch-thumb{transition:inset-inline-start 260ms var(--product-feedback-ease),transform 200ms var(--product-feedback-ease),width 200ms ease-out}
.product-shell .mantine-Switch-track:active .mantine-Switch-thumb{transform:scale(.9)}
.product-shell .mantine-Slider-thumb{transition:box-shadow 140ms ease-out,transform 180ms var(--product-feedback-ease)}
.product-shell .mantine-Slider-thumb:is(:hover,[data-dragging]){transform:translate(-50%,-50%) scale(1.12);box-shadow:0 0 0 5px var(--sg-brand-wash)}
.product-shell .mantine-Tabs-tab:active:not(:disabled){transform:scale(.975)}
.product-shell .mantine-Tabs-tab{transition:background-color 140ms ease-out,transform 220ms var(--product-feedback-ease)}
.product-shell .mantine-Table-tr{transition:background-color 120ms ease-out}
@media(hover:hover){.product-shell a:hover{text-decoration-thickness:2px;text-underline-offset:3px}}
@media(forced-colors:active){.product-shell,.product-shell .mantine-Paper-root{background:Canvas;color:CanvasText;border-color:CanvasText}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important}.product-shell .mantine-Tabs-tab:active:not(:disabled),.product-shell .mantine-Switch-track:active .mantine-Switch-thumb{transform:none}.product-shell .mantine-Slider-thumb:is(:hover,[data-dragging]){transform:translate(-50%,-50%)}}

.product-content{scrollbar-gutter:stable;scroll-padding-block:var(--product-card-padding)}
.product-toolbar,.product-subviews,.product-status{max-width:100%;min-width:0}
.product-heading{min-width:0;flex-wrap:wrap}.product-heading h2{overflow-wrap:anywhere}
.product-toolbar-actions{min-width:0;max-width:100%}
.product-status{background:var(--mantine-color-body);overflow:visible;line-height:1.6}.product-state>span{min-width:0;overflow-wrap:anywhere}.product-state>span:first-child{color:var(--mantine-color-text);font-weight:550}.product-state small{white-space:normal;overflow-wrap:anywhere}.product-messages{max-height:clamp(64px,20cqh,160px);overflow:auto;scrollbar-gutter:stable;overscroll-behavior:contain}.product-messages .mantine-Alert-message{overflow-wrap:anywhere;white-space:normal;line-height:1.65}.product-messages:focus-visible{outline:2px solid var(--sg-focus);outline-offset:2px}
@container assistant (max-height:520px){.product-toolbar{padding-block:6px}.product-subviews{padding-block:4px;max-height:25%;overflow:auto;flex-wrap:nowrap}.product-subview-tabs{flex:1;min-width:0}.product-subview-tabs .mantine-Tabs-list{flex-wrap:nowrap;overflow-x:auto}.product-subview-tabs .mantine-Tabs-tab{flex-shrink:0}.product-subviews>.mantine-InputWrapper-root{flex:0 1 var(--product-inline-control-width)}.product-status{padding-block:6px}.product-content{padding-block:8px}}
@container product (max-width:400px){.product-toolbar{gap:6px}.product-heading{gap:6px}.product-toolbar-actions{gap:4px}.product-page button{max-width:100%}}
/* Native wrapping owns placement. Content growth stays inside each tile. */
 .product-main{--product-density:1;${fluidDimensions}}
.product-main .product-toolbar{padding:calc(8px + 3px * var(--product-density)) calc(12px + 4px * var(--product-density))}
.product-main .product-subviews{padding:calc(6px + 2px * var(--product-density)) calc(12px + 4px * var(--product-density))}
.product-main .product-status{padding:8px 12px}
.product-page{--product-card-limit:clamp(var(--product-card-min-height),100cqh,calc(var(--product-card-height) + var(--product-fill,0) * 100cqh))}
.product-card-run{width:100%;min-width:0}.product-card-slot{display:flex;flex:1 1 min(100%,var(--product-card-min-width));min-width:0;max-width:100%}.product-card-slot>*{flex:1;min-width:0;max-width:100%;margin:0}.product-card-slot>.mantine-Paper-root{display:flex;flex-direction:column;align-self:stretch;min-height:0}
.product-page .product-card-run:not([data-card-run=full])>.product-card-slot{block-size:var(--product-card-limit)}
.feature-settings{gap:var(--product-section-gap)}.feature-section{padding-block:var(--product-card-padding);border-bottom:1px solid var(--product-line)}.feature-section:first-child{padding-top:0}.feature-section:last-child{border-bottom:0;padding-bottom:0}.feature-section>.group-note{margin-bottom:var(--product-metric-padding)}
.feature-settings .feature-list{align-items:stretch}.feature-settings .product-switch{border:0;padding:var(--product-metric-padding) 0}.feature-settings .mantine-Switch-body{flex-direction:row-reverse;justify-content:space-between;gap:12px;align-items:flex-start}.feature-settings .mantine-Switch-labelWrapper{padding:0;flex:1;min-width:0}.feature-settings .mantine-Switch-label{font-weight:550}.feature-settings .mantine-Switch-track{flex-shrink:0;margin-top:2px}.feature-section>button{align-self:flex-start}
.product-layout[data-layout=metrics]>*{flex:1 1 min(100%,var(--product-metric-min-width))}.product-layout[data-layout=metrics]>.product-full{flex-basis:100%}
.product-card-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex:none;min-width:0;padding:var(--product-card-padding);border-bottom:1px solid var(--product-line)}
.product-card-heading h3{min-height:var(--product-heading-height);display:flex;align-items:center}
.product-card-body{min-height:0;min-width:0;display:flex;flex-direction:column;padding:var(--product-card-padding);overflow:visible;overscroll-behavior:auto;scroll-padding:var(--product-card-padding);flex:1 1 auto}
.product-card-content{min-width:0;justify-content:flex-start}.product-card-content>*,.product-disclosure-body>*{flex-shrink:0}
.product-page .product-card-body{max-block-size:var(--product-card-limit);overflow:auto;scrollbar-gutter:stable;overscroll-behavior:auto}
.product-page .product-card-run:not([data-card-run=full])>.product-card-slot>.mantine-Paper-root>.product-card-body{max-block-size:none}
.product-page .product-disclosure-body{max-block-size:var(--product-card-limit);overflow:auto;scrollbar-gutter:stable;scroll-padding:var(--product-gap)}
.product-card-body .product-disclosure-body{max-block-size:none;overflow:visible;scrollbar-gutter:auto}
.product-page .product-card-body>.product-card-content{flex:0 0 auto}
.product-card-content>.product-layout[data-layout=fields]{row-gap:var(--product-gap)}
.product-card-heading{align-items:center}
.product-card-heading>.product-layout{min-height:var(--product-heading-height)}
.product-inspection-view .product-card-body,.product-inspection-view .product-disclosure-body{max-block-size:none;overflow:visible;scrollbar-gutter:auto}
.product-page pre.diagnostic-output{white-space:pre-wrap;overflow-wrap:anywhere}
.product-card-body:focus-visible{outline:2px solid var(--sg-focus);outline-offset:-3px}

.product-table-scroll,.product-record-scroll,.product-edit-scroll{max-block-size:none;overscroll-behavior:auto;scroll-padding-block:8px}
.product-table-scroll{overflow-x:auto}
.product-record-scroll,.product-edit-scroll{overflow:visible}
.product-table-scroll{margin:0;isolation:isolate}
.product-record-scroll,.product-edit-scroll{padding:4px}
.product-data-set{display:flex;flex-direction:column;gap:8px;min-width:0;min-height:0;flex:0 1 auto;width:100%;margin-block:8px}
.product-data-set>.product-table-scroll,.product-data-set>.product-record-scroll{min-height:64px;flex:0 1 auto}
.product-data-tools,.product-data-footer,.product-page .mantine-Paper-root>h3{flex-shrink:0}
.product-data-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.product-data-tools>.product-data-search{flex:1 1 180px;min-width:0}
.product-data-tools>.mantine-InputWrapper-root:not(.product-data-search){flex:0 1 150px;width:auto}
.product-data-tools>button{flex:none}
.product-data-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 12px;font-size:12px;color:var(--mantine-color-dimmed);font-variant-numeric:tabular-nums}
.product-data-footer nav{display:flex;gap:6px}
.product-record-scroll .logs{max-height:none;border:0}
.product-record-scroll:has(.profile-card){max-block-size:320px;overflow:auto;overscroll-behavior:contain}
.profile-card.product-layout{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding-block:6px;border-bottom:1px solid var(--product-line)}
.profile-card.product-layout>.product-layout{width:100%;gap:2px;overflow-wrap:anywhere}.profile-card strong{font-size:13px}.profile-card small{font-size:11px;color:var(--mantine-color-dimmed)}.profile-card>a{font-size:12px;white-space:nowrap;padding-block:8px}


.knowledge-workspace.product-layout{gap:12px}.knowledge-heading,.knowledge-section-heading{justify-content:space-between}.knowledge-toolbar.product-layout{gap:8px;padding:12px}.knowledge-metrics.product-layout[data-layout=metrics]>.product-layout{min-height:56px}.knowledge-heading>.product-layout{gap:4px}.knowledge-heading>.product-layout{flex:1 1 260px}.knowledge-heading h3{font-size:21px;line-height:1.45}.knowledge-eyebrow{color:var(--sg-brand);font-size:10px;letter-spacing:1.6px;font-weight:700}.knowledge-metrics strong{font-size:22px;font-variant-numeric:tabular-nums}.knowledge-record.product-disclosure{padding:6px 12px;border-radius:8px}.knowledge-record>.mantine-Button-root{font-size:13px}.knowledge-reader>p,.knowledge-editor>p{white-space:pre-wrap}.product-knowledge-dialog .mantine-Modal-inner{height:100%;padding:16px}.product-knowledge-dialog .mantine-Modal-content{max-height:100%;overflow:auto}.product-knowledge-dialog .mantine-Modal-title{font-weight:600}.product-knowledge-dialog .mantine-Textarea-input{min-height:220px}.product-knowledge-dialog .actions{justify-content:flex-end;position:sticky;bottom:-16px;padding:12px 0;background:var(--mantine-color-body);border-top:1px solid var(--product-line)}.product-knowledge-dialog .knowledge-dialog-error{color:var(--mantine-color-red-text)}.knowledge-editor>.mantine-Button-root{align-self:flex-start}
.product-card-heading>.product-layout{flex:1;min-width:0}.product-card-heading h3{overflow-wrap:anywhere}
.product-page [data-surface=card]{position:relative}.product-card-utility{position:absolute;top:6px;right:6px;z-index:1}.product-card-utility+.product-card-body{padding-inline-end:calc(var(--product-card-padding) + 28px)}.product-inspection-view .product-card-utility{display:none}.product-inspection-view .product-card-utility+.product-card-body{padding-inline-end:0}
.product-shell .product-expand,.product-inspection-view .product-expand{width:28px;height:28px;min-height:28px;flex:0 0 28px;padding:4px;border-radius:7px;align-self:flex-start;color:var(--sg-muted)}
.product-expand svg{width:16px;height:16px;display:block}.product-expand:hover{color:var(--sg-brand);background:var(--sg-brand-wash)}
.product-disclosure-heading,.product-data-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}.product-disclosure-heading>button:first-child{flex:1;min-width:0}
.product-data-heading{font-size:12px}.product-inspectable{position:relative;min-width:0;width:100%}.product-inspectable>.product-expand{position:absolute;right:4px;top:4px;z-index:2;background:var(--mantine-color-body)}
.product-inspectable:has(>.product-expand)>:last-child{padding-top:30px}
.product-inspection-dialog .mantine-Modal-inner{position:absolute;inset:0;width:100%;height:100%;padding:12px}
.product-inspection-dialog .mantine-Modal-overlay{position:absolute;inset:0}
.product-inspection-content{max-width:100%;max-height:100%;min-width:0;overflow:auto;color:var(--mantine-color-text);border:1px solid var(--product-line);border-radius:14px}
.product-inspection-dialog .mantine-Modal-header{position:sticky;top:0;z-index:4;border-bottom:1px solid var(--product-line)}
.product-inspection-dialog .mantine-Modal-title{font-weight:650;font-size:16px}.product-inspection-body{padding:16px}
.product-inspection-view{container:inspection / inline-size;min-width:0;--product-chart-height:clamp(240px,55vh,520px)}
.product-inspection-view .product-card-heading{display:none}.product-inspection-view .product-card-body{padding:0}.product-inspection-view [data-surface=card]{border:0;box-shadow:none;background:transparent}
.product-inspection-view .product-image{width:auto;height:auto;max-height:70vh;object-fit:contain}.product-inspection-view .product-inspectable>:last-child{padding-top:0}
.ai-section-intro{color:var(--mantine-color-dimmed);font-size:12px}.ai-result{display:flex;flex-direction:column;gap:12px;min-width:0}.ai-result-heading{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.ai-result-heading h4{flex:1 1 220px;overflow-wrap:anywhere}
.product-inspectable:has(>.ai-result-section)>:last-child{padding-top:0}.ai-result-section>h4{padding-inline-end:36px;min-height:28px;display:flex;align-items:center}
.product-inspectable:has(>.ai-final-answer)>:last-child{padding-top:16px}.ai-final-answer>h4{padding-inline-end:28px}
.ai-result-status{font-size:11px;font-weight:650;padding:3px 8px;border-radius:999px;background:var(--sg-brand-wash);color:var(--sg-brand)}
.ai-final-answer{padding:16px;border:1px solid var(--sg-brand);border-radius:10px;background:var(--sg-brand-wash)}.ai-final-answer h4{color:var(--sg-brand);font-size:12px;margin-bottom:8px}.ai-final-answer .ai-answer-text{font-size:16px;line-height:1.8;white-space:pre-wrap;color:var(--mantine-color-text);user-select:text}
.ai-result-meta{display:flex;flex-wrap:wrap;gap:6px}.ai-result-meta span{font-size:11px;color:var(--mantine-color-dimmed);padding:3px 7px;border:1px solid var(--product-line);border-radius:5px}
.ai-result-section{display:flex;flex-direction:column;gap:8px}.ai-trace{display:grid;align-items:start;grid-template-columns:repeat(auto-fit,minmax(min(140px,100%),1fr));gap:8px;list-style:none;padding:0;margin:0}
.ai-trace-step{position:relative;display:flex;flex-direction:column;gap:4px;padding:12px 12px 12px 42px;border:1px solid var(--product-line);border-radius:8px;min-width:0;font-size:12px}
.ai-trace-number{position:absolute;left:10px;top:12px;display:grid;place-items:center;width:23px;height:23px;border-radius:50%;background:var(--sg-brand-wash);color:var(--sg-brand);font-size:11px;font-weight:650}.ai-trace-step p{overflow-wrap:anywhere}.ai-trace-step small{font-size:10px;color:var(--mantine-color-dimmed)}
.ai-result-checks,.ai-result-sources,.ai-result-history{border-top:1px solid var(--product-line);padding-top:10px}.ai-result-history>.ai-result{padding-block:16px;border-bottom:1px solid var(--product-line)}.ai-result-warning,.ai-trace-step.is-warning{color:var(--mantine-color-orange-text)}.ai-trace-step.is-failed{color:var(--mantine-color-red-text)}.ai-source{padding:12px 0;display:flex;flex-direction:column;gap:6px}.ai-source a{font-size:12px;overflow-wrap:anywhere}
`+PRODUCT_LIQUID_GLASS_CSS+SCROLLBAR_CSS;
