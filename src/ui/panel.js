import { icon, decorateActionIcons } from './icons.js';
import { Navigation, navigationTemplate } from './navigation.js';
import { NAVIGATION_CSS } from './navigation-styles.js';
import { AdaptiveLayout } from './adaptive-layout.js';
import { ADAPTIVE_LAYOUT_CSS } from './adaptive-styles.js';
import { FloatingWindow } from './floating-window.js';
import { FLOATING_WINDOW_CSS } from './floating-styles.js';
import { SOLID_GLASS_CSS } from './solid-glass.js';
import { installTheme } from './theme.js';
import { AnchorDashboard } from './anchor-dashboard.js';
import { anchorPageTemplate } from './anchor-template.js';
import { ANCHOR_DASHBOARD_CSS } from './anchor-styles.js';
import { LiveCharts } from './live-charts.js';
import { copy, mergeConfig, validateConfig } from '../core/engine.js';
import { validateEndpoint } from '../services/ai.js';
import { giftDate } from '../data/gifts.js';
import { BOT_COMMANDS, RoomBot } from '../core/bot.js';
import { hasUnacknowledgedRuntimeAlert } from '../runtime/health.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const at = (o, path) => path.split('.').reduce((v, k) => v?.[k], o);
const put = (o, path, value) => { const parts = path.split('.'); const key = parts.pop(); parts.reduce((v, k) => v[k], o)[key] = value; };
const categories = { system: '运行', filter: '过滤', moderation: '内容提醒', queue: '发送队列', preview: '预览', sent: '提交', ai: 'AI', error: '错误', lab: '自检' };
const timeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
const interactionPages = ['anchor','pk','gift','welcome','likes','keywords','bot','timers'];
const money = value => new Intl.NumberFormat('zh-CN', {style:'currency',currency:'CNY',maximumFractionDigits:2}).format(value);
const presets = {
  deepseek: ['https://api.deepseek.com/chat/completions', 'deepseek-flash'],
  qwen: ['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'qwen-plus'],
  doubao: ['https://ark.cn-beijing.volces.com/api/v3/chat/completions', '请填写你的接入点ID'],
  local: ['http://localhost:11434/v1/chat/completions', 'qwen2.5:7b']
};
const CSS_TEXT = `
:host{all:initial;color-scheme:var(--sg-scheme);font:14px/1.55 var(--sg-font);color:var(--sg-foreground);--ink:var(--sg-foreground);--muted:var(--sg-muted);--line:var(--sg-border);--accent:var(--sg-brand);--accent-strong:var(--sg-brand);--paper:var(--sg-background);--surface:var(--sg-solid);--wash:var(--sg-control);--signal:var(--sg-brand);--amber:var(--sg-warning);--danger:var(--sg-danger);-webkit-font-smoothing:antialiased}
[hidden]{display:none!important}
.launcher{position:fixed;right:24px;bottom:24px;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;cursor:grab}
.launcher>*{pointer-events:none}
button.launcher{display:inline-flex;align-items:center;gap:9px;height:48px;min-width:184px;padding:0 13px;border:0;border-radius:14px;background:var(--sg-solid);color:var(--ink);box-shadow:var(--sg-pane-shadow);font-size:13px;line-height:1;white-space:nowrap}
button.launcher:hover:not(:disabled),button.launcher:active:not(:disabled){background:var(--sg-solid-hover);color:var(--ink);box-shadow:var(--sg-pane-shadow)}
button.launcher:active:not(:disabled){transform:scale(.98)}
button.launcher.dragging,button.launcher.dragging:hover:not(:disabled),button.launcher.dragging:active:not(:disabled){background:var(--sg-solid-hover);box-shadow:var(--sg-pane-shadow);outline:2px solid var(--sg-focus);cursor:grabbing;transform:none;transition:none}
.launcher-mark{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--sg-brand-wash);color:var(--sg-brand);flex-shrink:0}
.launcher-mark svg{width:18px;height:18px}.launcher b{font-weight:650}.launcher i{width:5px;height:5px;flex-shrink:0;border-radius:50%;background:var(--muted);margin-left:3px}.launcher.running i{background:var(--sg-success)}.launcher span{font-size:12px;color:var(--muted);min-width:48px;text-align:left}.launcher.running span{color:var(--ink)}.launcher-grip{width:10px;height:16px;margin-left:3px;color:var(--muted);flex-shrink:0}
.panel{position:fixed;right:24px;bottom:82px;width:min(620px,calc(100vw - 32px));height:min(800px,calc(100dvh - 110px));display:flex;flex-direction:column;background:var(--sg-popover);border:0;border-radius:18px;box-shadow:inset 0 1px 0 var(--sg-rim),inset 0 0 0 1px var(--sg-inner),0 0 0 1px var(--sg-edge),0 24px 60px -18px var(--sg-shade),0 6px 16px -6px var(--sg-contact);overflow:hidden;backdrop-filter:blur(26px);-webkit-backdrop-filter:blur(26px)}
.head{padding:20px 22px 17px;display:flex;justify-content:space-between;gap:14px;align-items:center;flex-shrink:0;border-bottom:1px solid var(--line)}
.head-title{display:flex;gap:11px;align-items:center;min-width:0}.head-mark{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;background:var(--sg-control);box-shadow:var(--sg-state-shadow);color:var(--sg-brand);flex-shrink:0}.head-mark svg{width:21px;height:21px;filter:drop-shadow(-1px -1px 0 var(--sg-cyan))}
.head h1{font-size:17px;line-height:1.35;margin:0;font-weight:650;letter-spacing:.1px}.room{color:var(--muted);font-size:11px;margin-top:4px;overflow-wrap:anywhere}.head button{background:transparent;min-height:32px;padding:5px 9px;color:var(--muted);font-size:12px}
.banner{margin:0;background:color-mix(in srgb,var(--sg-warning) 7%,transparent);color:var(--sg-warning);padding:9px 22px;font-size:11px;border-bottom:1px solid color-mix(in srgb,var(--sg-warning) 20%,transparent);flex-shrink:0;line-height:1.6}.banner[hidden]{display:none}.banner button{font-size:11px;padding:3px 7px;min-height:26px}
.nav{border-bottom:1px solid var(--line);flex-shrink:0;padding:0 14px 9px;background:var(--sg-panel)}
.primary-nav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;padding:4px;margin:12px 4px 8px;background:var(--sg-well);border-radius:10px;box-shadow:inset 0 1px 3px var(--sg-contact),inset 0 -1px 0 var(--sg-inner)}
.primary-nav button{border:0;background:transparent;box-shadow:none;min-height:34px;padding:5px 8px;color:var(--muted);font-size:13px;font-weight:600;border-radius:7px}
.primary-nav button[aria-pressed=true],.primary-nav button:hover:not(:disabled){background:var(--sg-brand-wash);box-shadow:var(--sg-state-shadow);color:var(--sg-brand)}
.subnav{display:flex;flex-wrap:wrap;gap:4px;padding:2px 4px}
.subnav button{border:0;border-radius:7px;background:transparent;box-shadow:none;padding:6px 10px;white-space:nowrap;color:var(--muted);min-height:32px;font-size:12px}
.subnav button[aria-selected=true],.subnav button:hover:not(:disabled){background:var(--sg-brand-wash);box-shadow:var(--sg-state-shadow);color:var(--sg-brand)}
.subnav button:focus-visible{outline-offset:-2px}
.scroll{overflow-y:auto;overflow-x:hidden;min-height:0;flex:1;padding:22px;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--sg-scroll) transparent}
form{margin:0}.page{min-width:0}.page h2{font-size:20px;line-height:1.4;margin:0 0 5px;font-weight:650;letter-spacing:.1px}.intro,.hint{font-size:12px;color:var(--muted);margin:6px 0 16px;line-height:1.7}.page>.intro{margin:3px 0 20px}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.status{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin:0 0 14px}.status strong{font-size:13px;font-weight:600}.actions{display:flex;gap:7px;flex-wrap:wrap}
.stats{display:flex;margin:16px 0 20px;padding:14px 0;border-block:1px solid var(--line)}.stats div{flex:1}.stats b{font-size:24px;display:block;line-height:1.3;font-weight:600;font-variant-numeric:tabular-nums}.stats span{font-size:11px;color:var(--muted)}
.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px 14px}.wide{grid-column:1/-1}
.field{display:flex;flex-direction:column;gap:7px;margin:0 0 16px;min-width:0}.field span{font-size:12px;font-weight:600}.field small{color:var(--muted);font-size:11px;font-weight:400;line-height:1.6}.field input,.field select,.field textarea{width:100%;padding:10px 12px;min-height:42px}.field textarea{resize:vertical;min-height:92px;line-height:1.7}
.toggle{display:flex;align-items:center;gap:9px;min-height:38px;margin:3px 0 10px;font-size:13px}.toggle input{width:17px;height:17px;flex-shrink:0}
.section{padding-top:18px;margin-top:18px;border-top:1px solid var(--line)}.section h3,.subhead{font-size:13px;margin:0 0 10px;font-weight:600}.subhead{margin-top:20px}
.notice,.mode-note,.pk-note{padding:11px 13px;border:1px solid color-mix(in srgb,var(--sg-warning) 22%,transparent);border-radius:8px;background:color-mix(in srgb,var(--sg-warning) 7%,transparent);font-size:11px;color:var(--sg-warning);line-height:1.75;margin:14px 0}.mode-note{margin:0 0 12px}
.rule-summary{padding:12px 14px;margin:18px 0;background:var(--sg-panel);border-radius:10px;box-shadow:var(--sg-pane-shadow)}.rule-summary strong{font-size:11px;color:var(--muted);font-weight:500}.rule-summary p{margin:4px 0 0;font-size:13px;line-height:1.6;overflow-wrap:anywhere}
.queue{margin-top:10px}.candidate{border-bottom:1px solid var(--line);padding:12px 0;display:grid;grid-template-columns:74px minmax(0,1fr);gap:10px}.candidate .kind{font-size:11px;color:var(--ink);font-weight:600}.candidate textarea{display:block;width:100%;padding:8px 10px;resize:vertical;min-height:52px;margin-bottom:7px}.candidate p{margin:0 0 6px;overflow-wrap:anywhere}.candidate button{font-size:12px;padding:4px 9px;min-height:30px}
.empty{color:var(--muted);font-size:12px;padding:14px 0;line-height:1.7}.log-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}.log-head select{padding:5px 8px;max-width:150px}.logs{max-height:230px;overflow:auto;border-top:1px solid var(--line);scrollbar-color:var(--sg-scroll) transparent}.log{display:grid;grid-template-columns:54px 42px minmax(0,1fr);gap:8px;font-size:11px;padding:9px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.log time,.log .cat{color:var(--muted)}.log[data-category=error]{color:var(--danger)}.log[data-category=preview] .cat{color:var(--sg-success)}
.foot{padding:14px 22px;border-top:1px solid var(--line);background:var(--sg-panel);display:flex;justify-content:space-between;gap:12px;align-items:center;flex-shrink:0;box-shadow:0 -5px 20px var(--sg-contact)}.foot small{font-size:11px;color:var(--muted);max-width:210px}.foot .primary{min-width:132px;min-height:40px}.dirty{color:var(--sg-warning)!important}
.toast{padding:10px 22px;font-size:12px;background:color-mix(in srgb,var(--sg-success) 8%,var(--sg-solid));color:var(--sg-success);flex-shrink:0;border-bottom:1px solid color-mix(in srgb,var(--sg-success) 20%,transparent)}.toast.error{background:color-mix(in srgb,var(--sg-danger) 8%,var(--sg-solid));color:var(--danger)}
pre{font:12px/1.7 "SFMono-Regular",Consolas,monospace;white-space:pre-wrap;word-break:break-all;background:var(--sg-well);padding:14px;border:1px solid var(--line);border-radius:9px;color:var(--ink)}.inline{display:flex;gap:8px;align-items:center}.inline input{flex:1;min-width:0}.file{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.identity{padding:0 0 14px;border-bottom:1px solid var(--line);margin-bottom:16px}.identity strong{font-size:13px}.identity p{margin:4px 0;font-size:12px;color:var(--muted)}.identity .actions{margin-top:10px}.identity details{margin-top:4px}.identity summary{padding:3px 0}
.recent-gifts h3{margin:0;font-size:13px;font-weight:600}.gift-activity{display:grid;grid-template-columns:minmax(74px,1fr) minmax(90px,1.4fr) auto;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line);font-size:12px}.gift-activity strong,.gift-activity span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gift-activity small{color:var(--muted);text-align:right;font-variant-numeric:tabular-nums}
.editor-row{padding:14px 0;border-bottom:1px solid var(--line)}.editor-row .row-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.editor-row .row-head b{font-size:12px}.editor-row .row-head button{min-height:30px;padding:4px 9px;font-size:11px}.editor-row .grid{gap:8px 10px}.editor-row .field{margin-bottom:8px}.editor-row textarea{min-height:60px}.list-add{margin-top:10px}
.feature-shortcuts{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.feature-shortcuts button{font-size:12px}.feature-shortcuts button[aria-pressed=true]{background:var(--sg-control);box-shadow:var(--sg-state-shadow)}
summary{cursor:pointer;color:var(--muted);font-size:12px;padding:11px 0;line-height:1.6}summary:hover{color:var(--ink)}details[open]>summary{color:var(--ink)}.choice-hint{font-size:11px;color:var(--muted);line-height:1.5}
.settings-group{margin:0 0 16px;padding:16px;background:var(--sg-panel);border:0;border-radius:12px;box-shadow:var(--sg-pane-shadow)}.settings-group h3{font-size:13px;margin:0 0 4px;font-weight:600}.group-note{font-size:11px;line-height:1.7;color:var(--muted);margin:0 0 10px}.settings-group .field{margin-bottom:6px}.settings-group .mode-note{margin:6px 0 0}.settings-group+.section{margin-top:10px}
.feature-list{border-top:1px solid var(--line);margin:10px 0 12px}.settings-group .feature-list{margin:0}.feature-row{display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid var(--line)}.feature-row:last-child{border-bottom:0}.feature-title{flex:1;text-align:left;padding:0;border:0;background:transparent;box-shadow:none;font-weight:600;min-width:0;font-size:13px}.feature-title small{display:block;font-size:11px;color:var(--muted);font-weight:400;overflow-wrap:anywhere;margin-top:4px;line-height:1.6}
.text-button{border:0;background:transparent;box-shadow:none;font-size:12px;padding:4px 0;color:var(--muted);min-height:32px;text-align:left}.text-button:hover:not(:disabled),.feature-title:hover:not(:disabled){background:transparent;color:var(--ink);box-shadow:none}.text-button:hover{text-decoration:underline;text-underline-offset:4px}
.switch{position:relative;width:38px;height:24px;min-height:24px;padding:3px;border:0;border-radius:20px;flex-shrink:0;background:var(--sg-well);box-shadow:inset 0 1px 3px var(--sg-contact),inset 0 -1px 0 var(--sg-rim)}.switch input{position:absolute;inset:0;z-index:1;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}.switch span{display:block;height:18px;width:32px;border-radius:20px;background:transparent;transition:background-color 140ms}.switch span:after{content:"";display:block;height:18px;width:18px;border-radius:50%;background:var(--sg-knob-off);box-shadow:inset 0 1px 0 var(--sg-rim),0 1px 3px var(--sg-contact);transition:transform 140ms}.switch input:checked+span{background:var(--sg-primary)}.switch input:checked+span:after{transform:translateX(14px);background:var(--sg-knob)}.switch:has(input:focus-visible){outline:2px solid var(--sg-focus);outline-offset:3px}
.reply-section h3{font-size:13px;margin:0 0 8px}.reply-section p{font-size:12px;margin:0;line-height:1.7;overflow-wrap:anywhere}.reply-section [data-queue-section]{margin-top:12px}
.presets{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:-3px 0 14px}.presets span{font-size:11px;color:var(--muted);margin-right:3px}.presets button{min-height:30px;padding:4px 10px;font-size:11px}
.overview-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:14px 0 18px;border-block:1px solid var(--line)}.overview-metric{padding:14px 10px 14px 0;min-width:0}.overview-metric+.overview-metric{border-left:1px solid var(--line);padding-left:14px}.overview-metric b{display:block;font-size:24px;line-height:1.2;font-variant-numeric:tabular-nums}.overview-metric span{display:block;margin-top:6px;color:var(--muted);font-size:11px}
.overview-block{padding:14px 0;border-top:1px solid var(--line)}.overview-block h3{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 8px;font-size:13px}.overview-block .text-button{flex:0 0 auto}.overview-empty{padding:8px 0;color:var(--muted);font-size:12px}.overview-item{display:grid;grid-template-columns:54px minmax(0,1fr);gap:8px;padding:9px 0;border-bottom:1px solid var(--line);font-size:12px}.overview-item:last-child{border-bottom:0}.overview-item time{font-variant-numeric:tabular-nums;color:var(--muted);font-size:11px}.overview-item span{overflow-wrap:anywhere}.overview-item[data-category=moderation] span{color:var(--sg-warning)}.overview-item[data-category=error] span{color:var(--danger)}.overview-queue{font-size:12px;line-height:1.6;overflow-wrap:anywhere}.overview-queue small{display:block;color:var(--muted);font-size:11px}.overview-note{margin:12px 0 0;padding:10px 12px;background:var(--sg-panel);color:var(--muted);border-radius:8px;font-size:11px;line-height:1.6}
.gift-totals{margin:16px 0 20px;padding:16px 18px;background:var(--sg-card);border-radius:12px;box-shadow:var(--sg-pane-shadow)}.gift-totals h3{margin:0 0 14px;font-size:12px;font-weight:500;color:var(--muted)}.gift-total-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.gift-total-grid>div{min-width:0}.gift-total-grid>div+div{padding-left:18px;border-left:1px solid var(--line)}.gift-total-grid b{display:block;font-size:28px;line-height:1.3;font-weight:550;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.gift-total-grid span,.gift-total-note{font-size:11px;color:var(--muted)}.gift-total-grid span{display:block;margin-top:5px}.gift-total-note{margin:14px 0 0;line-height:1.7}.gift-totals .text-button{margin-top:6px;font-size:11px}
.income-hero{padding:18px;background:var(--sg-card);border-radius:12px;box-shadow:var(--sg-pane-shadow);margin:4px 0 18px}.income-hero>span{font-size:12px;color:var(--muted)}.income-hero>b{display:block;font-size:32px;line-height:1.4;letter-spacing:-.5px;margin:6px 0 14px;font-weight:550}.income-meta{display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:var(--muted)}.income-meta strong{color:var(--ink);font-weight:600}.income-hero b,.income-meta strong,.income-table{font-variant-numeric:tabular-nums}.income-hero .hint{margin-bottom:0}.income-table{width:100%;border-collapse:collapse;font-size:12px}.income-table th,.income-table td{text-align:right;padding:11px 6px;border-bottom:1px solid var(--line)}.income-table th{font-size:11px;color:var(--muted);font-weight:500}.income-table th:first-child,.income-table td:first-child{text-align:left;padding-left:0;white-space:nowrap}.income-table-wrap{overflow-x:auto}.income-error{color:var(--danger);font-size:12px}
.profile-card{padding:14px 0;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:12px}.profile-card strong,.profile-card small{display:block;overflow-wrap:anywhere}.profile-card strong{font-size:13px}.profile-card small{font-size:11px;color:var(--muted);margin-top:4px}.profile-card a{color:var(--ink);font-size:12px;white-space:nowrap;text-decoration:none;padding:10px 0}.profile-card a:hover{text-decoration:underline}.income-toolbar{margin:18px 0;display:flex;align-items:center;justify-content:space-between;gap:12px}.income-toolbar h3{font-size:13px;margin:0}
.pk-scoreboard{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:12px;align-items:center;padding:20px 12px;background:var(--sg-card);border-radius:12px;box-shadow:var(--sg-pane-shadow);text-align:center}.pk-scoreboard strong{display:block;font-size:30px;font-weight:550;font-variant-numeric:tabular-nums}.pk-scoreboard span{display:block;font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:5px}.pk-scoreboard .vs{font-size:11px;color:var(--muted)}.pk-prob{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:16px 0}.pk-prob>div{padding:13px 14px;background:var(--sg-panel);border-radius:9px}.pk-prob b{display:block;font-size:21px;font-weight:550;font-variant-numeric:tabular-nums}.pk-prob span{font-size:11px;color:var(--muted)}.pk-factors{margin:0;padding-left:18px;font-size:12px;color:var(--muted);line-height:1.8}.pk-table{width:100%;border-collapse:collapse;font-size:12px}.pk-table th,.pk-table td{text-align:left;padding:10px 4px;border-bottom:1px solid var(--line)}.pk-table th{font-size:11px;color:var(--muted);font-weight:500}.pk-table td:last-child,.pk-table th:last-child{text-align:right;font-variant-numeric:tabular-nums}
.pk-multi{margin:14px 0}.pk-multi table{table-layout:fixed}.pk-multi th:first-child,.pk-multi td:first-child{width:38%}.pk-multi th:nth-child(2),.pk-multi td:nth-child(2){text-align:right}.pk-multi td:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pk-multi tr[data-self=true] td:first-child{font-weight:650;color:var(--sg-success)}
.pk-scoreboard>div:first-child strong{color:var(--sg-success)}.pk-scoreboard>div:last-child strong{color:var(--sg-brand)}
.pk-verdict{padding:14px 0 16px}.pk-verdict strong{display:block;font-size:17px;font-weight:600;line-height:1.5}.pk-verdict p,.pk-freshness{font-size:11px;color:var(--muted);margin:6px 0 0;line-height:1.7}.pk-freshness[data-stale=true]{color:var(--amber)}
.pk-lead{height:4px;display:flex;overflow:hidden;border-radius:4px;background:var(--sg-well);margin-top:12px}.pk-lead span:first-child{background:var(--sg-success)}.pk-lead span:last-child{background:var(--sg-brand)}
.pk-chart-head{display:flex;gap:12px;align-items:center;justify-content:space-between;margin:20px 0 12px}.pk-chart-head h3{margin:0;font-size:13px;font-weight:600}.pk-chart-head select{width:auto;min-height:34px;padding:5px 8px;font-size:11px}.pk-chart{height:208px;width:100%;min-width:0}.pk-chart-gap{height:152px}.pk-chart-contributions{height:220px}.pk-chart-empty{min-height:104px;display:grid;place-items:center;text-align:center;padding:16px;color:var(--muted);font-size:12px;line-height:1.7;background:var(--sg-well);border-radius:8px}
.pk-reading{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}.pk-reading>div{padding:12px;background:var(--sg-panel);border-radius:8px}.pk-reading span{font-size:11px;color:var(--muted);display:block}.pk-reading strong{font-size:17px;font-weight:550;display:block;margin-top:5px;font-variant-numeric:tabular-nums}.pk-data-detail{margin:16px 0}.pk-data-detail summary{font-size:12px;cursor:pointer;min-height:36px;display:flex;align-items:center;color:var(--muted)}.pk-data-scroll{overflow:auto;max-height:240px}.pk-data-scroll table{min-width:280px}.pk-effect-list{font-size:12px;line-height:1.8;color:var(--muted);padding-left:18px}
.shell-status{display:flex;justify-content:space-between;gap:12px;padding:8px 18px;border-bottom:1px solid var(--line);font-size:11px;color:var(--muted);background:var(--sg-background)}.shell-status strong{font-weight:600;color:var(--ink)}
::selection{background:var(--sg-brand-wash);color:var(--ink)}input,textarea{caret-color:var(--sg-brand)}
/* Compact operational surfaces: clear hierarchy, restrained depth and brief state motion. */
.panel{width:min(620px,calc(100vw - 32px));background:var(--sg-popover);border:1px solid var(--line);border-radius:14px;box-shadow:0 18px 50px -24px var(--sg-shade);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.head{padding:15px 18px 13px}.head-mark{width:32px;height:32px;border-radius:8px;box-shadow:none}.head-mark svg{filter:none}
.nav{padding:0 14px 8px;background:var(--sg-background)}.primary-nav{margin:8px 2px 6px;padding:3px;border-radius:8px;box-shadow:none}.primary-nav button{min-height:32px}.subnav{gap:2px;padding:1px 2px}.subnav button{min-height:34px;padding:5px 9px}
.scroll{padding:18px 20px}.page h2{font-size:19px;line-height:1.35}.page>.intro{margin:4px 0 14px;max-width:64ch}.settings-group{margin:0;padding:14px 0;border-bottom:1px solid var(--line);border-radius:0;background:transparent;box-shadow:none}.settings-group+.settings-group{margin-top:0}.rule-summary{padding:10px 12px;background:var(--sg-well);border-radius:7px;box-shadow:none}
.income-controls{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:end}.income-controls .field{margin:0 0 10px}.income-hero{padding:16px 0 12px;background:transparent;border-block:1px solid var(--line);border-radius:0;box-shadow:none}.income-hero>b{font-size:30px;line-height:1.2;font-variant-numeric:tabular-nums}.income-toolbar{margin:14px 0 8px}.income-toolbar h3{font-size:13px}.income-error{padding:9px 11px;border-radius:6px}
.foot{padding:11px 18px;background:var(--sg-background);box-shadow:none}.foot .primary{min-height:38px}
.subnav button,.primary-nav button,.switch span:after{transition:background-color 140ms ease-out,color 140ms ease-out,transform 140ms ease-out}
@supports not (backdrop-filter:blur(1px)){.panel{background:var(--sg-solid)}}
@media(max-width:560px){.panel{width:calc(100vw - 20px);height:calc(100dvh - 24px);border-radius:14px}.launcher{right:12px;bottom:12px}.grid{grid-template-columns:minmax(0,1fr)}.head{padding:16px}.head h1{font-size:16px}.scroll{padding:18px 16px}.banner{padding:9px 16px}.nav{padding:0 10px 8px}.primary-nav{margin-top:10px}.subnav{gap:3px}.subnav button{font-size:11px;padding:5px 9px}.foot{padding:12px 16px}.foot small{max-width:140px}.foot .primary{min-width:116px}.row{gap:8px}.candidate{grid-template-columns:64px minmax(0,1fr)}.gift-activity{grid-template-columns:minmax(65px,1fr) minmax(75px,1.2fr) auto;gap:5px;font-size:11px}.gift-total-grid b{font-size:24px}.gift-totals{padding:14px}.settings-group{padding:14px 0}.income-controls{grid-template-columns:minmax(0,1fr)}.income-hero>b{font-size:26px}.log-head{flex-wrap:wrap}.head-mark{width:32px;height:32px}}
`;

export class Panel {
  constructor({ config, room, demo = false, callbacks }) {
    this.config = config; this.room = room; this.demo = demo; this.callbacks = callbacks; this.entries = []; this.open = true; this.anchorView = 'overview'; this.activeTab = 'pk'; this.activeCategory = 'interaction'; this.dirty = false; this.rowSerial = 0; this.logDirty = false; this.viewers = [];
    this.busyActions = new Set(); this.anchorIncome = null; this.host = document.createElement('div'); this.host.id = 'douyin-live-assistant'; this.host.style.cssText = 'position:fixed;z-index:2147483000;inset:0;pointer-events:none';
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = `${SOLID_GLASS_CSS}${CSS_TEXT}${ANCHOR_DASHBOARD_CSS}${FLOATING_WINDOW_CSS}${ADAPTIVE_LAYOUT_CSS}${NAVIGATION_CSS}.panel,.launcher{pointer-events:auto}`; this.root.append(style);
    this.root.append(this.build()); decorateActionIcons(this.root); document.body.append(this.host); this.navigation = new Navigation(this.root, {onError:message=>this.toast(message,true)}); this.adaptive = new AdaptiveLayout(this.root); this.theme = installTheme({ target:this.host, select:this.root.querySelector('[data-theme-choice]'), onError:message=>this.toast(message,true) }); this.charts = new LiveCharts(this.root); this.cache = new Map(); this.anchorDashboard = new AnchorDashboard(this.root, () => { if (this.latest) this.renderAnchor(this.latest[0]); }); this.populate(config); this.bind(); this.floating = new FloatingWindow({root:this.root, onToggle:() => this.toggleOpen()});
  }
  input(path, label, type = 'text', hint = '') {
    return `<label class="field"><span>${label}</span><input data-field="${path}" type="${type}" ${type === 'number' ? 'step="any"' : ''}>${hint ? `<small>${hint}</small>` : ''}</label>`;
  }
  area(path, label, format = 'lines', hint = '') {
    return `<label class="field"><span>${label}</span><textarea data-field="${path}" data-format="${format}" rows="3" spellcheck="false"></textarea>${hint ? `<small>${hint}</small>` : ''}</label>`;
  }
  toggle(path, label) { return `<label class="toggle"><input type="checkbox" data-field="${path}">${label}</label>`; }
  select(path, label, choices) {
    return `<label class="field"><span>${label}</span><select data-field="${path}">${choices.map(([v, title]) => `<option value="${v}"${v === 'ai' ? ' data-ai-choice hidden' : ''}>${title}</option>`).join('')}</select></label>`;
  }
  build() {
    const container = document.createElement('div');

    container.innerHTML = `
      <button type="button" class="launcher" aria-controls="assistant-panel" aria-expanded="true" aria-label="收起场控面板，当前已暂停" title="点击收起 · 拖动调整位置"><div class="launcher-mark" aria-hidden="true">${icon('radio')}</div><b>场控</b><i aria-hidden="true"></i><span>已暂停</span><svg class="launcher-grip" aria-hidden="true" viewBox="0 0 10 16" fill="currentColor"><circle cx="3" cy="4" r="1"/><circle cx="7" cy="4" r="1"/><circle cx="3" cy="8" r="1"/><circle cx="7" cy="8" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="7" cy="12" r="1"/></svg></button>
      <div class="dock-hint" aria-hidden="true"></div><div class="floating-panel" data-interactive="true">
      <section class="panel" id="assistant-panel" data-slot="panel" aria-label="抖音直播运营助手控制台">
        <header class="head" data-slot="panel-header"><div class="head-title"><span class="head-mark" aria-hidden="true">${icon('radio')}</span><div><h1>抖音直播运营助手</h1><div class="room">${this.demo ? '模拟直播间' : `直播间 ${esc(this.room)}`}</div></div></div><button type="button" data-action="close" aria-label="收起面板">收起</button></header>
        <div class="shell-status" aria-label="场控状态"><strong data-shell-state>已暂停</strong><span data-shell-network>等待直播数据</span></div>
        ${this.demo ? '<p class="banner">本地演示：弹幕和礼物均为模拟数据，消息不会发到抖音。</p>' : ''}
        <div class="banner" data-runtime-alert role="status" hidden><strong data-runtime-alert-text></strong> <button type="button" data-go="diagnostics" data-ack-runtime-alert>查看并处理</button></div>
        <div class="workspace">
        ${navigationTemplate(this.activeTab)}
        <main class="workspace-content" aria-label="功能页面">
        <div class="toast" role="status" hidden></div>
        <div class="scroll"><form autocomplete="off">
          <section class="page" id="page-overview" data-page="overview" aria-label="暂存总览" hidden>
            <h2>直播总览</h2><p class="intro">查看房间连接、场控记录和近期提醒。</p>
            <div class="status"><strong data-overview-state>已暂停</strong><span class="badge" data-slot="tag" data-network>等待直播数据</span></div>
            <div class="overview-metrics" aria-label="本场运行概况"><div class="overview-metric"><b data-overview-stat="events">0</b><span>已处理事件</span></div><div class="overview-metric"><b data-overview-stat="submitted">0</b><span>已提交</span></div><div class="overview-metric"><b data-overview-stat="alerts">0</b><span>近期提醒</span></div></div>
            <section class="overview-block"><h3>管理员提醒 <button type="button" class="text-button" data-go="diagnostics">查看运行记录</button></h3><div data-overview-alerts><div class="overview-empty">启动后，内容提醒与连接异常会显示在这里。</div></div></section>
            <section class="overview-block"><h3>最近回复 <button type="button" class="text-button" data-go="replies">查看记录</button></h3><p data-overview-reply class="overview-empty">暂无回复记录。</p></section>
            <p class="overview-note">提醒用于辅助管理员核查；无法确认的账号身份或权限会保持未知。</p>
          </section>
          <section class="page" role="tabpanel" id="page-pk" aria-labelledby="tab-pk" data-page="pk" hidden>
            <h2>PK 局势看板</h2><p class="intro">比分、追分速度与贡献者，随直播推送更新。</p>
            <div class="pk-overview">
            <div class="pk-overview-main">
            <div class="status"><strong data-pk-state>等待 PK 事件</strong><span class="badge" data-slot="tag" data-pk-quality>数据不足</span></div>
            <div class="pk-scoreboard"><div><strong data-pk-self-score>--</strong><span data-pk-self-name>己方</span></div><div class="vs">VS<br><small data-pk-remaining>--</small></div><div><strong data-pk-opponent-score>--</strong><span data-pk-opponent-name>对方</span></div></div>
            <section class="pk-multi" data-pk-multi hidden><h3>多人 PK 排名与夺冠估计</h3><div class="pk-data-scroll"><table class="pk-table"><thead><tr><th>主播</th><th>比分</th><th>夺冠估计</th></tr></thead><tbody data-pk-competitors><tr><td colspan="3">等待完整比分</td></tr></tbody></table></div></section>
            <div class="pk-lead" role="img" aria-label="等待双方比分" data-pk-lead><span style="width:50%"></span><span style="width:50%"></span></div>
            <p class="pk-freshness" data-pk-freshness>等待双方精确比分；未观测的分数保持未知。</p>
            <div class="pk-verdict"><strong data-pk-summary>等待可分析的战局</strong><p data-pk-basis>收到比分后显示领先、追分压力与数据覆盖情况。</p></div>
</div><details class="adaptive-detail pk-outlook" data-adaptive-details><summary>追分推演与数据质量</summary><div class="adaptive-detail-body">
              <div class="pk-reading"><div><span>按近期速度推演的终局分差</span><strong data-pk-projected>--</strong></div><div><span>己方反超所需总分速</span><strong data-pk-required-rate>--</strong></div></div>
            <div class="pk-prob"><div><b data-pk-self-win>未知</b><span>己方获胜估计</span></div><div><b data-pk-opponent-win>未知</b><span>对方获胜估计</span></div></div>
            <div class="grid"><div><span class="choice-hint">近 15 秒速度 · 己 / 对 · 分/秒</span><p><strong data-pk-self-speed>--</strong> / <strong data-pk-opponent-speed>--</strong></p></div><div><span class="choice-hint">近 60 秒速度 · 己 / 对 · 分/秒</span><p><strong data-pk-self-velocity>--</strong> / <strong data-pk-opponent-velocity>--</strong></p></div><div><span class="choice-hint">模型可信程度</span><p><strong data-pk-confidence>--</strong></p></div><div><span class="choice-hint">比分样本与处理延迟</span><p><strong data-pk-sample>--</strong></p></div></div>

</div></details></div>
            <div class="pk-workspace">
<section class="pk-visual pk-score-visual">            <div class="pk-chart-head"><h3>比分走势</h3><select data-pk-window aria-label="图表时间范围"><option value="60000">近 1 分钟</option><option value="180000" selected>近 3 分钟</option><option value="0">本场全部</option></select></div>
            <div class="pk-chart" data-pk-chart="scores" hidden role="img" aria-label="PK参战方比分走势"></div><p class="pk-chart-empty">等待本场比分推送，图表不会填充模拟数据。</p>
</section><details class="adaptive-detail pk-visual pk-gap-visual" data-adaptive-details><summary>分差变化 · 正数为己方领先</summary><div class="adaptive-detail-body">
              <div class="pk-chart pk-chart-gap" data-pk-chart="gap" hidden role="img" aria-label="己方分差随时间变化"></div><p class="pk-chart-empty">双方精确比分就绪后，呈现分差。</p>
</div></details>            <section class="pk-visual pk-contribution-visual"><h3>贡献榜 · 双方前 8 名</h3><div class="pk-chart pk-chart-contributions" data-pk-chart="contributions" hidden role="img" aria-label="已观测贡献榜前八名"></div><p class="pk-chart-empty">尚未采集贡献榜；礼物钻石不会替代 PK 贡献分。</p><details class="pk-data-detail"><summary>查看贡献者明细</summary><div class="pk-data-scroll"><table class="pk-table"><thead><tr><th>观众</th><th>阵营</th><th>贡献分</th><th>礼物钻石</th></tr></thead><tbody data-pk-contributors><tr><td colspan="4">暂无贡献者数据</td></tr></tbody></table></div></details></section>
<details class="adaptive-detail pk-visual pk-activity-visual" data-adaptive-details><summary>直播活动 · 最近 10 分钟</summary><div class="adaptive-detail-body">
              <p class="choice-hint">每 10 秒汇总本页观测；暂停场控仍持续采集。</p><div class="pk-chart" data-pk-chart="activity" hidden role="img" aria-label="每10秒的弹幕、进场与礼物件数"></div><p class="pk-chart-empty">等待本页直播互动。</p><p class="choice-hint" data-live-totals>尚无互动数据</p></div></details></div>
            <div class="pk-analysis">
<details class="adaptive-detail " data-adaptive-details><summary>局势因素、送礼与场上加成</summary><div class="adaptive-detail-body">
              <section class="section"><h3>局势因素</h3><ul class="pk-factors" data-pk-factors><li>等待可用比分或礼物事件。</li></ul></section>            <section class="section"><h3>近期送礼活跃度</h3><table class="pk-table"><thead><tr><th>侧</th><th>活跃用户占比</th><th>观测用户</th><th>已观测钻石</th></tr></thead><tbody data-pk-intent><tr><td colspan="4" class="empty">暂无可估计样本</td></tr></tbody></table></section>
            <section class="section"><h3>场上加成与卡片</h3><ul class="pk-effect-list" data-pk-effects><li>尚未采集明确的活动窗口。</li></ul></section>
</div></details><details class="adaptive-detail " data-adaptive-details><summary>对面弹幕与活动经验记录</summary><div class="adaptive-detail-body">
              <section class="section"><h3>对面弹幕信号</h3><p data-pk-chat class="empty">等待已采集的对手房间弹幕。</p><div class="grid"><div><span class="choice-hint">近 60 秒样本</span><p><strong data-pk-chat-recent>--</strong></p></div><div><span class="choice-hint">求援倾向</span><p><strong data-pk-chat-request>--</strong></p></div><div><span class="choice-hint">反超倾向</span><p><strong data-pk-chat-comeback>--</strong></p></div><div><span class="choice-hint">情绪信号</span><p><strong data-pk-chat-sentiment>--</strong></p></div></div></section>
            <section class="section"><h3>活动与卡片经验记录</h3><table class="pk-table"><thead><tr><th>项目</th><th>命中 / 样本</th><th>经验频率</th><th>区间</th></tr></thead><tbody data-pk-rates><tr><td colspan="4" class="empty">尚无已记录样本</td></tr></tbody></table></section>
</div></details></div>
            <details class="pk-data-detail" data-adaptive-details><summary data-pk-score-summary>查看比分明细（最近 20 次）</summary><div class="pk-data-scroll"><table class="pk-table"><thead><tr data-pk-score-header><th>北京时间</th><th>己方</th><th>对方</th><th>分差</th></tr></thead><tbody data-pk-score-rows><tr><td colspan="4">等待比分</td></tr></tbody></table></div></details>
            <p class="pk-note">这是基于当前页面观测和历史样本的估计，不是抖音官方胜率。3 倍加成、卡片和宝箱概率只会按你实际记录的场次给出经验频率与区间；样本不足时保持未知。</p>
          </section>
          ${anchorPageTemplate(this.room)}
          <section class="page" role="tabpanel" id="page-runtime" aria-labelledby="tab-runtime" data-page="runtime" hidden>
            <h2>运行规则</h2><p class="intro">符合规则的消息按优先级及时发送。</p>
            <div class="status"><strong data-state>已暂停</strong></div>
            <section class="settings-group"><h3>互动发送</h3><p class="group-note">所有已接受的互动按优先级连续处理；发送控件就绪后立即提交，无需逐条审核。</p><div class="grid">${this.select('mode', '回复方式', [['auto', '自动发送'], ['preview', '仅预览，不发送']])}</div><label class="toggle"><input type="checkbox" data-field="automation.autoStart">进入此主播直播间后自动开始场控</label><p class="hint">仅当前主播生效；连接未就绪时等待恢复。手动暂停后本次页面不会自动重启。</p><div class="mode-note" data-mode-note>符合规则的回复会自动发送。</div></section>
          </section>
          <section class="page" role="tabpanel" id="page-appearance" aria-labelledby="tab-appearance" data-page="appearance" hidden>
            <h2>外观</h2><p class="intro">选择适合当前环境的亮暗模式。</p>
            <section class="settings-group"><h3>颜色模式</h3><p class="group-note">默认跟随浏览器或系统的颜色偏好，系统切换时自动更新。</p><label class="field"><span>显示模式</span><select data-theme-choice aria-label="显示模式"><option value="system">跟随系统</option><option value="light">亮色</option><option value="dark">暗色</option></select></label><p class="group-note">选择后自动保存，应用于所有直播间面板与扩展弹窗。</p></section>
            <section class="settings-group"><h3>导航布局</h3><p class="group-note">宽窗口使用侧边栏，窄窗口自动切换为顶部导航。</p><label class="field"><span>侧边栏位置</span><select data-sidebar-side aria-label="侧边栏位置"><option value="left">左侧</option><option value="right">右侧</option></select><small>按操作习惯选择；右侧也适合左手操作。选择后自动保存到当前浏览器。</small></label></section>
          </section>
          <section class="page" role="tabpanel" id="page-features" aria-labelledby="tab-features" data-page="features" hidden>
            <h2>功能开关</h2><p class="intro">集中启用或停用直播互动模块；关闭后，该模块从互动导航中隐藏。</p>
            <div class="settings-workspace">
            <section class="settings-group"><h3>礼物与进场</h3><p class="group-note">按观众送礼和进入直播间事件触发。</p><div class="feature-list">${[['gift','礼物感谢'],['welcome','进场欢迎']].map(([key,label]) => `<div class="feature-row"><div class="feature-title">${label}<small data-feature-note="${key}"></small></div><label class="switch" aria-label="${label}"><input type="checkbox" role="switch" data-field="${key}.enabled" aria-label="${label}"><span></span></label></div>`).join('')}</div></section>
            <section class="settings-group"><h3>弹幕与反馈</h3><p class="group-note">按点赞、弹幕内容或提醒条件触发。</p><div class="feature-list">${[['like','点赞感谢'],['keyword','关键词回复']].map(([key,label]) => `<div class="feature-row"><div class="feature-title">${label}<small data-feature-note="${key}"></small></div><label class="switch" aria-label="${label}"><input type="checkbox" role="switch" data-field="${key}.enabled" aria-label="${label}"><span></span></label></div>`).join('')}<div class="feature-row"><div class="feature-title">内容提醒<small data-feature-note="moderation"></small></div><label class="switch" aria-label="内容提醒"><input type="checkbox" role="switch" data-field="moderation.enabled" aria-label="内容提醒"><span></span></label></div></div></section>
            <section class="settings-group"><h3>@ 机器人</h3><p class="group-note">观众 @ 当前登录账号参加互动；启用 AI 服务后优先 AI 接话，不可用时自动使用内置回复。</p><div class="feature-list"><div class="feature-row"><div class="feature-title">机器人互动<small data-feature-note="bot"></small></div><label class="switch" aria-label="机器人互动"><input type="checkbox" role="switch" data-field="bot.enabled" aria-label="机器人互动"><span></span></label></div></div></section>
            <section class="settings-group"><h3>计划互动</h3><p class="group-note">按已配置的时间间隔循环发送。</p><div class="feature-list"><div class="feature-row"><div class="feature-title">定时消息<small data-feature-note="timers"></small></div><label class="switch" aria-label="定时消息"><input type="checkbox" role="switch" data-field="timersEnabled" aria-label="定时消息"><span></span></label></div></div></section>
            <section class="settings-group"><h3>礼物账本</h3><p class="group-note">独立于礼物感谢，按主播与直播场次保存统计。</p><div class="feature-list"><div class="feature-row"><div class="feature-title">收入统计<small>本地保存每场直播的礼物价值与月度收入估算；关闭后停止采集，历史数据仍保留。</small></div><label class="switch" aria-label="收入统计"><input type="checkbox" role="switch" data-field="incomeEnabled" aria-label="收入统计"><span></span></label></div></div></section>
            <section class="settings-group"><h3>AI 互动</h3><p class="group-note">先启用 AI 服务，再单独决定要使用的 AI 功能。</p><div class="feature-list"><div class="feature-row"><div class="feature-title">AI 服务<small data-feature-note="ai-service"></small></div><label class="switch" aria-label="AI 服务"><input type="checkbox" role="switch" data-field="ai.enabled" aria-label="AI 服务"><span></span></label></div><div class="feature-row"><div class="feature-title">AI 弹幕问答<small data-feature-note="ai-chat"></small></div><label class="switch" aria-label="AI 弹幕问答"><input type="checkbox" role="switch" data-field="ai.chatEnabled" aria-label="AI 弹幕问答"><span></span></label></div><div class="feature-row"><div class="feature-title">AI 冷场互动<small data-feature-note="ai-idle"></small></div><label class="switch" aria-label="AI 冷场互动"><input type="checkbox" role="switch" data-field="ai.idleEnabled" aria-label="AI 冷场互动"><span></span></label></div></div><button type="button" class="text-button" data-go="ai">配置 AI 服务与问答</button></section></div>
          </section>
          <section class="page" id="page-replies" data-page="replies" aria-label="回复记录（暂未开放）" hidden>
            <h2>回复记录</h2><p class="intro">查看最近预览和已提交的回复。</p>
            <section class="reply-section"><h3 data-reply-title>最近回复</h3><p data-last-reply class="empty">开始后，符合规则的回复会显示在这里。</p></section>
          </section>
          <section class="page" role="tabpanel" id="page-gift" aria-labelledby="tab-gift" data-page="gift" hidden>
            <h2>礼物感谢</h2><p class="intro">设置感谢门槛与话术；礼物连击会合并计算。</p>
            <div class="settings-workspace gift-workspace">
            <div class="settings-column">
            <section class="gift-totals" data-gift-totals aria-label="礼物价值统计"><h3 data-gift-total-title>本场礼物价值</h3><div class="gift-total-grid"><div><b data-gift-diamonds>0</b><span>已知礼物面值 · 钻</span></div><div><b data-gift-income>未设置</b><span>收入估算 · 人民币</span></div></div><p class="gift-total-note" data-gift-estimate-note>正在读取本地账本…</p><button type="button" class="text-button" data-go="anchor" data-anchor-target="income" data-income-link>查看收入账本</button></section>
            <section class="recent-gifts section"><div class="log-head"><h3>近期送礼</h3><span class="choice-hint" data-gift-count>仅保留本次页面数据</span></div><div data-recent-gifts><p class="empty">收到礼物后，送礼用户和已知礼物信息会显示在这里。</p></div></section>
</div>
            <div class="settings-column">
            <div class="rule-summary"><strong>当前规则</strong><p data-summary="gift"></p></div>
            ${this.select('gift.responseMode', '答谢生成方式', [['rules', '使用预设话术'], ['ai', '使用 AI 生成']])}
            ${this.input('gift.minValue', '达到多少钻石才感谢', 'number')}
            ${this.input('gift.yuanPerDiamond', '收入估算比例 / 元每钻', 'number')}
            <p class="hint">默认按 100 钻约 10 元、主播分成约一半估算（0.05 元/钻）；请按主播结算情况调整。</p>
            <div class="presets" aria-label="常用礼物阈值"><span>快速设为</span>${[[50,'50'],[100,'100'],[500,'500'],[1000,'1000']].map(([value,label])=>`<button type="button" data-gift-value="${value}">${label} 钻</button>`).join('')}</div>
            <details><summary>筛选与防刷屏</summary>${this.select('gift.basis', '按什么计算价值', [['total', '整次连击的总价值（推荐）'], ['unit', '单个礼物的价值']])}</details>
            ${this.area('gift.templates', '感谢话术（每行一条，轮流使用）', 'lines', '变量：{user} 自动称呼、{nickname} 原昵称、{gift} 礼物名、{count} 数量、{value} 总钻石、{unit} 单价。公开性别为男/女时称哥/姐；未知或已知未成年时仅用昵称，不猜年龄。')}
            <div class="notice">单价未知时，在 1 钻默认门槛下仍会使用不含金额的通用感谢；提高门槛后，需先补充礼物单价才可判断是否感谢。未知单价不会计入收入估算。</div>
            <details><summary>补充未知礼物的单价</summary><div data-list="prices"></div><button type="button" class="list-add" data-add="prices">添加礼物单价</button><p class="hint">填礼物名称或 ID，仅在直播消息缺少单价时使用。</p></details></div></div>
          </section>
          <section class="page" role="tabpanel" id="page-profiles" aria-labelledby="tab-profiles" data-page="profiles" hidden>
            <h2>主播管理</h2><p class="intro">每位主播的互动规则、功能开关、AI 配置与收入比例独立保存。进入直播间自动载入对应配置。</p>
            <div class="settings-workspace">
            <section class="settings-group"><h3>已添加的主播</h3><div data-profiles><p class="empty">正在读取主播列表…</p></div></section>
            <section class="settings-group"><h3>添加主播</h3><p class="group-note">粘贴抖音直播间地址，打开该直播间即可配置。</p><label class="field"><span>直播间地址</span><input type="url" data-profile-url placeholder="https://live.douyin.com/直播间号"></label><button type="button" data-action="add-profile">添加主播</button></section>
            <p class="hint">“打开并配置”会进入对应主播的直播间，不会自动开始场控。AI 服务密钥按接口域名保存，同一服务可共用密钥。</p></div>
          </section>
          <section class="page" role="tabpanel" id="page-welcome" aria-labelledby="tab-welcome" data-page="welcome" hidden>
            <h2>进场欢迎</h2><p class="intro">按荣誉等级、本房粉丝团或指定名单欢迎观众。</p>
            <div class="rule-summary"><strong>当前规则</strong><p data-summary="welcome"></p></div>
            ${this.select('welcome.responseMode', '欢迎生成方式', [['rules', '使用预设话术'], ['ai', '使用 AI 生成']])}
            ${this.select('welcome.mode', '欢迎范围', [['qualified-or-listed', '达标用户 + 指定名单'], ['qualified', '只欢迎达标用户'], ['listed', '只欢迎指定名单']])}
            <div data-qualified><div class="grid">${this.input('welcome.minWealth', '最低荣誉等级', 'number')}${this.input('welcome.minFanLevel', '最低粉丝团等级', 'number')}</div>
            ${this.toggle('welcome.requireFan', '必须加入本直播间粉丝团')}${this.toggle('welcome.requireLit', '粉丝牌必须已点亮')}</div>
            <details class="section"><summary>管理员弹幕欢迎</summary>${this.toggle('welcome.admin.enabled', '达到等级后使用管理员弹幕')}<div class="grid">${this.input('welcome.admin.minWealth', '管理员弹幕最低荣誉等级', 'number')}${this.input('welcome.admin.minFanLevel', '管理员弹幕最低灯牌等级', 'number')}</div><p class="hint">荣誉与本房灯牌须同时达到门槛，且均不能低于基础欢迎；点亮要求沿用基础欢迎。指定名单也须满足这些条件。管理员弹幕选项不可用时使用普通弹幕。</p></details>
            <details data-welcome-list><summary>指定欢迎的人</summary><div class="inline"><select data-viewer-picker aria-label="最近观众"><option value="">等待观众出现…</option></select><button type="button" data-action="add-viewer">加入欢迎名单</button></div><p class="hint">优先按账号识别；仅有昵称的备用弹幕可能重名。</p><div data-list="listed"></div><button type="button" class="list-add" data-add="listed">手动添加用户</button></details>
            ${this.area('welcome.templates', '欢迎话术（每行一条）', 'lines', '变量：{user}、{level} 荣誉等级、{fanLevel} 粉丝团等级。')}
            <div class="notice">无法核实主播 UID、粉丝团或等级时，条件筛选不会通过。指定名单仍可按明确身份匹配。</div>
          </section>
          <section class="page" role="tabpanel" id="page-likes" aria-labelledby="tab-likes" data-page="likes" hidden>
            <h2>点赞感谢</h2><p class="intro">按点赞事件感谢观众。</p>
            <div class="rule-summary"><strong>当前规则</strong><p data-summary="like"></p></div>
            ${this.select('like.responseMode', '感谢生成方式', [['rules', '使用预设话术'], ['ai', '使用 AI 生成']])}
            ${this.area('like.templates', '感谢话术（每行一条，轮流使用）', 'lines', '变量：{user} 自动称呼、{nickname} 原昵称、{count} 本次点赞数。按公开性别称哥/姐；资料未知或已知未成年时仅用昵称。')}
            <div class="notice">点赞感谢使用当前回复方式，按事件及时发送。</div>
          </section>
          <section class="page" role="tabpanel" id="page-keywords" aria-labelledby="tab-keywords" data-page="keywords" hidden>
            <h2>关键词回复</h2><p class="intro">固定话术优先于 AI；每条弹幕最多命中一条规则。</p>
            <div class="rule-summary"><strong>当前规则</strong><p data-summary="keyword"></p></div>
            ${this.select('keyword.responseMode', '命中后回复方式', [['rules', '使用规则话术'], ['ai', '使用 AI 生成']])}
            <div data-list="keywords"></div><button type="button" class="list-add" data-add="keywords">添加关键词回复</button>
            <p class="hint">按列表顺序匹配；可用“上移 / 下移”调整优先级。每条规则支持包含关键词或完全一致。</p>
          </section>
          <section class="page" role="tabpanel" id="page-ai" aria-labelledby="tab-ai" data-page="ai" hidden>
            <h2>AI 服务与问答</h2><p class="intro">连接模型服务，并配置 AI 如何回应直播间弹幕。</p>
            <div class="rule-summary"><strong>当前规则</strong><p data-summary="ai"></p></div>
            <div class="settings-workspace ai-workspace">

            <section class="settings-column">
<h3 class="subhead">服务连接</h3>
              <label class="field"><span>服务预设</span><select data-preset><option value="custom">自定义兼容接口</option><option value="deepseek">DeepSeek</option><option value="qwen">通义千问 / DashScope</option><option value="doubao">豆包 / 火山方舟</option><option value="local">本地 Ollama</option></select></label>
            <details data-ai-connection><summary>接口与模型</summary>${this.input('ai.endpoint', 'API 接口地址')}${this.input('ai.model', '模型名称 / 接入点 ID')}</details>
            <label class="field"><span>API Key</span><input type="password" data-api-key autocomplete="new-password" placeholder="留空保留此服务已有密钥"><small data-key-status>密钥按服务域名隔离，不随配置导出。</small></label>
            <label class="toggle"><input type="checkbox" data-remember-key>记住新密钥（仅此设备）</label>
            <div class="actions"><button type="button" data-action="test-ai">测试 AI 连接</button><button type="button" class="danger" data-action="forget-key">清除此服务密钥</button></div>
</section>
            <section class="settings-column">
<h3 class="subhead">问答与场控资料</h3>
              <div class="section"><div data-chat-controls>${this.select('ai.trigger', '自动回复触发条件', [['question', '提问弹幕'], ['mention', '呼叫场控'], ['all', '所有弹幕（受调用限额约束）']])}<details><summary>AI 额度与上下文</summary><div class="grid">${this.input('ai.maxPerHour', '每小时最多调用 / 次', 'number')}${this.input('ai.contextSize', '最近弹幕条数', 'number')}${this.input('ai.contextAgeSec', '弹幕保留时长 / 秒', 'number')}</div></details>
            <div data-ai-mentions>${this.area('ai.mentions', '场控呼叫词（每行一个）')}</div></div><div data-ai-profile>${this.area('ai.persona', '场控风格', 'text')}${this.area('ai.knowledge', '主播与本场直播资料', 'text', '填写已核实的直播主题、开播时间和资料。')}</div>
            <details data-idle-controls><summary>冷场互动</summary>${this.input('ai.idleSec', '没有新互动多久算冷场 / 秒', 'number')}</details>
            <div class="notice">启用 AI 的模块才会显示 AI 生成选项。最近弹幕、昵称和你填写的资料会发往所配置的服务，不发送 Cookies 或观众 UID。预览模式仍会调用 AI。</div></div></section></div>
          </section>
          <section class="page" role="tabpanel" id="page-bot" aria-labelledby="tab-bot" data-page="bot" hidden>
            <h2>@机器人</h2><p class="intro">观众 @ 你的当前登录账号，即可呼出文字菜单并互动。</p>
            <div class="rule-summary"><strong>试着这样说</strong><p data-bot-address>@当前昵称 菜单</p></div>
            <p class="hint" data-bot-identity></p>
            <p class="hint" data-bot-session>当前没有进行中的游戏。</p>
            <section class="settings-group"><h3>互动菜单</h3><p class="group-note">菜单只列出开启的玩法。每次回复一条弹幕；菜单较长时用「菜单 2」翻页。</p><div class="feature-list">${BOT_COMMANDS.map(item => `<div class="feature-row"><div class="feature-title">${item.label}<small>@当前昵称 ${item.example}</small></div><label class="switch" aria-label="${item.label}"><input type="checkbox" role="switch" data-field="bot.${item.key}" aria-label="${item.label}"><span></span></label></div>`).join('')}</div></section>
            <div class="rule-summary"><strong>观众看到的菜单 · 第 1 页</strong><p data-bot-menu></p></div>
            <p class="hint">每局随机抽取起始成语，接受同音或近音接续；只需 @ 一次启动，之后全直播间都可直接参与。</p>
            <p class="hint" data-bot-ai></p>
          </section>
          <section class="page" role="tabpanel" id="page-timers" aria-labelledby="tab-timers" data-page="timers" hidden>
            <h2>定时消息</h2><p class="intro">填写话术和间隔，开始场控后自动轮流发送。</p>
            <div class="rule-summary"><strong>当前规则</strong><p data-summary="timers"></p></div>
            <div data-list="timers"></div><button type="button" class="list-add" data-add="timers">添加定时消息</button>
            <p class="hint">每组独立循环，话术每行一条。时段留空表示全天，支持跨午夜。</p>
          </section>
          <section class="page" role="tabpanel" id="page-diagnostics" aria-labelledby="tab-diagnostics" data-page="diagnostics" hidden>
            <h2>连接</h2><p class="intro">检查直播数据、账号识别与页面发送控件。</p>
            <div class="identity section"><strong data-anchor-name>正在识别主播…</strong><p data-self-name>正在识别登录账号…</p><p data-admin-status>管理员身份：未验证，管理操作不可用</p><p data-identity-warning hidden></p><details><summary>账号不对？</summary><div class="actions"><button type="button" data-action="identify">重新识别</button><button type="button" data-action="identity-settings">手动补充</button></div></details></div>
            <div class="rule-summary"><strong>检查顺序</strong><p>先检查连接与解析，再定位输入框和发送按钮。修改页面适配参数后需要刷新直播间。</p></div>
            <h3 class="subhead">直播连接</h3>
            <div class="actions"><button type="button" data-action="diagnose">检查连接与发送控件</button><button type="button" data-action="pick-input">定位输入框</button><button type="button" data-action="pick-send">定位发送按钮</button></div>
            <div class="actions"><button type="button" data-action="debug-send">调试消息发送</button></div><p class="hint">点击后会通过正常发送队列向直播公屏发送“调试消息发送测试”。仅自动发送模式且场控运行时可用。</p>
            <pre data-diagnostics>点击“检查连接与发送控件”查看结果。</pre>
            <p class="hint" data-delivery-health role="status">发送队列为空。</p>
            <section class="settings-group"><h3>发送状态</h3><p class="hint">发送后跟踪本人普通弹幕或管理员弹幕的结构化回显；结果未知时不自动重发，后续消息继续处理。</p><div data-deliveries><p class="empty">暂无发送记录。</p></div></section>
            <section class="settings-group"><h3>采集与存储</h3><p data-ingestion-health role="status">采集就绪，尚未检查存储用量。</p><p class="hint">礼物事实先写入日志，感谢任务独立排队。缓冲耗尽后的采集缺口无法自动补回。</p><div class="actions"><button type="button" data-action="recover-events">恢复采集与重试隔离事件</button><button type="button" data-action="export-events">导出恢复数据</button><button type="button" data-action="release-cache">释放临时协议缓存</button><button type="button" data-action="import-income">导入礼物恢复数据</button></div><input class="file" data-import-income-file type="file" accept="application/json,.json"><p class="hint">收入账本、设置和待处理事件保存在 IndexedDB；临时协议帧会自动过期或在空间紧张时清理。导出可能包含观众昵称和弹幕，请妥善保管。</p></section>
            <h3 class="subhead">账号身份</h3>
            <details data-manual-identity><summary>主播与账号识别</summary>${this.toggle('identity.autoAnchor', '自动识别主播')}${this.input('anchorId', '主播 UID（自动识别不到时填写）')}${this.toggle('identity.autoSelf', '自动识别登录账号')}${this.input('selfId', '登录账号 UID（自动识别不到时填写）')}</details>
            <h3 class="subhead">互动过滤</h3>
            ${this.area('ignored', '忽略用户（每行一位）', 'lines', '支持 uid:、sec:、name: 前缀。')}${this.area('blockedWords', '禁止发送的词（每行一个）')}
            <details class="section" data-moderation-settings><summary>辱骂与恶意弹幕提醒</summary>${this.area('moderation.terms', '识别词（每行一个）', 'lines', '本地匹配，不把原始弹幕发给第三方；请按直播间语境调整。')}${this.input('moderation.threshold', '达到多少次提醒管理员', 'number')}${this.input('moderation.windowSec', '统计时长 / 秒', 'number')}<p class="hint">房间响应提供管理员 UID 名单时才确认身份。当前封禁操作未经验证，所以只提醒和计数，不会自动封禁。</p></details>
            <details><summary>高级页面适配与去重</summary><div class="grid">${this.input('adapter.inputSelector', '公屏输入框选择器')}${this.input('adapter.sendSelector', '公屏发送按钮选择器')}${this.input('sending.duplicateSec', '重复话术冷却 / 秒', 'number')}</div></details>
            <details class="section"><summary>弹幕备用采集与场次识别</summary><p class="hint">场次开播时间需配置一个直播中状态元素；下播优先使用平台结束消息，也可配置结束提示。修改后需刷新。</p>${this.input('adapter.chatSelector', '弹幕行选择器')}${this.input('adapter.nicknameSelector', '行内昵称选择器')}${this.input('adapter.contentSelector', '行内内容选择器')}${this.input('adapter.startSelector', '直播中状态选择器（场次开始）')}${this.input('adapter.endSelector', '下播提示选择器（可选）')}</details>
            <details class="section" data-log-details><summary>运行记录</summary><div class="stats">${[['events', '接收事件'], ['filtered', '已过滤'], ['previews', '已预览'], ['submitted', '已提交']].map(([key, name]) => `<div><b data-stat="${key}">0</b><span>${name}</span></div>`).join('')}</div><div class="log-head"><select data-log-filter aria-label="筛选运行记录"><option value="all">全部记录</option>${Object.entries(categories).map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></div><div class="logs" data-logs aria-label="运行记录"></div></details>
            <div class="section"><h3>配置与运行记录</h3><div class="actions"><button type="button" data-action="lab">运行规则自检</button><button type="button" data-action="export">导出配置</button><button type="button" data-action="import">导入配置</button><button type="button" data-action="export-log">导出运行记录</button><button type="button" data-action="clear-log">清空记录</button></div><input class="file" data-import-file type="file" accept="application/json,.json"><p class="hint">每个直播间单独保存设置。导出配置不包含密钥；导出的运行记录可能包含公屏昵称和回复。</p></div>
          </section>
        </form></div>
        </main></div>
        <footer class="foot"><small data-save-state>设置已保存</small><div class="actions"><button data-action="save" hidden>保存设置</button><button class="primary" type="button" data-action="start">开始场控</button><button class="danger" type="button" data-action="stop" hidden>立即暂停</button></div></footer>
      </section>
      <span class="window-help" id="assistant-resize-help">拖动窗口边缘或角落调整大小。聚焦此控件后用方向键调整，按 Shift 加速；Home 或双击恢复默认大小。拖动标题栏移动窗口。</span>
      ${['n','e','s','w','nw','ne','sw'].map(edge => `<div class="window-resize" data-resize="${edge}" aria-hidden="true"></div>`).join('')}
      <button type="button" class="window-resize" data-resize="se" aria-label="调整窗口大小" aria-describedby="assistant-resize-help" title="拖动调整窗口大小 · 双击恢复默认布局"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><path d="M3 9 9 3M7 9l2-2"/></svg></button>
      </div>`;
    return container;
  }
  node(selector) { if (!this.cache.has(selector)) this.cache.set(selector, this.root.querySelector(selector)); return this.cache.get(selector); }
  text(selector, value) { const target = this.node(selector); const node = target.querySelector('[data-button-label]') || target; if (node.textContent !== String(value)) node.textContent = String(value); }
  disabled(selector, value) { const node = this.node(selector); if (node.disabled !== value) node.disabled = value; }
  markDirty(value = true) { this.dirty = value; this.syncFooter(); }
  hidden(selector, value) { const node = this.node(selector); if (node.hidden !== value) node.hidden = value; }
  syncFooter() {
    const running = Boolean(this.latest?.[0].running);
    const busy = ['start','save','test-ai'].some(action => this.busyActions.has(action));
    this.text('[data-save-state]', this.busyActions.has('save') ? '正在保存…' : this.busyActions.has('start') ? '正在开始…' : this.dirty ? '未保存，保存后继续运行' : '设置已保存');
    this.node('[data-save-state]').classList.toggle('dirty', this.dirty);
    this.hidden('[data-action=save]', !this.dirty);
    this.text('[data-action=save]', '保存设置');
    this.hidden('[data-action=start]', running); this.hidden('[data-action=stop]', !running);
    this.text('[data-action=start]', this.dirty ? '保存并开始' : '开始场控');
    this.disabled('[data-action=start]', running || busy); this.disabled('[data-action=save]', busy);
    this.disabled('[data-action=stop]', !running);
    this.disabled('[data-action=debug-send]', !running || this.latest?.[1]?.contextInvalidated || this.latest?.[0].config.mode !== 'auto' || this.busyActions.has('debug-send'));
    const form = this.node('form'); if (form.inert !== busy) form.inert = busy;
  }
  rowField(field, label, value = '', type = 'text', choices = null) {
    const input = choices ? `<select data-item="${field}">${choices.map(([key,name]) => `<option value="${esc(key)}" ${String(value) === key ? 'selected' : ''}${key === 'ai' ? ' data-ai-choice hidden' : ''}>${esc(name)}</option>`).join('')}</select>` : type === 'lines' ? `<textarea data-item="${field}" rows="2">${esc(Array.isArray(value) ? value.join('\n') : value)}</textarea>` : `<input data-item="${field}" type="${type}" value="${esc(value)}" ${type === 'number' ? 'min="0" step="any"' : ''}>`;
    return `<label class="field"><span>${label}</span>${input}</label>`;
  }
  addRow(kind, value, dirty = true) {
    const list = this.root.querySelector(`[data-list="${kind}"]`);
    const row = document.createElement('div'); row.className = 'editor-row'; row.dataset.listRow = kind;
    const defaults = { prices: { key: '', value: 100 }, keywords: { keywords: [], reply: '', exact: false }, listed: '', timers: { id: `timer-${Date.now()}-${++this.rowSerial}`, enabled: true, responseMode: 'rules', intervalSec: 300, start: '', end: '', quietSec: 15, messages: [] } };
    value ??= defaults[kind]; row.record = copy(value);
    const f = (...args) => this.rowField(...args);
    let fields, title;
    if (kind === 'prices') { title = '礼物单价'; fields = `<div class="grid">${f('key','礼物名称或 ID',value.key)}${f('value','单价 / 钻石',value.value,'number')}</div>`; }
    if (kind === 'keywords') { title = '关键词回复'; fields = f('keywords','触发词（每行一个）',value.keywords,'lines') + f('reply','回复内容',value.reply,'lines') + f('exact','匹配方式',String(value.exact),'text',[['false','包含关键词'],['true','完全一致']]); }
    if (kind === 'listed') {
      title = '指定用户'; const match = /^(uid|sec|name):(.*)$/.exec(value); const type = match?.[1] || 'uid', text = match?.[2] ?? value;
      row.original = value; row.originalType = type; row.originalText = text;
      fields = `<div class="grid">${f('type','识别方式',type,'text',[['uid','数字 UID（推荐）'],['sec','sec UID'],['name','精确昵称']])}${f('value','用户',text)}</div>`;
    }
    if (kind === 'timers') { title = '定时消息'; fields = `<label class="toggle"><input data-item="enabled" type="checkbox" ${value.enabled ? 'checked' : ''}>启用这一组</label>` + f('responseMode','生成方式',value.responseMode || 'rules','text',[['rules','使用预设话术'],['ai','使用 AI 生成']]) + f('messages','发送话术（每行一条）',value.messages,'lines') + f('intervalSec','每隔多少秒发送',value.intervalSec,'number') + `<details><summary>生效时段与互动避让</summary><div class="grid">${f('start','开始 / 北京时间',value.start,'time')}${f('end','结束 / 北京时间',value.end,'time')}${f('quietSec','距离上次互动 / 秒',value.quietSec,'number')}</div></details>`; }
    row.innerHTML = `<div class="row-head"><b>${title}</b><div>${kind === 'keywords' ? '<button type="button" data-move="up" aria-label="上移关键词规则">上移</button><button type="button" data-move="down" aria-label="下移关键词规则">下移</button>' : ''}<button type="button" data-remove aria-label="删除${title}">删除</button></div></div>${fields}`;
    list.append(row); if (dirty) { this.markDirty(); this.syncControls(); row.querySelector('input,textarea,select')?.focus(); }
    return row;
  }
  readList(kind) {
    return [...this.root.querySelector(`[data-list="${kind}"]`).children].map(row => {
      const values = {}; for (const el of row.querySelectorAll('[data-item]')) values[el.dataset.item] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value.trim() ? Number(el.value) : NaN) : el.value.trim();
      const fail = (field, message) => { const el = row.querySelector(`[data-item="${field}"]`); this.revealError(el, { prices:'gift', keywords:'keywords', listed:'welcome', timers:'timers' }[kind]); throw new Error(message); };
      if (kind === 'prices') { if (!values.key) fail('key','请填写礼物名称或 ID'); if (!Number.isFinite(values.value) || values.value <= 0) fail('value','请填写大于 0 的礼物单价'); return values; }
      if (kind === 'listed') { if (!values.value) fail('value','请填写指定用户'); if (values.type === 'uid' && !/^\d+$/.test(values.value)) fail('value','数字 UID 只能填写数字，昵称请切换识别方式'); return values.type === row.originalType && values.value === row.originalText ? row.original : `${values.type}:${values.value}`; }
      if (kind === 'keywords') { const keywords = values.keywords.split('\n').map(x=>x.trim()).filter(Boolean); if (!keywords.length) fail('keywords','请至少填写一个关键词'); if (!values.reply) fail('reply','请填写关键词回复'); return { ...row.record, keywords, reply:values.reply, exact:values.exact === 'true' }; }
      const messages = values.messages.split('\n').map(x=>x.trim()).filter(Boolean);
      if (values.enabled && !messages.length) fail('messages','请填写至少一条定时话术，或关闭这一组');
      if (!Number.isFinite(values.intervalSec) || values.intervalSec < 30) fail('intervalSec','定时间隔至少为 30 秒');
      if (!Number.isFinite(values.quietSec) || values.quietSec < 0) fail('quietSec','互动避让请填写大于等于 0 的秒数');
      return { ...row.record, ...values, messages };
    });
  }
  populate(config) {
    this.config = copy(config);
    for (const element of this.root.querySelectorAll('[data-field]')) {
      const value = at(this.config, element.dataset.field);
      if (element.type === 'checkbox') element.checked = Boolean(value);
      else if (element.dataset.format === 'lines') element.value = (value || []).join('\n');
      else element.value = value ?? '';
    }
    for (const list of this.root.querySelectorAll('[data-list]')) list.replaceChildren();
    for (const [key,value] of Object.entries(config.gift.prices)) this.addRow('prices',{key,value},false);
    for (const item of config.keyword.rules) this.addRow('keywords',item,false);
    for (const item of config.welcome.listed) this.addRow('listed',item,false);
    for (const item of config.timers) this.addRow('timers',item,false);
    this.node('[data-api-key]').value = '';
    const preset = Object.entries(presets).find(([,values])=>values[0] === config.ai.endpoint)?.[0] || 'custom';
    this.node('[data-preset]').value = preset; this.node('[data-ai-connection]').open = ['custom','doubao','local'].includes(preset);
    this.syncControls(); this.markDirty(false);
  }
  syncControls() {
    this.syncFooter();
    for (const action of ['identify','test-ai','diagnose','refresh-anchor']) this.disabled(`[data-action="${action}"]`, this.busyActions.has(action) || (action === 'test-ai' && ['save','start'].some(a=>this.busyActions.has(a))));
    const get = path => this.root.querySelector(`[data-field="${path}"]`);
    const welcomeMode = get('welcome.mode').value;
    this.hidden('[data-qualified]', welcomeMode === 'listed');
    if (welcomeMode === 'listed' && this.welcomeMode !== welcomeMode) this.node('[data-welcome-list]').open = true;
    this.welcomeMode = welcomeMode;
    const listedCount = this.root.querySelectorAll('[data-list="listed"] [data-list-row="listed"]').length;
    const fanRule = get('welcome.requireFan').checked ? `本房粉丝团 ≥ ${get('welcome.minFanLevel').value} 级${get('welcome.requireLit').checked ? '且已点亮' : ''}` : '不限制粉丝团';
    const welcomeRule = welcomeMode === 'listed' ? `仅欢迎指定名单（${listedCount} 人）` : `荣誉 ≥ ${get('welcome.minWealth').value} 级 · ${fanRule}${welcomeMode === 'qualified-or-listed' ? ` · 或名单 ${listedCount} 人` : ''}`;
    const adminRule = get('welcome.admin.enabled').checked ? ` · 管理员弹幕：荣誉 ≥ ${get('welcome.admin.minWealth').value} 级且本房灯牌 ≥ ${get('welcome.admin.minFanLevel').value} 级` : '';
    const aiReady = get('ai.enabled').checked;
    for (const option of this.root.querySelectorAll('[data-ai-choice]')) option.hidden = !aiReady;
    for (const select of this.root.querySelectorAll('[data-field$=".responseMode"], [data-item="responseMode"]')) {
      if (!aiReady && select.value === 'ai') select.value = 'rules';
    }
    this.hidden('[data-moderation-settings]', !get('moderation.enabled').checked);
    this.hidden('[data-chat-controls]', !get('ai.chatEnabled').checked);
    this.hidden('[data-idle-controls]', !get('ai.idleEnabled').checked);
    this.hidden('[data-ai-profile]', !get('ai.chatEnabled').checked && !get('ai.idleEnabled').checked);
    const strategy = mode => mode === 'ai' ? (aiReady ? 'AI 优先，规则兜底' : '规则话术（AI 服务关闭）') : '预设话术';
    this.text('[data-summary=gift]', !get('gift.enabled').checked ? '已关闭，不会生成礼物感谢。' : `${get('gift.basis').value === 'total' ? '连击总价' : '单个礼物'} ≥ ${get('gift.minValue').value || 0} 钻 · ${strategy(get('gift.responseMode').value)} · 即时感谢。`);
    this.text('[data-summary=welcome]', !get('welcome.enabled').checked ? '已关闭，不会生成进场欢迎。' : `${welcomeRule}${adminRule} · ${strategy(get('welcome.responseMode').value)}`);
    this.text('[data-feature-note=gift]', !get('gift.enabled').checked ? '已关闭' : `门槛 ≥ ${get('gift.minValue').value || 0} 钻`);
    this.text('[data-feature-note=welcome]', !get('welcome.enabled').checked ? '已关闭' : welcomeMode === 'listed' ? `指定名单 ${listedCount} 人` : `荣誉 ≥ ${get('welcome.minWealth').value} 级${get('welcome.requireFan').checked ? ' · 粉丝团条件已启用' : ''}`);
    this.text('[data-feature-note=like]', !get('like.enabled').checked ? '已关闭' : strategy(get('like.responseMode').value));
    this.text('[data-summary=like]', !get('like.enabled').checked ? '已关闭，不会生成点赞感谢。' : `${strategy(get('like.responseMode').value)} · 即时感谢。`);
    const keywordCount = this.root.querySelectorAll('[data-list="keywords"] [data-list-row="keywords"]').length;
    this.text('[data-feature-note=keyword]', !get('keyword.enabled').checked ? '已关闭' : `启用 ${keywordCount} 条规则`);
    this.text('[data-feature-note=bot]', get('bot.enabled').checked ? (aiReady ? '@当前账号呼出菜单 · AI 接话，内置兜底' : '@当前账号呼出菜单 · 内置回复') : '已关闭');
    const botConfig = Object.fromEntries(BOT_COMMANDS.map(item => [item.key, get(`bot.${item.key}`).checked]));
    this.text('[data-bot-menu]', new RoomBot().menu(botConfig, this.config.sending.maxLength || 50));
    const botSelf = this.identity?.self, configuredSelf = get('selfId').value;
    const selfMatches = botSelf && (!configuredSelf || String(botSelf.id) === configuredSelf);
    this.text('[data-bot-address]', `@${selfMatches && botSelf.name ? botSelf.name : '当前昵称'} 菜单`);
    this.text('[data-bot-identity]', selfMatches ? `当前响应账号：${botSelf.name || botSelf.id}。请使用完整 @，并在昵称后留一个空格。` : configuredSelf ? '已配置登录账号 UID；可通过平台的 @ 账号选择器准确呼叫。' : '请先登录并在“连接诊断”识别当前账号，识别后才会响应 @。');
    this.text('[data-bot-session]', this.latest?.[0]?.bot?.sessionSummary?.() || '当前没有进行中的游戏。');
    this.text('[data-bot-ai]', aiReady ? '互动优先使用 AI 接话，无需开启 AI 弹幕问答；忙碌、失败或等待超过 5 秒时自动使用内置回复。菜单和游戏结果由本地确定。' : '当前使用内置题库和算法回复；启用 AI 服务后自动使用 AI 接话。主播和观众可直接回答，也可用文字或表情完成挑战。');
    this.text('[data-summary=keyword]', !get('keyword.enabled').checked ? '已关闭，不会回复关键词弹幕。' : `${keywordCount} 条规则 · 按顺序命中首条 · ${strategy(get('keyword.responseMode').value)} · 即时回复。`);
    this.hidden('[data-ai-mentions]', get('ai.trigger').value !== 'mention');
    const triggerName = { question: '提问弹幕', mention: '呼叫词', all: '所有弹幕' }[get('ai.trigger').value];
    this.text('[data-summary=ai]', !aiReady ? 'AI 服务已关闭；已启用的模块仅使用预设话术。' : `AI 服务已开启 · 弹幕问答${get('ai.chatEnabled').checked ? `：${triggerName}` : '：关闭'} · 每小时最多 ${get('ai.maxPerHour').value} 次 · ${get('mode').value === 'preview' ? '当前仅预览' : '自动发送'}`);
    const timerRows = [...this.root.querySelectorAll('[data-list=timers] [data-list-row=timers]')];
    const activeTimerRows = timerRows.filter(row=>row.querySelector('[data-item=enabled]')?.checked);
    const timers = activeTimerRows.length;
    const intervals = [...new Set(activeTimerRows.map(row=>row.querySelector('[data-item=intervalSec]')?.value).filter(Boolean))];
    this.text('[data-summary=timers]', !get('timersEnabled').checked ? '定时消息已关闭。' : timers ? `已开启 ${timers} 组 · 间隔 ${intervals.map(value=>`${value} 秒`).join(' / ')} · ${activeTimerRows.some(row=>row.querySelector('[data-item=responseMode]')?.value === 'ai') ? '含 AI 生成组' : '预设话术'}。` : `${timerRows.length ? `共 ${timerRows.length} 组，` : ''}当前没有启用消息组。`);
    this.text('[data-feature-note=timers]', !get('timersEnabled').checked ? '已关闭' : timers ? `已启用 ${timers} 组消息` : '尚未配置消息组');
    this.text('[data-feature-note=ai-service]', aiReady ? 'AI 生成选项已开放' : '关闭时互动模块使用预设话术');
    this.text('[data-feature-note=ai-chat]', get('ai.chatEnabled').checked ? (aiReady ? '响应提问或场控呼叫' : '需先启用 AI 服务') : '不处理弹幕问答');
    this.text('[data-feature-note=ai-idle]', get('ai.idleEnabled').checked ? `无互动 ${get('ai.idleSec').value} 秒后邀请` : '已关闭');
    this.text('[data-feature-note=moderation]', get('moderation.enabled').checked ? '疑似辱骂达到阈值时提醒' : '已关闭');
    this.text('[data-mode-note]', {preview:'仅预览，不会发送到直播间。AI 开启后仍会调用模型。',auto:'符合规则的回复会自动发送。'}[get('mode').value]);
    const fan = get('welcome.requireFan').checked;
    get('welcome.requireLit').disabled = !fan; get('welcome.minFanLevel').disabled = !fan;
    get('welcome.admin.minWealth').disabled = !get('welcome.admin.enabled').checked;
    get('welcome.admin.minFanLevel').disabled = !get('welcome.admin.enabled').checked;
    get('welcome.admin.minWealth').min = Math.max(1, Number(get('welcome.minWealth').value) || 0);
    get('welcome.admin.minFanLevel').min = Number(get('welcome.minFanLevel').value) || 0;
    get('welcome.admin.minWealth').max = get('welcome.admin.minFanLevel').max = 100;
    get('anchorId').readOnly = get('identity.autoAnchor').checked && Boolean(this.identity?.anchor);
    get('selfId').readOnly = get('identity.autoSelf').checked && Boolean(this.identity?.self);
    this.applyFeatureVisibility();
  }
  setBusy(action, value) { if (value) this.busyActions.add(action); else this.busyActions.delete(action); this.syncControls(); }
  revealError(el, page = el.closest('[data-page]')?.dataset.page) { el.setAttribute('aria-invalid','true'); if (page) this.tab(page); for (let parent=el.parentElement;parent;parent=parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true; el.focus(); }
  read() {
    for (const el of this.root.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    const result = copy(this.config);
    for (const element of this.root.querySelectorAll('[data-field]')) {
      let value = element.value;
      if (element.type === 'checkbox') value = element.checked;
      else if (element.type === 'number') { if (!value.trim()) { this.revealError(element); throw new Error('数字设置不能为空'); } value = Number(value); }
      else if (element.dataset.format === 'lines') value = value.split('\n').map(s => s.trim()).filter(Boolean);
      put(result, element.dataset.field, value);
    }
    const prices = this.readList('prices');
    if (new Set(prices.map(p=>p.key)).size !== prices.length) throw new Error('礼物价格有重复名称或 ID，请合并');
    result.gift.prices = Object.fromEntries(prices.map(p=>[p.key,p.value]));
    result.keyword.rules = this.readList('keywords'); result.welcome.listed = [...new Set(this.readList('listed'))]; result.timers = this.readList('timers');
    if (result.welcome.admin.enabled) {
      for (const [admin, basic, label] of [['minWealth','minWealth','荣誉'], ['minFanLevel','minFanLevel','灯牌']]) {
        if (result.welcome.admin[admin] < result.welcome[basic]) {
          this.revealError(this.node(`[data-field="welcome.admin.${admin}"]`), 'welcome');
          throw new Error(`管理员弹幕最低${label}等级不能低于基础欢迎，请设为 ${result.welcome[basic]} 级或以上`);
        }
      }
    }
    const validated = validateConfig(mergeConfig(result)); if (validated.ai.enabled || this.node('[data-api-key]').value.trim()) validateEndpoint(validated.ai.endpoint);
    for (const [key, selector] of Object.entries(validated.adapter)) if (selector) { try { document.querySelector(selector); } catch { throw new Error(`${key} 选择器无效`); } }
    return validated;
  }
  updateIdentity(identity) {
    this.identity = identity;
    this.text('[data-anchor-name]', identity.anchor ? `主播：${identity.anchor.name || identity.anchor.id}` : '主播尚未识别，可重新识别或手动补充');
    this.text('[data-self-name]', identity.self ? `当前账号：${identity.self.name || identity.self.id}` : '当前账号尚未识别，请确认已登录');
    this.text('[data-admin-status]', identity.admin === true ? '管理员身份：名单确认；管理员弹幕/封禁未接入' : identity.admin === false ? '管理员身份：当前账号不是本房管理员' : '管理员身份：未验证，管理操作不可用');
    this.text('[data-identity-warning]', identity.warning || ''); this.node('[data-identity-warning]').hidden = !identity.warning;
    for (const [auto,field,user] of [['autoAnchor','anchorId',identity.anchor],['autoSelf','selfId',identity.self]]) {
      if (this.root.querySelector(`[data-field="identity.${auto}"]`).checked && user) { this.root.querySelector(`[data-field="${field}"]`).value = user.id; this.config[field] = user.id; }
    }
    if (identity.self === null && this.root.querySelector('[data-field="identity.autoSelf"]').checked) { this.root.querySelector('[data-field="selfId"]').value = ''; this.config.selfId = ''; }
    this.syncControls();
  }
  updateAnchorIncome(report) {
    this.anchorIncome = report && typeof report === 'object' ? report : null;
    if (this.latest?.[0] && this.activeTab === 'anchor') this.renderAnchor(this.latest[0]);
  }
  renderAnchor(engine) {
    this.anchorDashboard.render(engine, {identity:this.identity, income:this.anchorIncome});
  }
  updateViewers(viewers) {
    this.viewers = viewers; const picker = this.node('[data-viewer-picker]'), value = picker.value;
    const signature = viewers.map(u=>`${u.key}:${u.name}:${u.gender}:${u.age}:${u.wealthLevel}:${u.fanLevel}:${u.fanStatus}`).join('|'); if (signature === this.viewerSignature) return; this.viewerSignature = signature;
    picker.innerHTML = '<option value="">选择最近出现的观众</option>' + viewers.map(u=>`<option value="${esc(u.key)}">${esc(u.name)}${u.gender === 1 ? ' · 男' : u.gender === 2 ? ' · 女' : ''}${u.age == null ? '' : ` · ${u.age}岁`}${u.wealthLevel == null ? '' : ` · 荣誉${u.wealthLevel}级`}${u.fanLevel == null ? '' : ` · 粉丝团${u.fanLevel}级${u.fanStatus === 1 ? '已点亮' : ''}`}${u.id || u.secUid ? '' : '（按昵称）'}</option>`).join('');
    picker.value = viewers.some(u=>u.key===value) ? value : '';
  }
  updateGifts(gifts) {
    const box = this.node('[data-recent-gifts]');
    const signature = gifts.map(g => `${g.key}:${g.count}:${g.unitValue}:${g.user.name}`).join('|');
    if (signature === this.giftSignature) return;
    this.giftSignature = signature;
    this.text('[data-gift-count]', `${gifts.length} 条 · 仅保留本次页面数据`);
    box.innerHTML = gifts.length ? gifts.slice(0, 8).map(g => `<div class="gift-activity"><strong>${esc(g.user.name)}</strong><span>${esc(g.giftName)} ×${g.count}</span><small>${g.unitValue == null ? '价值未知' : `${g.count * g.unitValue} 钻石`}</small></div>`).join('') : '<p class="empty">收到礼物后，送礼用户和已知礼物信息会显示在这里。</p>';
  }
  updateProfiles(profiles = []) {
    if (!Array.isArray(profiles)) return;
    const all = profiles.some(profile => profile.room === this.room) ? profiles : [{room:this.room,name:`直播间 ${this.room}`}, ...profiles];
    const select = this.node('[data-income-room]'), selected = select.value;
    select.innerHTML = all.map(profile => `<option value="${esc(profile.room)}">${esc(profile.name)}${profile.room === this.room ? '（当前）' : ''}</option>`).join('');
    select.value = all.some(profile => profile.room === selected) ? selected : this.room;
    this.node('[data-profiles]').innerHTML = all.map(profile => `<div class="profile-card"><div><strong>${esc(profile.name)}${profile.room === this.room ? ' · 当前' : ''}</strong><small>直播间 ${esc(profile.room)}${profile.anchorId ? ` · UID ${esc(profile.anchorId)}` : ''}</small></div>${/^\d+$/.test(profile.room) ? `<a href="https://live.douyin.com/${profile.room}${/^\d+$/.test(profile.anchorId || '') ? `?anchor_id=${profile.anchorId}` : ''}" target="_blank" rel="noopener noreferrer">打开并配置 ↗</a>` : ''}</div>`).join('');
  }
  incomeSelection() { return {room:this.node('[data-income-room]').value || this.room, month:this.node('[data-income-month]').value || giftDate().slice(0,7)}; }
  incomeError(message) { this.text('[data-income-error]', `本地账本暂不可用：${message}`); this.hidden('[data-income-error]', false); this.node('[data-action="export-income"]').disabled = true; }
  updateContributionStatus(status) {
    if (!status?.checkedAt) { this.text('[data-income-calibration-status]', '在线榜单：等待自动采样'); return; }
    const time = new Date(status.checkedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    this.text('[data-income-calibration-status]', `在线榜单读取 ${status.rows} 行，已关联 UID ${status.matched} 行 · ${time}${status.matched < status.rows ? `；${status.rows-status.matched} 行因 UID 不可唯一匹配，未计入估值` : ''}`);
  }
  updateIncome(report) {
    if (!report?.summary || !Array.isArray(report.days)) return;
    this.hidden('[data-income-error]', true);
    const summary = report.summary, number = value => new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(value);
    this.text('[data-income-period]',`${report.month} 收入估算`);
    this.text('[data-income-total]',money(summary.estimatedIncome));
    this.text('[data-income-diamonds]',`${number(summary.totalDiamonds)} 钻`);
    this.text('[data-income-count]',number(summary.giftCount));
    this.text('[data-income-days]',String(report.sessions?.length || 0));
    this.text('[data-income-coverage]',summary.unknownCount ? `另有 ${number(summary.unknownCount)} 个礼物单价未知，未计入面值与收入。` : '金额仅包含已识别单价的礼物，不代表平台结算或实际到账。');
    const calibration = report.calibration || {users:0,score:0,incomeFloor:0};
    this.text('[data-income-calibration]', calibration.users
      ? `在线贡献榜${calibration.hasFloor ? '至少 ' : ''}估值 ${money(calibration.incomeEstimate)} · ${number(calibration.users)} 位已识别用户 · ${number(calibration.score)} 分；不与礼物收入重复相加。`
      : '在线贡献榜估值：暂无可识别用户');
    const box = this.node('[data-income-daily]');
    const signature = JSON.stringify(report);
    if (signature !== this.incomeSignature) {
      this.incomeSignature = signature;
      const sessions = report.sessions || [];
      const rows = sessions.map(session => {
        const time = at => at ? new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '进行中';
        const start = session.startSource === 'first-observed' ? `${time(session.startAt)}（首次观测）` : ['dom-observed','platform-observed'].includes(session.startSource) ? `${time(session.startAt)}（状态识别）` : time(session.startAt);
        const end = !session.endAt ? '直播中' : `${time(session.endAt)}${['room-changed','next-observed'].includes(session.endSource) ? '（推定边界）' : ['dom','platform-observed'].includes(session.endSource) ? '（状态识别）' : ''}`;
        return `<tr><td>${start}<br>${end}</td><td>${number(session.giftCount)}${session.unknownCount ? ` <span title="单价未知">(未知 ${number(session.unknownCount)})</span>` : ''}</td><td>${number(session.totalDiamonds)}</td><td>${money(session.estimatedIncome)}</td><td>—</td></tr>`;
      }).concat((report.legacyDays || (sessions.length ? [] : report.days)).map(day=>`<tr><td>${esc(day.date)}（历史日汇总）</td><td>${number(day.giftCount)}${day.unknownCount ? ` <span title="单价未知">(未知 ${number(day.unknownCount)})</span>` : ''}</td><td>${number(day.totalDiamonds)}</td><td>${money(day.estimatedIncome)}</td><td>${day.calibrationUsers ? `${day.calibrationHasFloor ? '至少 ' : ''}${money(day.calibratedIncomeEstimate)} · ${number(day.calibrationUsers)}人` : '—'}</td></tr>`));
      box.innerHTML = rows.length ? `<div class="income-table-wrap"><table class="income-table"><thead><tr><th scope="col">开始 / 结束 · 北京时间</th><th scope="col">礼物数</th><th scope="col">面值 / 钻</th><th scope="col">礼物收入估算</th><th scope="col">榜单估值</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<p class="empty">这个月份还没有采集到礼物或榜单校准数据。进入对应直播间后，会自动记录可见数据。</p>';
    }
    this.node('[data-action="export-income"]').disabled = false;
  }
  updateGiftSummary(summary, yuanPerDiamond = 0, persisted = false, { pending = 0, error = '' } = {}) {
    const diamonds = Math.max(0, Number(summary?.totalDiamonds) || 0);
    const unknownCount = Math.max(0, Number(summary?.unknownCount) || 0);
    const count = Math.max(0, Number(summary?.giftCount) || 0);
    const rate = Math.max(0, Number(yuanPerDiamond) || 0);
    this.text('[data-gift-diamonds]', new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(diamonds));
    this.text('[data-gift-total-title]', summary?.endAt ? '最近一场礼物价值' : '本场礼物价值');
    this.text('[data-gift-income]', persisted ? money(summary.estimatedIncome || 0) : rate > 0
      ? new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 }).format(diamonds * rate)
      : '未设置');
    const coverage = unknownCount ? `另有 ${unknownCount} 个礼物单价未知，未计入面值。` : count ? '所有已采集礼物均有可识别单价。' : '等待礼物事件。';
    const estimate = rate > 0 ? `按 ${rate} 元/钻估算；此数不代表平台结算或到账金额。` : '填写结算单对应的元/钻比例后显示估算收入。';
    const disconnected = /context invalidated|扩展上下文/i.test(error);
    const status = error ? disconnected ? '扩展已更新，当前页与后台断开。请先在连接诊断中导出恢复数据，刷新后导入礼物恢复数据。' : `账本暂不可用：${error}。正在重试。` : pending ? '正在保存到账本。' : '';
    const time = at => new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
    const boundary = summary?.startAt ? `${summary.startSource === 'first-observed' ? '首次观测' : ['dom-observed','platform-observed'].includes(summary.startSource) ? '识别到开播' : '开播'} ${time(summary.startAt)}；${summary.endAt ? `${['room-changed','next-observed'].includes(summary.endSource) ? '结束边界推定' : ['dom','platform-observed'].includes(summary.endSource) ? '识别到下播' : '下播'} ${time(summary.endAt)}` : '直播中'}。` : '等待确认直播场次。';
    this.text('[data-gift-estimate-note]', `${boundary}${persisted ? `${status}${pending ? `有 ${pending} 组礼物待入账，尚未计入以上金额。` : ''}${error || pending ? `以上为最近读取的账本数据（${count} 个礼物）。` : `本场已记录 ${count} 个礼物，已保存到本地账本。按收到礼物时的比例估算。${coverage}`}` : `本场采集 ${count} 个礼物。${estimate} ${coverage}`}`);
  }
  toast(message, error = false) {
    const node = this.root.querySelector('.toast'); node.textContent = message; node.classList.toggle('error', error); node.hidden = false;
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { node.hidden = true; }, 8000);
  }
  syncLauncher() {
    const launcher = this.node('.launcher'), running = Boolean(this.latest?.[0].running);
    const status = running ? (this.latest[0].config.mode === 'preview' ? '仅预览' : '自动发送') : '已暂停';
    launcher.classList.toggle('running', running); this.text('.launcher span', status);
    const attributes = { 'aria-expanded':String(this.open), 'aria-label':`${this.open ? '收起' : '展开'}场控面板，当前${status}`, title:`点击${this.open ? '收起' : '展开'} · 拖动调整位置` };
    for (const [key, value] of Object.entries(attributes)) if (launcher.getAttribute(key) !== value) launcher.setAttribute(key, value);
  }
  toggleOpen() { this.open = !this.open; this.floating.setOpen(this.open); this.syncLauncher(); if (this.open) { if (this.latest) this.refresh(...this.latest); this.renderLogs(); this.charts.resize(); } }
  applyFeatureVisibility() {
    const enabled = key => Boolean(this.root.querySelector(`[data-field="${key}.enabled"]`)?.checked);
    for (const key of ['pk', ...interactionPages]) {
      const visible = ['pk','anchor'].includes(key) ? true : key === 'timers' ? Boolean(this.root.querySelector('[data-field="timersEnabled"]')?.checked) : enabled(({ gift:'gift', welcome:'welcome', likes:'like', keywords:'keyword', bot:'bot' })[key]);
      const tab = this.root.querySelector(`[data-tab="${key}"]`);
      const page = this.root.querySelector(`[data-page="${key}"]`);
      if (tab) tab.hidden = !visible;
      if (page) page.hidden = !visible || this.activeTab !== key;
    }
    for (const category of ['interaction', 'settings']) {
      const subnav = this.root.querySelector(`[data-subnav="${category}"]`);
      const hasVisibleTab = [...subnav.querySelectorAll('[data-tab]')].some(tab => !tab.hidden);
      subnav.hidden = category !== this.activeCategory || !hasVisibleTab;
      const categoryButton = this.root.querySelector(`[data-category="${category}"]`);
      categoryButton.hidden = !hasVisibleTab;
    }
    this.navigation.sync(this.activeCategory);
    const visibleCategories = [...this.root.querySelectorAll('[data-category]')].filter(button => !button.hidden).length;
    this.root.querySelector('.primary-nav').style.gridTemplateColumns = `repeat(${Math.max(visibleCategories, 1)}, minmax(0, 1fr))`;
    const activeTab = this.root.querySelector(`[data-tab="${this.activeTab}"]`);
    this.hidden('[data-income-paused]', this.node('[data-field="incomeEnabled"]').checked);
    if (activeTab?.hidden) {
      this.tab('features');
    }
  }
  renderPK(engine) {
    let data = engine.pk?.current?.();
    const activity=engine.liveMetrics?.snapshot?.();
    if(activity) {
      const totals=activity.buckets.reduce((sum,item)=>{for(const key of ['chat','enter','gift','like','diamonds','unknownGifts'])sum[key]+=item[key] || 0;return sum;},{chat:0,enter:0,gift:0,like:0,diamonds:0,unknownGifts:0});
      this.text('[data-live-totals]',`弹幕 ${totals.chat} · 进场 ${totals.enter} · 点赞 ${totals.like} 次 · 礼物 ${totals.gift} 件 · 已知价值 ${totals.diamonds.toLocaleString('zh-CN')} 钻${totals.unknownGifts ? ` · ${totals.unknownGifts} 件单价未知` : ''}`);
    }
    if (!data || !data.key) {
      if(this.activeTab==='pk')this.charts.render({key:'waiting',activity});
      return;
    }
    data={...data,activity};
    const fmt = value => Number.isFinite(value) ? Math.round(value).toLocaleString('zh-CN') : '--';
    const pct = value => Number.isFinite(value) ? `${Math.round(value * 100)}%` : '未知';
    this.text('[data-pk-state]', data.phase === 'active' ? 'PK 进行中' : data.phase === 'ended' ? 'PK 已结束' : '等待 PK 事件');
    const status = {estimated:'数据可分析','low-confidence':'样本较少',stale:'比分已过期',unknown:'数据不足',final:'最终结果','awaiting-final':'等待终局确认'};
    const multi = (data.competitors || []).length >= 3;
    const complete = multi ? data.competitors.every(item=>item.scoreObserved) : data.selfScoreObserved && data.opponentScoreObserved;
    this.text('[data-pk-quality]', !complete ? '等待完整比分' : status[data.prediction.status] || '数据不足');
    this.node('[data-pk-multi]').hidden=!multi;
    this.node('.pk-scoreboard').hidden=multi; this.node('[data-pk-lead]').hidden=multi;
    this.node('.pk-prob').hidden=multi;
    if (multi) {
      const predictions=new Map((data.prediction.competitors || []).map(item=>[item.anchorId,item]));
      this.node('[data-pk-competitors]').innerHTML=data.competitors.map(item=>{
        const prediction=predictions.get(item.anchorId);
        return `<tr data-self="${item.anchorId===data.anchorId}"><td>${esc(item.name || (item.anchorId===data.anchorId?'己方':item.anchorId))}${item.anchorId===data.anchorId?' · 己方':''}</td><td>${item.scoreObserved?fmt(item.score):'--'}</td><td>${pct(prediction?.win)}</td></tr>`;
      }).join('') || '<tr><td colspan="3">等待参战方名单</td></tr>';
    }
    this.text('[data-pk-self-score]', data.selfScoreObserved ? fmt(data.selfScore) : '--'); this.text('[data-pk-opponent-score]', data.opponentScoreObserved ? fmt(data.opponentScore) : '--');
    this.text('[data-pk-self-name]', data.anchorName || '己方'); this.text('[data-pk-opponent-name]', data.opponentName || '对方');
    this.text('[data-pk-remaining]', Number.isFinite(data.remainingMs) ? `${Math.ceil(data.remainingMs / 1000)} 秒` : '--');
    this.text('[data-pk-self-win]', pct(data.prediction.selfWin)); this.text('[data-pk-opponent-win]', pct(data.prediction.opponentWin));
    this.text('[data-pk-self-speed]', fmt(data.selfSpeed)); this.text('[data-pk-opponent-speed]', fmt(data.opponentSpeed)); this.text('[data-pk-self-velocity]', fmt(data.selfVelocity60)); this.text('[data-pk-opponent-velocity]', fmt(data.opponentVelocity60));
    this.text('[data-pk-confidence]', Number.isFinite(data.prediction.confidence) ? `${Math.round(data.prediction.confidence * 100)}%` : '--');
    this.text('[data-pk-sample]', `${data.dataQuality.scoreSamples || 0} 次 · ${data.dataQuality.lagMs == null ? '--' : `${Math.round(data.dataQuality.lagMs)} ms`}`);
    const age = value => Number.isFinite(value) ? value < 1000 ? '刚刚' : `${Math.floor(value/1000)} 秒前` : '未观测';
    this.text('[data-pk-freshness]', multi
      ? `参战方 ${data.competitors.length} 人 · ${data.competitors.filter(item=>item.scoreObserved).length}/${data.competitors.length} 人有比分 · 最近更新 ${age(data.dataQuality.scoreAgeMs)}${data.phase === 'ended' ? ' · 已结束' : ''}`
      : `己方更新 ${age(data.dataQuality.selfScoreAgeMs)} · 对方更新 ${age(data.dataQuality.opponentScoreAgeMs)}${data.phase === 'ended' ? ' · 已结束' : ''}`);
    this.node('[data-pk-freshness]').dataset.stale=String(Boolean(data.dataQuality.stale));
    const lead=this.node('[data-pk-lead]'), total=data.selfScore+data.opponentScore;
    const ratio=data.selfScoreObserved && data.opponentScoreObserved && total>0 ? data.selfScore/total*100 : 50;
    lead.children[0].style.width=`${ratio}%`;lead.children[1].style.width=`${100-ratio}%`;
    lead.setAttribute('aria-label',data.selfScoreObserved && data.opponentScoreObserved ? `己方比分占比 ${Math.round(ratio)}%，对方 ${Math.round(100-ratio)}%` : '等待双方比分');
    const analysis=data.analysis || {};
    const standings=(data.competitors || []).filter(item=>item.scoreObserved);
    const topScore=standings.length?Math.max(...standings.map(item=>item.score)):null;
    const leaders=standings.filter(item=>item.score===topScore);
    this.text('[data-pk-summary]',multi
      ? !complete ? `多人 PK：等待全部 ${data.competitors.length} 位主播的比分` : leaders.length>1 ? `${leaders.length} 位主播当前并列领先` : `${leaders[0]?.name || '领先主播'} 当前领先 ${fmt(topScore)} 分`
      : analysis.summary || '等待更多比分，暂无法判断局势');
    this.text('[data-pk-basis]',multi
      ? [...(data.prediction.factors || []),`已观测 ${standings.length}/${data.competitors.length} 位主播；多人夺冠概率按参战方分别估计`].join('；')
      : [...(analysis.risks || []),...(analysis.basis ? Array.isArray(analysis.basis) ? analysis.basis : [analysis.basis] : [])].join('；') || '基于已观测比分与近窗速度，未采集的信息保持未知。');
    this.text('[data-pk-projected]',multi?'多人场次见排名表':Number.isFinite(analysis.projectedGap) ? `${analysis.projectedGap>0 ? '+' : ''}${fmt(analysis.projectedGap)} 分` : '等待倒计时与速度');
    this.text('[data-pk-required-rate]',multi?'--':Number.isFinite(analysis.requiredRate) ? `${analysis.requiredRate.toFixed(1)} 分/秒` : analysis.lead==='self' ? '当前领先' : '--');
    const contributors=[...(data.selfUsers || []).map(user=>({...user,side:'己方'})),...(data.opponentUsers || []).map(user=>({...user,side:'对方'}))].sort((a,b)=>(b.score || 0)-(a.score || 0) || b.value-a.value).slice(0,20);
    this.node('[data-pk-contributors]').innerHTML=contributors.length ? contributors.map(user=>`<tr><td>${esc(user.name || user.id || '观众')}</td><td>${user.side}</td><td>${fmt(user.score)}</td><td>${fmt(user.value)}</td></tr>`).join('') : '<tr><td colspan="4">暂无贡献者数据</td></tr>';
    this.node('[data-pk-effects]').innerHTML=data.effects?.length ? data.effects.slice(-8).map(effect=>`<li>${esc(effect.name || (effect.effectType==='multiplier' ? '倍率活动' : '卡片活动'))}${Number.isFinite(effect.multiplier) ? ` · ${effect.multiplier} 倍` : ''} · ${effect.active ? '生效中' : '已观测'}${Number.isFinite(effect.endAt) ? ` · ${timeFormat.format(effect.endAt)} 结束` : ''}</li>`).join('') : '<li>尚未采集明确的活动窗口，未将未知加成计入分数。</li>';
    const trend=data.trend || data.history.filter(item=>item.kind==='score');
    const scoreHeader=this.node('[data-pk-score-header]');
    if(multi){
      this.text('[data-pk-score-summary]','查看多人比分明细（最近 20 次）');
      scoreHeader.innerHTML=`<th>北京时间</th>${data.competitors.map(item=>`<th>${esc(item.name || item.anchorId)}</th>`).join('')}`;
      this.node('[data-pk-score-rows]').innerHTML=trend.length?trend.slice(-20).reverse().map(item=>`<tr><td>${timeFormat.format(item.at)}</td>${data.competitors.map(competitor=>`<td>${Number.isFinite(item.competitorScores?.[competitor.anchorId])?fmt(item.competitorScores[competitor.anchorId]):'--'}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${data.competitors.length+1}">等待比分</td></tr>`;
      this.node('[data-pk-chart="scores"]').setAttribute('aria-label',`多人 PK ${data.competitors.length} 位参战主播比分走势`);
    }else{
      this.text('[data-pk-score-summary]','查看比分明细（最近 20 次）');
      scoreHeader.innerHTML='<th>北京时间</th><th>己方</th><th>对方</th><th>分差</th>';
      this.node('[data-pk-score-rows]').innerHTML=trend.length ? trend.slice(-20).reverse().map(item=>`<tr><td>${timeFormat.format(item.at)}</td><td>${fmt(item.selfScore)}</td><td>${fmt(item.opponentScore)}</td><td>${Number.isFinite(item.selfScore)&&Number.isFinite(item.opponentScore) ? fmt(item.selfScore-item.opponentScore) : '--'}</td></tr>`).join('') : '<tr><td colspan="4">等待比分</td></tr>';
      this.node('[data-pk-chart="scores"]').setAttribute('aria-label','双方比分走势，实线为己方、虚线为对方');
    }
    if (multi) {
      for(const selector of ['[data-pk-self-speed]','[data-pk-opponent-speed]','[data-pk-self-velocity]','[data-pk-opponent-velocity]'])this.text(selector,'--');
    }
    if (this.activeTab==='pk') this.charts.render(data);
    const factors = data.prediction.factors?.length ? data.prediction.factors : ['等待更多比分和速度变化']; this.node('[data-pk-factors]').innerHTML = factors.map(item => `<li>${esc(item)}</li>`).join('');
    const intent = [['己方', data.selfIntent], ['对方', data.opponentIntent]]; this.node('[data-pk-intent]').innerHTML = intent.map(([label, item]) => `<tr><td>${label}</td><td>${pct(item.probability)}</td><td>${item.sampleSize || 0}</td><td>${fmt(item.expected)}</td></tr>`).join('');
    const chat = data.chatSignals || { recent:0, opponent:{ total:0, request:0, comeback:0, positive:0, negative:0 } };
    const opponent = chat.opponent || {};
    this.text('[data-pk-chat-recent]', `${chat.recent || 0} 条`);
    this.text('[data-pk-chat-request]', opponent.total ? `${Math.round((opponent.request || 0) / opponent.total * 100)}%` : '未知');
    this.text('[data-pk-chat-comeback]', opponent.total ? `${Math.round((opponent.comeback || 0) / opponent.total * 100)}%` : '未知');
    const sentiment = (opponent.positive || 0) > (opponent.negative || 0) ? '偏积极' : (opponent.negative || 0) > (opponent.positive || 0) ? '偏消极' : opponent.total ? '中性' : '未知';
    this.text('[data-pk-chat-sentiment]', sentiment);
    this.text('[data-pk-chat]', opponent.total ? `对手房间已采集 ${opponent.total} 条文本；信号仅按关键词计数，不能代表所有观众或主播真实意图。` : '尚未采集对手弹幕；当前页未提供的对手信息保持未知。');
    const rate = (label, item) => {
      if (!item?.trials) return `<tr><td>${label}</td><td>0 / 0</td><td>未知</td><td>--</td></tr>`;
      return `<tr><td>${label}</td><td>${item.successes} / ${item.trials}</td><td>${pct(item.rate)}</td><td>${pct(item.low)}–${pct(item.high)}</td></tr>`;
    };
    this.node('[data-pk-rates]').innerHTML = [rate('3 倍加成', data.multiplierStats), rate('卡片 / 宝箱命中', data.cardStats)].join('');
  }
  setAnchorView(view) {
    if (!['overview','income'].includes(view)) return;
    this.anchorView = view;
    for (const button of this.root.querySelectorAll('[data-anchor-view]')) button.setAttribute('aria-pressed', String(button.dataset.anchorView === view));
    for (const content of this.root.querySelectorAll('[data-anchor-content]')) content.hidden = content.dataset.anchorContent !== view;
    this.node('.scroll').scrollTop = 0;
  }
  tab(key) {
    if (this.root.querySelector(`[data-tab="${key}"]`)?.hidden) return;
    this.activeTab = key; this.node('.scroll').scrollTop = 0; if (key === 'diagnostics') this.renderLogs();
    if (['anchor','profiles'].includes(key)) void this.callbacks.income?.();
    const category = interactionPages.includes(key) ? 'interaction' : 'settings';
    this.activeCategory = category;
    for (const node of this.root.querySelectorAll('[data-category]')) node.setAttribute('aria-pressed', String(node.dataset.category === category));
    for (const node of this.root.querySelectorAll('[data-tab]')) { const active = node.dataset.tab === key; node.setAttribute('aria-selected', String(active)); node.tabIndex = active ? 0 : -1; }
    this.navigation.sync(category);
    const featureByPage = { pk: null, anchor:null, gift: 'gift', welcome: 'welcome', likes: 'like', keywords: 'keyword', bot:'bot', timers: 'timersEnabled' };
    for (const node of this.root.querySelectorAll('[data-page]')) {
      const feature = featureByPage[node.dataset.page];
      const disabled = feature && !this.root.querySelector(`[data-field="${feature === 'timersEnabled' ? feature : `${feature}.enabled`}"]`)?.checked;
      node.hidden = node.dataset.page !== key || Boolean(disabled);
    }
    if(key==='pk' && this.latest) this.renderPK(this.latest[0]);
    if(key==='anchor' && this.latest) this.renderAnchor(this.latest[0]);
  }
  bind() {
    this.node('[data-pk-window]').addEventListener('change',event=>{this.charts.windowMs=Number(event.target.value);if(this.latest)this.renderPK(this.latest[0]);});
    for (const select of this.root.querySelectorAll('[data-income-room],[data-income-month]')) select.addEventListener('change', () => { this.node('[data-action="export-income"]').disabled = true; void this.callbacks.income?.(); });
    this.root.querySelector('form').addEventListener('submit', e => e.preventDefault());
    // 面板内的输入和方向键不应冒泡到直播页的播放器/发送快捷键。
    for (const type of ['keydown','keyup','keypress']) this.root.addEventListener(type, e => {
      e.stopPropagation();
      const action = e.target.closest('[data-action="start"],[data-action="stop"]');
      if (action && ['Enter',' '].includes(e.key) && (e.repeat || e.isComposing || e.keyCode === 229 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey)) e.preventDefault();
    });
    const edited = e => {
      if (!e.target.closest('[data-field],[data-item],[data-api-key],[data-remember-key],[data-preset]')) return;
      this.markDirty(); e.target.removeAttribute('aria-invalid'); this.syncControls();
      if (e.target.dataset.field?.startsWith('identity.') && this.identity) this.updateIdentity(this.identity);
    };
    this.root.addEventListener('input', edited); this.root.addEventListener('change', edited);
    this.node('.nav').addEventListener('keydown', e => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const group = e.target.closest('[data-subnav]');
      if (!group) return;
      const vertical = group.getAttribute('aria-orientation') === 'vertical';
      const forward = vertical ? 'ArrowDown' : 'ArrowRight', backward = vertical ? 'ArrowUp' : 'ArrowLeft';
      if (![forward, backward, 'Home', 'End'].includes(e.key)) return;
      const tabs = [...group.querySelectorAll('[data-tab]')].filter(tab => !tab.hidden);
      if (!tabs.length || !tabs.includes(this.root.activeElement)) return;
      e.preventDefault(); const current = tabs.indexOf(this.root.activeElement);
      const i = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (current + (e.key === forward ? 1 : -1) + tabs.length) % tabs.length;
      this.tab(tabs[i].dataset.tab); tabs[i].focus();
    });
    this.root.addEventListener('click', async e => {
      const category=e.target.closest('[data-category]');
      if(category){
        const firstVisibleTab=[...this.root.querySelectorAll(`[data-subnav="${category.dataset.category}"] [data-tab]`)].find(tab=>!tab.hidden && !(category.dataset.category === 'interaction' && ['pk','anchor'].includes(tab.dataset.tab)));
        if(firstVisibleTab)this.tab(firstVisibleTab.dataset.tab);
        return;
      }
      const giftValue = e.target.closest('[data-gift-value]'); if (giftValue) { const field = this.root.querySelector('[data-field="gift.minValue"]'); field.value = giftValue.dataset.giftValue; this.markDirty(); this.syncControls(); field.focus(); return; }
      const add = e.target.closest('[data-add]'); if (add) return this.addRow(add.dataset.add);
      const remove = e.target.closest('[data-remove]'); if (remove) { remove.closest('[data-list-row]').remove(); this.markDirty(); this.syncControls(); return; }
      const move = e.target.closest('[data-move]');
      if (move) { const row = move.closest('[data-list-row]'), sibling = move.dataset.move === 'up' ? row.previousElementSibling : row.nextElementSibling; if (sibling) { if (move.dataset.move === 'up') row.parentNode.insertBefore(row,sibling); else row.parentNode.insertBefore(sibling,row); this.markDirty(); } return; }
      const go = e.target.closest('[data-go]'); if (go) {
        if (go.hasAttribute('data-ack-runtime-alert')) await this.callbacks.acknowledgeRuntimeAlert?.();
        if (go.dataset.anchorTarget) this.setAnchorView(go.dataset.anchorTarget);
        this.tab(go.dataset.go); return;
      }
      const anchorView = e.target.closest('[data-anchor-view]'); if (anchorView) { this.setAnchorView(anchorView.dataset.anchorView); return; }
      const tab = e.target.closest('[data-tab]'); if (tab) this.tab(tab.dataset.tab);
      const button = e.target.closest('[data-action]'); if (!button || button.disabled || button.hidden) return;
      const action = button.dataset.action;
      try {
        if (action === 'export-income') { this.setBusy(action,true); await this.callbacks.exportIncome?.(); return; }
        if (action === 'export-anchor') { await this.callbacks.exportAnchor?.(this.anchorDashboard.exportReport()); return; }
        if (action === 'refresh-anchor') { this.setBusy(action,true); await this.callbacks.income?.(); const refreshed = await this.callbacks.refreshAnchor?.(); this.toast(refreshed ? '主播统计已刷新。' : '本地统计已刷新；展馆暂不可用，请确认已登录并打开直播间。', !refreshed); return; }
        if (action === 'add-profile') { this.setBusy(action,true); await this.callbacks.addProfile?.(this.node('[data-profile-url]').value); this.node('[data-profile-url]').value = ''; return; }
        if (action === 'close') return this.toggleOpen();
        if (action === 'identity-settings') { this.tab('diagnostics'); this.node('[data-manual-identity]').open = true; return; }
        if (action === 'identify') { this.setBusy(action, true); await this.callbacks.identify?.(); return; }
        if (action === 'add-viewer') {
          const viewer = this.viewers.find(u=>u.key===this.node('[data-viewer-picker]').value);
          if (!viewer) { this.toast('先选择一位最近出现的观众'); return; }
          const value = viewer.id ? `uid:${viewer.id}` : viewer.secUid ? `sec:${viewer.secUid}` : `name:${viewer.name}`;
          if (this.readList('listed').includes(value)) { this.toast('这位观众已经在名单中'); return; }
          this.addRow('listed',value); this.toast('已加入名单，保存后生效'); return;
        }
        if (action === 'clear-log') { this.entries = []; this.renderLogs(); return; }
        if (action === 'recover-events' || action === 'export-events') {
          button.disabled = true;
          try { await this.callbacks[action === 'recover-events' ? 'recoverEvents' : 'exportEvents'](); this.toast(action === 'recover-events' ? '已尝试恢复，请核对采集状态和缺口记录' : '恢复数据已导出'); }
          finally { button.disabled = false; }
          return;
        }
        if (action === 'release-cache') { this.setBusy(action,true); try { await this.callbacks.clearCache?.(); this.toast('临时协议缓存已释放'); } finally { this.setBusy(action,false); } return; }
        if (action === 'import-income') return this.node('[data-import-income-file]').click();
        if (action === 'import') return this.root.querySelector('[data-import-file]').click();
        if (action === 'save' || action === 'test-ai') {
          const config = this.read(); const key = this.root.querySelector('[data-api-key]').value.trim();
          const remember = this.root.querySelector('[data-remember-key]').checked;
          this.setBusy(action, true);
          await this.callbacks[action === 'save' ? 'save' : 'testAI'](config, key, remember);
          if (action === 'save') this.populate(config);
        } else if (action === 'export') this.callbacks.exportConfig();
        else if (action === 'export-log') this.callbacks.exportLog(copy(this.entries));
        else if (action === 'forget-key') await this.callbacks.forgetKey(this.root.querySelector('[data-field="ai.endpoint"]').value);
        else if (action === 'pick-input' || action === 'pick-send') this.callbacks.pick(action === 'pick-input' ? 'input' : 'send');
        else if (action === 'start') {
          this.setBusy(action, true);
          if (this.dirty) { const config = this.read(); await this.callbacks.save(config,this.node('[data-api-key]').value.trim(),this.node('[data-remember-key]').checked); this.populate(config); }
          await this.callbacks.start();
        }
        else if (action === 'stop') this.callbacks.stop();
        else if (action === 'debug-send') { this.setBusy(action, true); await this.callbacks.debugSend?.(); this.toast('测试消息已加入发送队列'); }
        else if (action === 'lab') this.callbacks.lab();
        else if (action === 'diagnose') { this.setBusy(action, true); this.showDiagnostics(await this.callbacks.diagnose()); }
      } catch (error) { this.toast(error.message, true); }
      finally { if (action) this.setBusy(action, false); }
    });
    this.root.querySelector('[data-log-filter]').addEventListener('change', () => this.renderLogs());
    this.node('[data-log-details]').addEventListener('toggle', () => { if (this.node('[data-log-details]').open && this.logDirty) this.renderLogs(); });
    this.root.querySelector('[data-import-file]').addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      try { if (file.size > 1024 * 1024) throw new Error('配置文件超过 1 MB'); const c = validateConfig(mergeConfig(JSON.parse(await file.text()))); this.populate(c); this.markDirty(); this.toast('配置已载入，请检查后保存'); }
      catch (error) { this.toast(error.message, true); } finally { e.target.value = ''; }
    });
    this.node('[data-import-income-file]').addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      try {
        if (file.size > 16 * 1024 * 1024) throw new Error('恢复文件超过 16 MB');
        await this.callbacks.importIncome(JSON.parse(await file.text()));
      } catch (error) { this.toast(error.message, true); } finally { e.target.value = ''; }
    });
    const clearKey = () => { this.root.querySelector('[data-api-key]').value = ''; this.root.querySelector('[data-key-status]').textContent = '接口已改变。新服务需单独填写密钥，不会沿用其他域名的密钥。'; };
    this.root.querySelector('[data-field="ai.endpoint"]').addEventListener('input', clearKey);
    this.root.querySelector('[data-preset]').addEventListener('change', e => {
      this.node('[data-ai-connection]').open = ['custom','doubao','local'].includes(e.target.value);
      const preset = presets[e.target.value]; if (!preset) return;
      this.root.querySelector('[data-field="ai.endpoint"]').value = preset[0]; this.root.querySelector('[data-field="ai.model"]').value = preset[1]; clearKey();
    });
  }
  log(category, message) {
    this.entries.push({ at: new Date().toISOString(), category, message, time: timeFormat.format(new Date()) });
    if (category === 'preview' || category === 'sent') {
      this.lastReply = message; this.lastReplyCategory = category;
      if (this.open) this.renderLastReply();
    }
    if (this.entries.length > 200) this.entries.shift(); this.logDirty = true;
    if (!this.logTimer && this.open && this.activeTab === 'diagnostics' && this.node('[data-log-details]').open) this.logTimer = setTimeout(() => { this.logTimer = null; if (this.logDirty) this.renderLogs(); }, 250);
  }
  renderLastReply() {
    this.text('[data-reply-title]', this.lastReplyCategory === 'sent' ? '最近提交' : this.lastReplyCategory === 'preview' ? '最近预览' : '最近回复');
    this.text('[data-last-reply]', this.lastReply || '开始后，符合规则的回复会显示在这里。');
    this.node('[data-last-reply]').classList.toggle('empty', !this.lastReply);
    this.text('[data-overview-reply]', this.lastReply || '暂无回复记录。');
  }
  renderOverview(engine) {
    const alertEntries = this.entries.filter(entry => entry.category === 'moderation' || entry.category === 'error');
    const recentAlerts = alertEntries.slice(-4).reverse();
    this.text('[data-overview-state]', engine.running ? `运行中 · ${{preview:'仅预览',auto:'自动发送'}[engine.config.mode]}` : '已暂停');
    this.text('[data-overview-stat="events"]', engine.stats.events);
    this.text('[data-overview-stat="submitted"]', engine.stats.submitted);
    this.text('[data-overview-stat="alerts"]', alertEntries.length);
    const alertSignature = recentAlerts.map(entry => `${entry.at}:${entry.category}:${entry.message}`).join('|') || 'empty';
    if (alertSignature !== this.overviewAlertSignature) {
      this.overviewAlertSignature = alertSignature;
      const box = this.node('[data-overview-alerts]');
      box.innerHTML = recentAlerts.length
        ? recentAlerts.map(entry => `<div class="overview-item" data-category="${esc(entry.category)}"><time>${esc(entry.time)}</time><span>${esc(entry.message)}</span></div>`).join('')
        : '<div class="overview-empty">暂无需要核查的提醒。</div>';
    }
  }
  renderLogs() {
    if (!this.open || this.activeTab !== 'diagnostics' || !this.node('[data-log-details]').open) { this.logDirty = true; return; }
    this.logDirty = false;
    const box = this.root.querySelector('[data-logs]'), filter = this.root.querySelector('[data-log-filter]').value;
    const follow = box.scrollTop + box.clientHeight >= box.scrollHeight - 24;
    box.innerHTML = this.entries.filter(e => filter === 'all' || e.category === filter).slice(-100).map(e => `<div class="log" data-category="${esc(e.category)}"><time>${esc(e.time || timeFormat.format(new Date(e.at)))}</time><span class="cat">${esc(categories[e.category] || e.category)}</span><span>${esc(e.message)}</span></div>`).join('');
    if (follow) box.scrollTop = box.scrollHeight;
  }
  showDiagnostics(status) {
    const unknownMethods = Object.entries(status.unknownMethods || {}).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const roomStats = status.roomData?.stats, audience = status.roomData?.audience;
    const domSnapshot = status.domSnapshot;
    const leaders = (audience?.ranks || []).slice(0,5).map(row=>`${row.rank ?? '?'} ${row.user?.name || '观众'} ${row.score ?? '?'}分`).join('；');
    this.root.querySelector('[data-diagnostics]').textContent = [
      `连接观察器：${status.hook ? '已安装' : '未安装'}`, `捕获连接：${status.sockets}；连接${status.connected ? '在线' : '离线'}`,
      `解析消息帧：${status.frames}；结构化事件：${status.events}；解析失败：${status.errors}`,
      `IM 长轮询：观察器${status.pollHook ? '已安装' : '未安装'}；响应 ${status.pollResponses || 0}；解码帧 ${status.pollFrames || 0}；事件 ${status.pollEvents || 0}；不支持响应 ${status.pollUnsupported || 0}；跨通道重复 ${status.duplicateEvents || 0}`,
      `未识别协议 method：${unknownMethods.length ? unknownMethods.map(([method,count])=>`${method} ×${count}`).join('、') : '暂无'}`,
      `房间统计：${roomStats ? roomStats.hidden ? '平台标记隐藏' : roomStats.displayLong || roomStats.displayMiddle || roomStats.displayShort || (roomStats.displayValue ?? '已收到') : '尚未收到'}`,
      `观众序列：${audience ? `在线 ${audience.onlineDisplay || (audience.onlineCount ?? '未知')}；累计 ${audience.cumulativeUsersDisplay || (audience.cumulativeUsers ?? '未知')}；榜单 ${audience.ranks?.length || 0} 人${leaders ? `；${leaders}` : ''}` : '尚未收到'}`,
      `页面 DOM 快照：${domSnapshot ? `在线 ${domSnapshot.onlineCount ?? '未知'}；本场点赞 ${domSnapshot.likeTotal ?? '未知'}；可见贡献榜 ${domSnapshot.visibleContributionRows} 行` : '不可用'}`,
      `近期只读房间活动：${status.roomData?.activities?.length || 0}`,
      `捕获礼物事件：${status.giftEvents || 0}`,
      status.lastGift ? `最近礼物：${status.lastGift.giftName} ×${status.lastGift.count}；单价 ${status.lastGift.unitValue ?? '未知'} 钻${status.lastGift.timestampSkewMs == null ? '' : `；平台时间偏差 ${Math.round(status.lastGift.timestampSkewMs / 1000)} 秒`}` : '最近礼物：尚未捕获',
      `待解码帧：${status.pendingFrames || 0}`,
      `最近消息：${status.lastFrame ? new Date(status.lastFrame).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '尚未收到'}`,
      `消息接收连接：${status.healthy ? '在线' : '未就绪；请刷新直播页，确认开播状态'}`,
      `主播 UID：${status.anchorId}`, `输入框：${status.input}`, `发送按钮：${status.send}`,
      '发送结果：以本人普通弹幕或管理员弹幕的结构化回显为准；接收连接在线、控件已找到均不代表发送成功。',
      '礼物价值与等级来源：结构化直播消息；网页文字不会用于猜测。'
    ].join('\n');
  }
  renderDelivery(engine, network) {
    const records = engine.deliveries.records;
    const pending = engine.deliveries.pending();
    const signature = JSON.stringify(records.map(({jobs,...record})=>record));
    if (signature !== this.deliverySignature) {
      this.deliverySignature = signature;
      const states = {prepared:'待发送',clicked:'已提交 · 等待回显',echoed:'已回显',unknown:'结果未知 · 不自动重发',failed:'发送失败 · 自动重试',retrying:'自动重试中',cancelled:'未点击 · 自动重试'};
      this.node('[data-deliveries]').innerHTML = records.length ? [...pending,...records.filter(record=>!pending.includes(record)).slice(-10).reverse()].map(record=>`<div class="section"><strong>${esc(states[record.state] || record.state)}</strong><p>${esc(record.text)}</p><p class="hint">${esc(record.reason || (record.state === 'echoed' ? `回显延迟 ${record.latencyMs} ms${record.messageId ? ` · 消息 ${record.messageId}` : ''}` : '等待本人账号的公屏回显'))}</p></div>`).join('') : '<p class="empty">暂无发送记录。</p>';
    }
    const health = network.ingestion || {}, storage = network.storage;
    const capture = network.capture || {}, gaps = (health.gaps || 0)+(network.bridgeGaps || 0)+(network.frameGaps || 0)+(capture.gaps || 0);
    const storageText = storage?.used != null ? `临时缓存 ${(storage.used/1024/1024).toFixed(2)} / ${(storage.quota/1024/1024).toFixed(0)} MB；持久数据 ${(Object.values(storage.durable?.categories || {}).reduce((sum,item)=>sum+item.bytes,0)/1024/1024).toFixed(2)} MB（IndexedDB）` : '存储用量尚未取得';
    const pruneText = storage?.pruned?.deleted ? `；最近自动清理 ${storage.pruned.deleted} 条旧协议帧（${(storage.pruned.bytes/1024/1024).toFixed(2)} MB）` : '';
    this.text('[data-ingestion-health]',`${health.blocked ? '采集交接受阻（场控仍保持运行）' : health.quarantined ? '有隔离事件待处理' : '采集交接正常'} · 本次协议帧已保存 ${capture.saved || 0} 条 / 等待 ${capture.pending || 0} 条 · 隔离 ${health.quarantined || 0} 条 · 已知缺口 ${gaps}（事件或帧） · ${storageText}${pruneText}${health.reason ? `。${health.reason}` : ''}`);
    const alert = hasUnacknowledgedRuntimeAlert(network,network.acknowledgedRuntimeAlert);
    this.hidden('[data-runtime-alert]', !alert);
    if (alert) this.text('[data-runtime-alert-text]', network.contextInvalidated ? '扩展连接已失效，自动发送和后台重试已暂缓。请先导出恢复数据，再刷新直播页。' : `${health.blocked ? '采集交接受阻，场控仍保持运行。' : ''}${gaps ? '采集存在缺口。' : ''}${health.quarantined ? '有隔离事件待重试。' : ''}${storage?.ratio >= .8 ? '本地存储接近上限，旧协议帧已自动清理，待处理事件和账本仍保留。' : ''}`);
  }
  refresh(engine, network = {}) {
    this.latest = [engine,network];
    const mode = { preview: '仅预览', auto: '自动发送' }[engine.config.mode];
    this.syncLauncher();
    if (!this.open) return;
    this.text('[data-state]', network.contextInvalidated ? '扩展连接失效 · 待刷新' : engine.running ? `运行中 · ${mode}` : '已暂停');
    this.text('[data-shell-state]', this.node('[data-state]').textContent);
    this.text('[data-shell-network]', this.demo ? '模拟数据' : network.connected && network.frames ? '直播数据已连接' : '等待直播数据');
    const badge = this.node('[data-network]'); this.text('[data-network]', this.demo ? '模拟数据' : network.connected && network.frames ? '直播数据已连接' : '等待直播数据'); badge.classList.toggle('live', Boolean(network.connected && network.frames));
    for (const key of ['events','filtered','previews','submitted']) this.text(`[data-stat="${key}"]`,engine.stats[key]);
    this.text('[data-delivery-health]', `待发送 ${engine.queue.length} 条 · 等待结算 ${[...engine.gifts.values()].filter(g => g.count > g.credited).length} 组礼物 · 重试 ${engine.stats.retries} 次 · 过期 ${engine.stats.expired} 条 · 队列满 ${engine.stats.overflow} 次`);
    this.renderDelivery(engine,network); this.renderPK(engine);
    if (this.activeTab === 'anchor') this.renderAnchor(engine);
    this.text('[data-bot-session]', engine.bot?.sessionSummary?.() || '当前没有进行中的游戏。');
    this.syncFooter(); this.renderLastReply(); this.renderOverview(engine);
    for (const action of ['identify','test-ai','diagnose','refresh-anchor']) this.disabled(`[data-action="${action}"]`, this.busyActions.has(action) || (action === 'test-ai' && ['save','start'].some(a=>this.busyActions.has(a))));
  }
  destroy() { this.navigation.destroy(); this.adaptive.destroy(); this.anchorDashboard.destroy(); this.charts.destroy(); this.theme.destroy(); this.floating.destroy(); clearTimeout(this.logTimer); clearTimeout(this.toastTimer); this.host.remove(); }
}
