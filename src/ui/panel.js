import { copy, mergeConfig, validateConfig } from '../core/engine.js';
import { validateEndpoint } from '../services/ai.js';
import { giftDate } from '../data/gifts.js';
import { BOT_COMMANDS, RoomBot } from '../core/bot.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const at = (o, path) => path.split('.').reduce((v, k) => v?.[k], o);
const put = (o, path, value) => { const parts = path.split('.'); const key = parts.pop(); parts.reduce((v, k) => v[k], o)[key] = value; };
const categories = { system: '运行', filter: '过滤', moderation: '内容提醒', queue: '发送队列', preview: '预览', sent: '提交', ai: 'AI', error: '错误', lab: '自检' };
const timeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
const interactionPages = ['gift','welcome','likes','keywords','bot','timers','income'];
const money = value => new Intl.NumberFormat('zh-CN', {style:'currency',currency:'CNY',maximumFractionDigits:2}).format(value);
const presets = {
  deepseek: ['https://api.deepseek.com/chat/completions', 'deepseek-flash'],
  qwen: ['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'qwen-plus'],
  doubao: ['https://ark.cn-beijing.volces.com/api/v3/chat/completions', '请填写你的接入点ID'],
  local: ['http://localhost:11434/v1/chat/completions', 'qwen2.5:7b']
};
const CSS_TEXT = `
:host{all:initial;font:14px/1.5 "PingFang SC","Microsoft YaHei",sans-serif;color:#172a2d;--ink:#172a2d;--muted:#53666a;--line:#cbd6d4;--accent:#08796f;--accent-strong:#075b56;--paper:#f4f7f5;--surface:#fff;--wash:#e2f1ed;--signal:#d76048;--amber:#f2c66d;--warning:#fff1d2;--danger:#a62f3f}
*{box-sizing:border-box}button,input,select,textarea{font:inherit}button{cursor:pointer;transition:background-color 120ms,border-color 120ms,color 120ms,transform 120ms}button:disabled{cursor:wait;opacity:.52}button,input,select,textarea{border:1px solid var(--line);border-radius:6px;color:var(--ink)}button{background:var(--surface);padding:8px 12px;min-height:38px}button:hover:not(:disabled){background:var(--wash);border-color:#93bbb3}button:active:not(:disabled){transform:translateY(1px)}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #7ec5b9;outline-offset:2px}.primary{background:var(--accent);color:#fff;border-color:var(--accent)}.primary:hover:not(:disabled){background:var(--accent-strong);color:#fff}.danger{color:var(--danger)}
.launcher{position:fixed;right:24px;bottom:24px;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;cursor:grab}.launcher>*{pointer-events:none}
.panel{position:fixed;right:24px;bottom:82px;width:min(560px,calc(100vw - 32px));height:min(780px,calc(100vh - 110px));display:flex;flex-direction:column;background:var(--paper);border:1px solid #aebfbb;border-radius:8px;box-shadow:0 22px 66px #142c2d42;overflow:hidden}.panel[hidden]{display:none}
.head{padding:16px 20px;background:#173a3b;color:#fff;display:flex;justify-content:space-between;gap:16px;align-items:center;border-bottom:3px solid var(--accent)}.head h1{font-size:18px;line-height:1.25;margin:0;font-weight:680}.room{color:#d0e3dd;font-size:12px;margin-top:4px}.head button{border:1px solid #62817c;background:transparent;color:white;padding:4px 10px;min-height:32px}.head button:hover{background:#285453;color:white}.banner{margin:0;background:var(--warning);color:#634a19;padding:8px 20px;font-size:12px;border-bottom:1px solid #ecd69e}.nav{background:var(--surface);border-bottom:1px solid var(--line);flex-shrink:0}.primary-nav{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:8px 12px 6px}.primary-nav button{border:0;background:transparent;min-height:34px;padding:5px 8px;color:var(--muted);font-size:13px;font-weight:600}.primary-nav button[aria-pressed=true]{background:#e5f1ed;color:var(--accent-strong)}.subnav{display:flex;gap:5px;padding:0 14px 8px;overflow-x:auto;scrollbar-width:none}.subnav[hidden]{display:none}.subnav button{border:0;border-radius:4px;background:transparent;padding:5px 10px;white-space:nowrap;color:var(--muted);min-height:30px;font-size:12px}.subnav button[aria-selected=true]{background:#f3eae6;color:#983f34;font-weight:700}.subnav button:hover{background:#f1f7f4;color:var(--ink)}
.scroll{overflow-y:auto;flex:1;padding:18px 20px;overscroll-behavior:contain;scrollbar-color:#afc1bd transparent}.page[hidden]{display:none}.page h2{font-size:18px;margin:0 0 6px;line-height:1.35}.intro,.hint{font-size:12px;color:var(--muted);margin:6px 0 14px;line-height:1.6}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.status{display:flex;gap:9px;align-items:center;margin-bottom:12px}.status strong{font-size:13px}.badge{background:#e9eeec;color:#526467;border-radius:4px;padding:3px 8px;font-size:11px;font-weight:600}.badge.live{background:#e2f4eb;color:#17694d}.actions{display:flex;gap:7px;flex-wrap:wrap}.stats{display:flex;margin:14px 0 18px;padding:12px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.stats div{flex:1}.stats b{font-size:22px;display:block;line-height:1.2;font-weight:650}.stats span{font-size:11px;color:var(--muted)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}.field{display:flex;flex-direction:column;gap:5px;margin:0 0 12px;min-width:0}.field span{font-size:12px;font-weight:650}.field small{color:var(--muted);font-size:11px;font-weight:400}.field input,.field select,.field textarea{background:var(--surface);width:100%;padding:8px 10px;min-height:40px}.field textarea{resize:vertical;min-height:76px;line-height:1.5}.toggle{display:flex;align-items:center;gap:9px;min-height:38px;margin:3px 0 10px;font-size:13px}.toggle input{width:18px;height:18px;accent-color:var(--accent)}.section{padding-top:14px;margin-top:14px;border-top:1px solid var(--line)}.section h3,.subhead{font-size:13px;margin:0 0 9px;font-weight:700}.notice{padding:10px 12px;border-left:3px solid var(--amber);background:#fff7e5;font-size:12px;color:#624e27;line-height:1.65;margin:12px 0}
.queue{margin-top:10px}.candidate{border-bottom:1px solid var(--line);padding:12px 0;display:grid;grid-template-columns:74px 1fr;gap:10px}.candidate .kind{font-size:11px;color:var(--accent-strong);font-weight:650}.candidate textarea{display:block;width:100%;padding:8px 10px;background:var(--surface);resize:vertical;min-height:52px;margin-bottom:7px}.candidate p{margin:0 0 6px;word-break:break-word}.candidate button{font-size:12px;padding:4px 9px;min-height:30px}.empty{color:var(--muted);font-size:12px;padding:12px 0}.log-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.log-head select{background:var(--surface);padding:5px 8px;max-width:150px}.logs{max-height:230px;overflow:auto;border-top:1px solid var(--line)}.log{display:grid;grid-template-columns:54px 42px 1fr;gap:8px;font-size:11px;padding:8px 0;border-bottom:1px solid #dce4e1;word-break:break-word}.log time,.log .cat{color:var(--muted)}.log[data-category=error]{color:var(--danger)}.log[data-category=preview] .cat{color:var(--accent-strong)}
.foot{padding:10px 18px;border-top:1px solid #bfcfcb;background:var(--surface);display:flex;justify-content:space-between;gap:12px;align-items:center;flex-shrink:0}.foot small{font-size:11px;color:var(--muted)}.foot .primary{min-width:122px}.foot [hidden]{display:none}.foot [data-action=save]:disabled{cursor:default}.dirty{color:#9b5a12!important}.toast{padding:9px 20px;font-size:12px;background:#e2f1ed;color:#24564f;flex-shrink:0;border-bottom:1px solid #c2d9d2}.toast[hidden]{display:none}.toast.error{background:#fae7e8;color:#8c2336}pre{font:12px/1.65 "SFMono-Regular",Consolas,monospace;white-space:pre-wrap;word-break:break-all;background:#e8efec;padding:12px;border-radius:6px;color:#334b4a}.inline{display:flex;gap:8px;align-items:center}.inline input{flex:1}.file{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}.wide{grid-column:1/-1}
.identity{padding:0 0 10px;border:0;border-bottom:1px solid var(--line);border-radius:0;margin-bottom:13px;background:transparent}.identity strong{font-size:13px}.identity p{margin:3px 0;font-size:12px;color:var(--muted)}.identity .actions{margin-top:8px}.identity details{margin-top:4px}.identity summary{padding:3px 0}.recent-gifts h3{margin:0;font-size:13px}.gift-activity{display:grid;grid-template-columns:minmax(74px,1fr) minmax(90px,1.4fr) auto;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line);font-size:12px}.gift-activity strong,.gift-activity span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gift-activity small{color:var(--muted);text-align:right}.editor-row{padding:12px 0;border-bottom:1px solid var(--line)}.editor-row .row-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.editor-row .row-head b{font-size:12px}.editor-row .row-head button{min-height:30px;padding:4px 9px;font-size:11px}.editor-row .grid{gap:8px 10px}.editor-row .field{margin-bottom:8px}.editor-row textarea{min-height:60px}.list-add{margin-top:9px}.feature-shortcuts{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.feature-shortcuts button{font-size:12px}.feature-shortcuts button[aria-pressed=true]{background:#e4f1eb;color:#28694f;border-color:#bad8ca}summary{cursor:pointer;color:var(--muted);font-size:12px;padding:8px 0}summary:hover{color:var(--accent-strong)}.choice-hint{font-size:11px;color:var(--muted)}[aria-invalid=true]{border-color:var(--danger)!important;box-shadow:0 0 0 2px #a62f3f18}
.mode-note{font-size:12px;color:var(--muted);margin:0 0 10px;padding:7px 9px;border-left:2px solid var(--amber);background:#fff7e5}.feature-list{border-top:1px solid var(--line);margin:9px 0 12px}.feature-row{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--line)}.feature-title{flex:1;text-align:left;padding:0;border:0;background:transparent;font-weight:700;min-width:0;font-size:13px}.feature-title small{display:block;font-size:11px;color:var(--muted);font-weight:400;overflow-wrap:anywhere;margin-top:2px}.feature-title:hover,.text-button:hover{background:transparent;color:var(--accent-strong)}.text-button{border:0;background:transparent;font-size:12px;padding:4px;color:var(--muted);min-height:32px}.switch{position:relative;width:40px;height:26px;min-height:26px;padding:3px;border:0;border-radius:20px;background:#b3c0bd;flex-shrink:0}.switch input{position:absolute;inset:0;z-index:1;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}.switch span{display:block;height:20px;width:34px;border-radius:20px;background:#b3c0bd;transition:background-color 130ms}.switch span:after{content:"";display:block;height:18px;width:18px;border-radius:50%;background:white;transition:transform 130ms}.switch input:checked+span{background:var(--accent)}.switch input:checked+span:after{transform:translateX(14px)}.switch:has(input:focus-visible){outline:3px solid #7ec5b9;outline-offset:2px}.switch:hover span{background:#899f9a}.switch input:checked+span{background:var(--accent)}.reply-section h3{font-size:13px;margin:0 0 7px}.reply-section p{font-size:12px;margin:0;line-height:1.65;overflow-wrap:anywhere}.reply-section [data-queue-section]{margin-top:12px}.rule-summary{padding:9px 11px;margin:0 0 13px;border-left:3px solid var(--accent);background:var(--wash)}.rule-summary strong{font-size:11px;color:var(--muted);font-weight:650}.rule-summary p{margin:2px 0 0;font-size:13px;line-height:1.5;overflow-wrap:anywhere}.presets{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:-3px 0 12px}.presets span{font-size:11px;color:var(--muted);margin-right:2px}.presets button{min-height:32px;padding:4px 10px;font-size:12px}.subhead{margin:16px 0 8px}.foot small{max-width:180px}.subnav button:focus-visible{outline-offset:-3px}
.overview-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:12px 0 16px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.overview-metric{padding:11px 10px 12px 0;min-width:0}.overview-metric+.overview-metric{border-left:1px solid var(--line);padding-left:12px}.overview-metric b{display:block;font-size:22px;line-height:1.1;font-variant-numeric:tabular-nums}.overview-metric span{display:block;margin-top:4px;color:var(--muted);font-size:11px}.overview-block{padding:12px 0;border-top:1px solid var(--line)}.overview-block h3{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 6px;font-size:13px}.overview-block .text-button{flex:0 0 auto}.overview-empty{padding:7px 0;color:var(--muted);font-size:12px}.overview-item{display:grid;grid-template-columns:54px minmax(0,1fr);gap:8px;padding:7px 0;border-bottom:1px solid #dce4e1;font-size:12px}.overview-item:last-child{border-bottom:0}.overview-item time{font-variant-numeric:tabular-nums;color:var(--muted);font-size:11px}.overview-item span{overflow-wrap:anywhere}.overview-item[data-category=moderation] span{color:#8b4b25}.overview-item[data-category=error] span{color:var(--danger)}.overview-queue{font-size:12px;line-height:1.55;overflow-wrap:anywhere}.overview-queue small{display:block;color:var(--muted);font-size:11px}.overview-note{margin:11px 0 0;padding:8px 10px;background:#edf1ee;color:#475c58;font-size:11px;line-height:1.55}
.gift-totals{margin:12px 0 14px;padding:12px;background:#e6f1ed;border-left:3px solid var(--accent)}.gift-totals h3{margin:0 0 8px;font-size:13px}.gift-total-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.gift-total-grid>div{min-width:0}.gift-total-grid b{display:block;font-size:22px;line-height:1.2;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.gift-total-grid span,.gift-total-note{font-size:11px;color:var(--muted)}.gift-total-note{margin:8px 0 0;line-height:1.5}
.head{border-bottom-width:1px}.gift-totals{border-left-width:1px}
:host{color:#161616;--ink:#161616;--muted:#737373;--line:#e5e5e7;--accent:#fe2c55;--accent-strong:#d91f45;--paper:#f7f7f8;--surface:#fff;--wash:#fff0f3;--signal:#fe2c55;--warning:#fff7e6;--danger:#c6283d}
button,input,select,textarea{border-radius:8px}button:hover:not(:disabled){background:#f5f5f7;border-color:#d1d1d6}.primary{background:#fe2c55;border-color:#fe2c55}.primary:hover:not(:disabled){background:#e3234b;color:#fff}
/* Keep launcher states above generic button hover and press rules. */
button.launcher{--launcher-surface:#202023;--launcher-hover:#2b2b30;--launcher-ink:#fafafa;--launcher-muted:#b8b8c0;--launcher-edge:#ffffff24;--launcher-live:#25f4ee;display:inline-flex;align-items:center;gap:8px;height:48px;min-width:184px;padding:0 12px;border:1px solid var(--launcher-edge);border-radius:16px;background:var(--launcher-surface);color:var(--launcher-ink);box-shadow:0 4px 16px #00000026,inset 0 1px 0 #ffffff0a;font-size:13px;line-height:1;font-weight:500;white-space:nowrap;transition:transform 140ms cubic-bezier(.23,1,.32,1)}
button.launcher:hover:not(:disabled){background:var(--launcher-hover);border-color:#ffffff38;color:var(--launcher-ink)}
button.launcher:active:not(:disabled){background:var(--launcher-hover);color:var(--launcher-ink);transform:scale(.98)}
button.launcher.dragging,button.launcher.dragging:hover:not(:disabled),button.launcher.dragging:active:not(:disabled){background:var(--launcher-hover);color:var(--launcher-ink);border-color:#fe2c5580;box-shadow:0 8px 24px #00000033,0 0 0 2px #fe2c551a;cursor:grabbing;transform:none;transition:none}
button.launcher:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
.launcher .launcher-mark{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:#fe2c551c;color:#ff6b89;flex-shrink:0}.launcher-mark svg{width:18px;height:18px}.launcher b{font-weight:650;color:var(--launcher-ink)}.launcher i{width:5px;height:5px;margin-left:4px;flex-shrink:0;border-radius:50%;background:var(--launcher-muted)}.launcher.running i{background:var(--launcher-live);box-shadow:0 0 0 3px #25f4ee14}.launcher span{font-size:12px;color:var(--launcher-muted);min-width:48px;text-align:left}.launcher.running span{color:var(--launcher-ink)}.launcher .launcher-grip{width:10px;height:16px;margin-left:4px;color:#8e8e99;flex-shrink:0}
.panel{background:#f7f7f8;border-color:#d1d1d6;border-radius:12px;box-shadow:0 20px 64px #0003}.head{background:#151515;color:#fff;border-bottom:1px solid #333;padding:15px 18px}.room{color:#b8b8bd}.head button{border-color:#555;color:#f5f5f7;border-radius:7px}.head button:hover{background:#333}.banner{background:#fff7e6;border-color:#f0dfb8;color:#72551b}.nav{padding:0 10px 2px}.primary-nav{background:#f2f2f4;border-radius:9px;margin:8px 9px 4px;padding:3px;gap:3px}.primary-nav button{border-radius:7px;color:#64646a}.primary-nav button[aria-pressed=true]{background:#fff;color:#161616;box-shadow:0 1px 3px #0002}.subnav{padding:2px 8px 8px;gap:3px}.subnav button{border-radius:7px}.subnav button[aria-selected=true]{background:#fff0f3;color:#d91f45}
.scroll{scrollbar-color:#c7c7cc transparent}.page>.intro{margin:3px 0 12px}.page h2{font-size:17px;letter-spacing:0}.badge.live{background:#e7fcff;color:#007d88}.status strong{font-weight:650}.section{border-color:var(--line)}.notice{border-color:#f0bd50;background:#fff8e8;color:#72551b}.mode-note{border-color:#f0bd50;background:#fff8e8}.rule-summary{border-color:var(--accent);background:#fff0f3}.rule-summary strong{color:#777}.feature-title:hover,.text-button:hover,summary:hover{color:var(--accent)}.feature-shortcuts button[aria-pressed=true]{background:#fff0f3;color:#d91f45;border-color:#ffc6d2}.switch{background:#d1d1d6}.switch span{background:#d1d1d6}.switch input:checked+span{background:var(--accent)}.switch:hover span{background:#b8b8bd}.switch:has(input:focus-visible){outline-color:#fe2c5555}.toggle input{accent-color:var(--accent)}
.subnav[data-subnav=interaction]{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2px;padding:3px 8px 8px}.subnav[data-subnav=interaction] button{white-space:normal;line-height:1.3;min-height:34px}.settings-group{margin:0 0 14px;padding:12px;background:#fff;border:1px solid #e5e5e7;border-radius:9px}.settings-group h3{font-size:13px;margin:0 0 3px}.group-note{font-size:11px;line-height:1.5;color:var(--muted);margin:0 0 8px}.settings-group .feature-list{border-top:1px solid var(--line);margin:0}.settings-group .feature-row:last-child{border-bottom:0}.settings-group .field{margin-bottom:4px}.settings-group .mode-note{margin:4px 0 0;border-radius:5px}.settings-group+.section{margin-top:8px}
.subnav[data-subnav=interaction][hidden]{display:none}
.gift-totals{background:#fff0f3;border-color:var(--accent);border-radius:8px}.overview-note{background:#f0f0f2;color:#65656a;border-radius:7px}.overview-item,.log{border-color:#ededf0}.overview-item[data-category=moderation] span{color:#855b2a}.toast{background:#fff0f3;color:#8e1732;border-color:#ffc6d2}.toast.error{background:#fae7e8;color:#8c2336}pre{background:#f0f0f2;color:#343438}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #fe2c5555;outline-offset:2px}
@media(max-width:560px){.panel{width:calc(100vw - 20px);height:calc(100dvh - 24px)}.launcher{right:12px;bottom:12px}.grid{grid-template-columns:1fr}.head,.scroll{padding:14px 15px}.foot{padding:9px 14px}.primary-nav{padding:6px 8px 4px;gap:2px}.primary-nav button{font-size:12px;padding:4px}.subnav{padding:0 9px 6px}.stats b{font-size:19px}.stats span{font-size:10px}.row{gap:7px}.foot small{max-width:130px}.candidate{grid-template-columns:64px 1fr}.gift-activity{grid-template-columns:minmax(65px,1fr) minmax(75px,1.2fr) auto;gap:5px;font-size:11px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto;transition:none!important}}
.income-hero{padding:16px;background:var(--surface);border:1px solid var(--line);border-radius:10px;margin:4px 0 16px}.income-hero>span{font-size:12px;color:var(--muted)}.income-hero>b{display:block;font-size:32px;line-height:1.4;letter-spacing:-1px;margin:4px 0 12px;font-weight:650}.income-meta{display:flex;gap:20px;flex-wrap:wrap;font-size:12px;color:var(--muted)}.income-meta strong{color:var(--ink);font-weight:600}.income-hero b,.income-meta strong,.income-table{font-variant-numeric:tabular-nums}.income-table{width:100%;border-collapse:collapse;font-size:12px}.income-table th,.income-table td{text-align:right;padding:10px 6px;border-bottom:1px solid var(--line)}.income-table th{font-size:11px;color:var(--muted);font-weight:500}.income-table th:first-child,.income-table td:first-child{text-align:left;padding-left:0;white-space:nowrap}.income-table-wrap{overflow-x:auto}.income-error{color:var(--danger);font-size:12px}.profile-card{padding:12px 0;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:12px}.profile-card strong,.profile-card small{display:block;overflow-wrap:anywhere}.profile-card strong{font-size:13px}.profile-card small{font-size:11px;color:var(--muted);margin-top:3px}.profile-card a{color:var(--accent-strong);font-size:12px;white-space:nowrap;text-decoration:none;padding:10px 0}.profile-card a:hover{text-decoration:underline}.income-toolbar{margin:16px 0;display:flex;align-items:center;justify-content:space-between;gap:12px}.income-toolbar h3{font-size:13px;margin:0}
`;

export class Panel {
  constructor({ config, room, demo = false, callbacks }) {
    this.config = config; this.room = room; this.demo = demo; this.callbacks = callbacks; this.entries = []; this.open = true; this.activeTab = 'gift'; this.activeCategory = 'interaction'; this.dirty = false; this.rowSerial = 0; this.logDirty = false; this.viewers = [];
    this.busyActions = new Set(); this.host = document.createElement('div'); this.host.id = 'douyin-live-assistant'; this.host.style.cssText = 'position:fixed;z-index:2147483000;inset:0;pointer-events:none';
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = `${CSS_TEXT}.panel,.launcher{pointer-events:auto}`; this.root.append(style);
    this.root.append(this.build()); document.body.append(this.host); this.cache = new Map(); this.populate(config); this.bind(); this.restoreLauncherPosition(); this.positionPanel();
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
    const tabGroups = { interaction: [['gift', '礼物感谢'], ['welcome', '进场欢迎'], ['likes', '点赞感谢'], ['keywords', '关键词回复'], ['bot','@机器人'], ['timers', '定时消息'], ['income','收入统计']], settings: [['features', '功能开关'], ['ai', 'AI 设置'], ['runtime', '运行规则'], ['profiles','主播管理'], ['diagnostics', '连接诊断']] };
    container.innerHTML = `
      <button type="button" class="launcher" aria-expanded="true" aria-label="收起场控面板，当前已暂停" title="点击收起 · 拖动调整位置"><div class="launcher-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="13" rx="4"/><path d="M9 21h6M12 18v3M8 10v3m4-5v7m4-5v3"/></svg></div><b>场控</b><i aria-hidden="true"></i><span>已暂停</span><svg class="launcher-grip" aria-hidden="true" viewBox="0 0 10 16" fill="currentColor"><circle cx="3" cy="4" r="1"/><circle cx="7" cy="4" r="1"/><circle cx="3" cy="8" r="1"/><circle cx="7" cy="8" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="7" cy="12" r="1"/></svg></button>
      <section class="panel" aria-label="抖音直播运营助手控制台">
        <header class="head"><div><h1>抖音直播运营助手</h1><div class="room">${this.demo ? '模拟直播间' : `直播间 ${esc(this.room)}`}</div></div><button data-action="close" aria-label="收起面板">收起</button></header>
        ${this.demo ? '<p class="banner">本地演示：弹幕和礼物均为模拟数据，消息不会发到抖音。</p>' : ''}
        <nav class="nav" aria-label="功能导航"><div class="primary-nav" role="group" aria-label="功能分类">${[['interaction','直播互动'],['settings','设置']].map(([key,label])=>`<button type="button" data-category="${key}" aria-pressed="${key==='interaction'}">${label}</button>`).join('')}</div>${Object.entries(tabGroups).map(([category,group])=>`<div class="subnav" data-subnav="${category}" role="tablist" aria-label="${{interaction:'直播互动功能',settings:'功能与运行设置'}[category]}" ${category!=='interaction'?'hidden':''}>${group.map(([key,name])=>`<button type="button" role="tab" id="tab-${key}" aria-controls="page-${key}" data-tab="${key}" aria-selected="${key==='gift'}" tabindex="${key==='gift'?0:-1}">${name}</button>`).join('')}</div>`).join('')}</nav>
        <div class="toast" role="status" hidden></div>
        <div class="scroll"><form autocomplete="off">
          <section class="page" id="page-overview" data-page="overview" aria-label="暂存总览" hidden>
            <h2>直播总览</h2><p class="intro">查看房间连接、场控记录和近期提醒。</p>
            <div class="status"><strong data-overview-state>已暂停</strong><span class="badge" data-network>等待直播数据</span></div>
            <div class="overview-metrics" aria-label="本场运行概况"><div class="overview-metric"><b data-overview-stat="events">0</b><span>已处理事件</span></div><div class="overview-metric"><b data-overview-stat="submitted">0</b><span>已提交</span></div><div class="overview-metric"><b data-overview-stat="alerts">0</b><span>近期提醒</span></div></div>
            <section class="overview-block"><h3>管理员提醒 <button type="button" class="text-button" data-go="diagnostics">查看运行记录</button></h3><div data-overview-alerts><div class="overview-empty">启动后，内容提醒与连接异常会显示在这里。</div></div></section>
            <section class="overview-block"><h3>最近回复 <button type="button" class="text-button" data-go="replies">查看记录</button></h3><p data-overview-reply class="overview-empty">暂无回复记录。</p></section>
            <p class="overview-note">提醒用于辅助管理员核查；无法确认的账号身份或权限会保持未知。</p>
          </section>
          <section class="page" role="tabpanel" id="page-runtime" aria-labelledby="tab-runtime" data-page="runtime" hidden>
            <h2>运行规则</h2><p class="intro">符合规则的消息按优先级及时发送。</p>
            <div class="status"><strong data-state>已暂停</strong></div>
            <section class="settings-group"><h3>互动发送</h3><p class="group-note">所有已接受的互动按优先级连续处理；发送控件就绪后立即提交，无需逐条审核。</p><div class="grid">${this.select('mode', '回复方式', [['auto', '自动发送'], ['preview', '仅预览，不发送']])}</div><label class="toggle"><input type="checkbox" data-field="automation.autoStart">进入此主播直播间后自动开始场控</label><p class="hint">仅当前主播生效；连接未就绪时等待恢复。手动暂停后本次页面不会自动重启。</p><div class="mode-note" data-mode-note>符合规则的回复会自动发送。</div></section>
          </section>
          <section class="page" role="tabpanel" id="page-features" aria-labelledby="tab-features" data-page="features" hidden>
            <h2>功能开关</h2><p class="intro">集中启用或停用直播互动模块；关闭后，该模块从互动导航中隐藏。</p>
            <section class="settings-group"><h3>礼物与进场</h3><p class="group-note">按观众送礼和进入直播间事件触发。</p><div class="feature-list">${[['gift','礼物感谢'],['welcome','进场欢迎']].map(([key,label]) => `<div class="feature-row"><div class="feature-title">${label}<small data-feature-note="${key}"></small></div><label class="switch" aria-label="${label}"><input type="checkbox" role="switch" data-field="${key}.enabled" aria-label="${label}"><span></span></label></div>`).join('')}</div></section>
            <section class="settings-group"><h3>弹幕与反馈</h3><p class="group-note">按点赞、弹幕内容或提醒条件触发。</p><div class="feature-list">${[['like','点赞感谢'],['keyword','关键词回复']].map(([key,label]) => `<div class="feature-row"><div class="feature-title">${label}<small data-feature-note="${key}"></small></div><label class="switch" aria-label="${label}"><input type="checkbox" role="switch" data-field="${key}.enabled" aria-label="${label}"><span></span></label></div>`).join('')}<div class="feature-row"><div class="feature-title">内容提醒<small data-feature-note="moderation"></small></div><label class="switch" aria-label="内容提醒"><input type="checkbox" role="switch" data-field="moderation.enabled" aria-label="内容提醒"><span></span></label></div></div></section>
            <section class="settings-group"><h3>@ 机器人</h3><p class="group-note">观众 @ 当前登录账号，呼出菜单或参加互动小游戏，无需 AI。</p><div class="feature-list"><div class="feature-row"><div class="feature-title">机器人互动<small data-feature-note="bot"></small></div><label class="switch" aria-label="机器人互动"><input type="checkbox" role="switch" data-field="bot.enabled" aria-label="机器人互动"><span></span></label></div></div></section>
            <section class="settings-group"><h3>计划互动</h3><p class="group-note">按已配置的时间间隔循环发送。</p><div class="feature-list"><div class="feature-row"><div class="feature-title">定时消息<small data-feature-note="timers"></small></div><label class="switch" aria-label="定时消息"><input type="checkbox" role="switch" data-field="timersEnabled" aria-label="定时消息"><span></span></label></div></div></section>
            <section class="settings-group"><h3>礼物账本</h3><p class="group-note">独立于礼物感谢，按主播与北京时间保存统计。</p><div class="feature-list"><div class="feature-row"><div class="feature-title">收入统计<small>本地保存每日礼物价值与月度收入估算；关闭后停止采集，历史数据仍保留。</small></div><label class="switch" aria-label="收入统计"><input type="checkbox" role="switch" data-field="incomeEnabled" aria-label="收入统计"><span></span></label></div></div></section>
            <section class="settings-group"><h3>AI 互动</h3><p class="group-note">先启用 AI 服务，再单独决定要使用的 AI 功能。</p><div class="feature-list"><div class="feature-row"><div class="feature-title">AI 服务<small data-feature-note="ai-service"></small></div><label class="switch" aria-label="AI 服务"><input type="checkbox" role="switch" data-field="ai.enabled" aria-label="AI 服务"><span></span></label></div><div class="feature-row"><div class="feature-title">AI 弹幕问答<small data-feature-note="ai-chat"></small></div><label class="switch" aria-label="AI 弹幕问答"><input type="checkbox" role="switch" data-field="ai.chatEnabled" aria-label="AI 弹幕问答"><span></span></label></div><div class="feature-row"><div class="feature-title">AI 冷场互动<small data-feature-note="ai-idle"></small></div><label class="switch" aria-label="AI 冷场互动"><input type="checkbox" role="switch" data-field="ai.idleEnabled" aria-label="AI 冷场互动"><span></span></label></div></div><button type="button" class="text-button" data-go="ai">配置 AI 服务与问答</button></section>
          </section>
          <section class="page" id="page-replies" data-page="replies" aria-label="回复记录（暂未开放）" hidden>
            <h2>回复记录</h2><p class="intro">查看最近预览和已提交的回复。</p>
            <section class="reply-section"><h3 data-reply-title>最近回复</h3><p data-last-reply class="empty">开始后，符合规则的回复会显示在这里。</p></section>
          </section>
          <section class="page" role="tabpanel" id="page-gift" aria-labelledby="tab-gift" data-page="gift" hidden>
            <h2>礼物感谢</h2><p class="intro">设置感谢门槛与话术；礼物连击会合并计算。</p>
            <section class="gift-totals" data-gift-totals aria-label="礼物价值统计"><h3 data-gift-total-title>今日礼物价值</h3><div class="gift-total-grid"><div><b data-gift-diamonds>0</b><span>已知礼物面值 · 钻</span></div><div><b data-gift-income>未设置</b><span>收入估算 · 人民币</span></div></div><p class="gift-total-note" data-gift-estimate-note>正在读取本地账本…</p><button type="button" class="text-button" data-go="income" data-income-link>查看月度账本</button></section>
            <section class="recent-gifts section"><div class="log-head"><h3>近期送礼</h3><span class="choice-hint" data-gift-count>仅保留本次页面数据</span></div><div data-recent-gifts><p class="empty">收到礼物后，送礼用户和已知礼物信息会显示在这里。</p></div></section>
            <div class="rule-summary"><strong>当前规则</strong><p data-summary="gift"></p></div>
            ${this.select('gift.responseMode', '答谢生成方式', [['rules', '使用预设话术'], ['ai', '使用 AI 生成']])}
            ${this.input('gift.minValue', '达到多少钻石才感谢', 'number')}
            ${this.input('gift.yuanPerDiamond', '收入估算比例 / 元每钻', 'number')}
            <p class="hint">默认按 100 钻约 10 元、主播分成约一半估算（0.05 元/钻）；请按主播结算情况调整。</p>
            <div class="presets" aria-label="常用礼物阈值"><span>快速设为</span>${[[50,'50'],[100,'100'],[500,'500'],[1000,'1000']].map(([value,label])=>`<button type="button" data-gift-value="${value}">${label} 钻</button>`).join('')}</div>
            <details><summary>筛选与防刷屏</summary>${this.select('gift.basis', '按什么计算价值', [['total', '整次连击的总价值（推荐）'], ['unit', '单个礼物的价值']])}<div class="grid">${this.input('gift.cooldownSec', '同一人感谢间隔 / 秒', 'number')}${this.input('gift.mergeSec', '连击等待 / 秒', 'number')}</div></details>
            ${this.area('gift.templates', '感谢话术（每行一条，轮流使用）', 'lines', '变量：{user} 昵称、{gift} 礼物名、{count} 数量、{value} 总钻石、{unit} 单价。')}
            <div class="notice">收入估算仅按已知钻石面值和你填写的比例计算，不代表平台结算或到账金额。单价未知的礼物不会计入面值，会单独统计。</div>
            <details><summary>补充未知礼物的单价</summary><div data-list="prices"></div><button type="button" class="list-add" data-add="prices">添加礼物单价</button><p class="hint">填礼物名称或 ID，仅在直播消息缺少单价时使用。</p></details>
          </section>
          <section class="page" role="tabpanel" id="page-income" aria-labelledby="tab-income" data-page="income" hidden>
            <h2>收入统计</h2><p class="intro">按主播独立保存，刷新或重开浏览器后继续累计。</p>
            <div class="grid"><label class="field"><span>主播</span><select data-income-room><option value="${esc(this.room)}">当前直播间 ${esc(this.room)}</option></select></label><label class="field"><span>统计月份 · 北京时间</span><input type="month" data-income-month value="${giftDate().slice(0,7)}"></label></div>
            <p class="income-error" data-income-error role="status" hidden></p>
            <section class="income-hero" aria-label="月度礼物收入"><span data-income-period>所选月份收入估算</span><b data-income-total>¥0.00</b><div class="income-meta"><span>礼物面值 <strong data-income-diamonds>0 钻</strong></span><span>礼物数量 <strong data-income-count>0</strong></span><span>记录天数 <strong data-income-days>0</strong></span></div></section>
            <div class="income-toolbar"><h3>每日明细</h3><button type="button" data-action="export-income" disabled>导出当月</button></div><div data-income-daily><p class="empty">正在读取本地账本…</p></div>
            <p class="hint" data-income-coverage></p><p class="hint">只统计工具在线时实际采集的礼物，无法补回未采集时段。每笔按采集时保存的元/钻比例估算；修改比例仅影响后续礼物。未知单价不计入金额。数据保存在当前浏览器，卸载扩展或清除其数据会移除账本。</p>
          </section>
          <section class="page" role="tabpanel" id="page-profiles" aria-labelledby="tab-profiles" data-page="profiles" hidden>
            <h2>主播管理</h2><p class="intro">每位主播的互动规则、功能开关、AI 配置与收入比例独立保存。进入直播间自动载入对应配置。</p>
            <section class="settings-group"><h3>已添加的主播</h3><div data-profiles><p class="empty">正在读取主播列表…</p></div></section>
            <section class="settings-group"><h3>添加主播</h3><p class="group-note">粘贴抖音直播间地址，打开该直播间即可配置。</p><label class="field"><span>直播间地址</span><input type="url" data-profile-url placeholder="https://live.douyin.com/直播间号"></label><button type="button" data-action="add-profile">添加主播</button></section>
            <p class="hint">“打开并配置”会进入对应主播的直播间，不会自动开始场控。AI 服务密钥按接口域名保存，同一服务可共用密钥。</p>
          </section>
          <section class="page" role="tabpanel" id="page-welcome" aria-labelledby="tab-welcome" data-page="welcome" hidden>
            <h2>进场欢迎</h2><p class="intro">按荣誉等级、本房粉丝团或指定名单欢迎观众。</p>
            <div class="rule-summary"><strong>当前规则</strong><p data-summary="welcome"></p></div>
            ${this.select('welcome.responseMode', '欢迎生成方式', [['rules', '使用预设话术'], ['ai', '使用 AI 生成']])}
            ${this.select('welcome.mode', '欢迎范围', [['qualified-or-listed', '达标用户 + 指定名单'], ['qualified', '只欢迎达标用户'], ['listed', '只欢迎指定名单']])}
            <div data-qualified><div class="grid">${this.input('welcome.minWealth', '最低荣誉等级', 'number')}${this.input('welcome.minFanLevel', '最低粉丝团等级', 'number')}</div>
            ${this.toggle('welcome.requireFan', '必须加入本直播间粉丝团')}${this.toggle('welcome.requireLit', '粉丝牌必须已点亮')}</div>
            <details><summary>防止重复欢迎</summary>${this.input('welcome.cooldownSec', '同一人欢迎间隔 / 秒', 'number')}</details>
            <details data-welcome-list><summary>指定欢迎的人</summary><div class="inline"><select data-viewer-picker aria-label="最近观众"><option value="">等待观众出现…</option></select><button type="button" data-action="add-viewer">加入欢迎名单</button></div><p class="hint">优先按账号识别；仅有昵称的备用弹幕可能重名。</p><div data-list="listed"></div><button type="button" class="list-add" data-add="listed">手动添加用户</button></details>
            ${this.area('welcome.templates', '欢迎话术（每行一条）', 'lines', '变量：{user}、{level} 荣誉等级、{fanLevel} 粉丝团等级。')}
            <div class="notice">无法核实主播 UID、粉丝团或等级时，条件筛选不会通过。指定名单仍可按明确身份匹配。</div>
          </section>
          <section class="page" role="tabpanel" id="page-likes" aria-labelledby="tab-likes" data-page="likes" hidden>
            <h2>点赞感谢</h2><p class="intro">按点赞事件感谢观众；同一人冷却期间的连续点赞会合并忽略。</p>
            <div class="rule-summary"><strong>当前规则</strong><p data-summary="like"></p></div>
            ${this.select('like.responseMode', '感谢生成方式', [['rules', '使用预设话术'], ['ai', '使用 AI 生成']])}
            ${this.input('like.cooldownSec', '同一人感谢间隔 / 秒', 'number')}
            ${this.area('like.templates', '感谢话术（每行一条，轮流使用）', 'lines', '变量：{user} 昵称、{count} 本次点赞数。')}
            <div class="notice">点赞感谢也遵守全局发送节奏和当前回复方式。</div>
          </section>
          <section class="page" role="tabpanel" id="page-keywords" aria-labelledby="tab-keywords" data-page="keywords" hidden>
            <h2>关键词回复</h2><p class="intro">固定话术优先于 AI；每条弹幕最多命中一条规则。</p>
            <div class="rule-summary"><strong>当前规则</strong><p data-summary="keyword"></p></div>
            ${this.select('keyword.responseMode', '命中后回复方式', [['rules', '使用规则话术'], ['ai', '使用 AI 生成']])}
            <div data-list="keywords"></div><button type="button" class="list-add" data-add="keywords">添加关键词回复</button>
            <p class="hint">按列表顺序匹配；可用“上移 / 下移”调整优先级。每条规则支持包含关键词或完全一致。</p>
            ${this.input('keyword.cooldownSec', '同一用户回复间隔 / 秒', 'number')}
          </section>
          <section class="page" role="tabpanel" id="page-ai" aria-labelledby="tab-ai" data-page="ai" hidden>
            <h2>AI 服务与问答</h2><p class="intro">连接模型服务，并配置 AI 如何回应直播间弹幕。</p>
            <div class="rule-summary"><strong>当前规则</strong><p data-summary="ai"></p></div>
            <label class="field"><span>服务预设</span><select data-preset><option value="custom">自定义兼容接口</option><option value="deepseek">DeepSeek</option><option value="qwen">通义千问 / DashScope</option><option value="doubao">豆包 / 火山方舟</option><option value="local">本地 Ollama</option></select></label>
            <details data-ai-connection><summary>接口与模型</summary>${this.input('ai.endpoint', 'API 接口地址')}${this.input('ai.model', '模型名称 / 接入点 ID')}</details>
            <label class="field"><span>API Key</span><input type="password" data-api-key autocomplete="new-password" placeholder="留空保留此服务已有密钥"><small data-key-status>密钥按服务域名隔离，不随配置导出。</small></label>
            <label class="toggle"><input type="checkbox" data-remember-key>记住新密钥（仅此设备）</label>
            <div class="actions"><button type="button" data-action="test-ai">测试 AI 连接</button><button type="button" class="danger" data-action="forget-key">清除此服务密钥</button></div>
            <div class="section"><div data-chat-controls>${this.select('ai.trigger', '自动回复触发条件', [['question', '提问弹幕'], ['mention', '呼叫场控'], ['all', '所有弹幕（受调用限额约束）']])}<details><summary>AI 频率与上下文</summary><div class="grid">${this.input('ai.intervalSec', '两次 AI 调用间隔 / 秒', 'number')}${this.input('ai.userCooldownSec', '同一用户 AI 冷却 / 秒', 'number')}${this.input('ai.maxPerHour', '每小时最多调用 / 次', 'number')}${this.input('ai.contextSize', '最近弹幕条数', 'number')}${this.input('ai.contextAgeSec', '弹幕保留时长 / 秒', 'number')}</div></details>
            <div data-ai-mentions>${this.area('ai.mentions', '场控呼叫词（每行一个）')}</div></div><div data-ai-profile>${this.area('ai.persona', '场控风格', 'text')}${this.area('ai.knowledge', '主播与本场直播资料', 'text', '填写已核实的直播主题、开播时间和资料。')}</div>
            <details data-idle-controls><summary>冷场互动</summary>${this.input('ai.idleSec', '没有新互动多久算冷场 / 秒', 'number')}</details>
            <div class="notice">启用 AI 的模块才会显示 AI 生成选项。最近弹幕、昵称和你填写的资料会发往所配置的服务，不发送 Cookies 或观众 UID。预览模式仍会调用 AI。</div></div>
          </section>
          <section class="page" role="tabpanel" id="page-bot" aria-labelledby="tab-bot" data-page="bot" hidden>
            <h2>@机器人</h2><p class="intro">观众 @ 你的当前登录账号，即可呼出文字菜单并互动。</p>
            <div class="rule-summary"><strong>试着这样说</strong><p data-bot-address>@当前昵称 菜单</p></div>
            <p class="hint" data-bot-identity></p>
            <p class="hint" data-bot-session>当前没有进行中的游戏。</p>
            <section class="settings-group"><h3>互动菜单</h3><p class="group-note">菜单只列出开启的玩法。每次回复一条弹幕；菜单较长时用「菜单 2」翻页。</p><div class="feature-list">${BOT_COMMANDS.map(item => `<div class="feature-row"><div class="feature-title">${item.label}<small>@当前昵称 ${item.example}</small></div><label class="switch" aria-label="${item.label}"><input type="checkbox" role="switch" data-field="bot.${item.key}" aria-label="${item.label}"><span></span></label></div>`).join('')}</div></section>
            <div class="rule-summary"><strong>观众看到的菜单 · 第 1 页</strong><p data-bot-menu></p></div>
            <p class="hint">成语接龙使用本地小词库，按同字衔接；全直播间共用一局，5 分钟无人接龙后从「一心一意」重新开始。</p>
            ${this.input('bot.cooldownSec', '同一观众互动间隔 / 秒', 'number')}
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
            <pre data-diagnostics>点击“检查连接与发送控件”查看结果。</pre>
            <p class="hint" data-delivery-health role="status">发送队列为空。</p>
            <h3 class="subhead">账号身份</h3>
            <details data-manual-identity><summary>主播与账号识别</summary>${this.toggle('identity.autoAnchor', '自动识别主播')}${this.input('anchorId', '主播 UID（自动识别不到时填写）')}${this.toggle('identity.autoSelf', '自动识别登录账号')}${this.input('selfId', '登录账号 UID（自动识别不到时填写）')}</details>
            <h3 class="subhead">互动过滤</h3>
            ${this.area('ignored', '忽略用户（每行一位）', 'lines', '支持 uid:、sec:、name: 前缀。')}${this.area('blockedWords', '禁止发送的词（每行一个）')}
            <details class="section" data-moderation-settings><summary>辱骂与恶意弹幕提醒</summary>${this.area('moderation.terms', '识别词（每行一个）', 'lines', '本地匹配，不把原始弹幕发给第三方；请按直播间语境调整。')}${this.input('moderation.threshold', '达到多少次提醒管理员', 'number')}${this.input('moderation.windowSec', '统计时长 / 秒', 'number')}<p class="hint">房间响应提供管理员 UID 名单时才确认身份。当前封禁操作未经验证，所以只提醒和计数，不会自动封禁。</p></details>
            <details><summary>高级页面适配与去重</summary><div class="grid">${this.input('adapter.inputSelector', '公屏输入框选择器')}${this.input('adapter.sendSelector', '公屏发送按钮选择器')}${this.input('sending.duplicateSec', '重复话术冷却 / 秒', 'number')}</div></details>
            <details class="section"><summary>弹幕备用采集设置</summary><p class="hint">只采集新弹幕，不从页面文字推测等级或金额。修改这些选择器后需刷新。</p>${this.input('adapter.chatSelector', '弹幕行选择器')}${this.input('adapter.nicknameSelector', '行内昵称选择器')}${this.input('adapter.contentSelector', '行内内容选择器')}${this.input('adapter.endSelector', '下播提示选择器（可选）')}</details>
            <details class="section" data-log-details><summary>运行记录</summary><div class="stats">${[['events', '接收事件'], ['filtered', '已过滤'], ['previews', '已预览'], ['submitted', '已提交']].map(([key, name]) => `<div><b data-stat="${key}">0</b><span>${name}</span></div>`).join('')}</div><div class="log-head"><select data-log-filter aria-label="筛选运行记录"><option value="all">全部记录</option>${Object.entries(categories).map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></div><div class="logs" data-logs aria-label="运行记录"></div></details>
            <div class="section"><h3>配置与运行记录</h3><div class="actions"><button type="button" data-action="lab">运行规则自检</button><button type="button" data-action="export">导出配置</button><button type="button" data-action="import">导入配置</button><button type="button" data-action="export-log">导出运行记录</button><button type="button" data-action="clear-log">清空记录</button></div><input class="file" data-import-file type="file" accept="application/json,.json"><p class="hint">每个直播间单独保存设置。导出配置不包含密钥；导出的运行记录可能包含公屏昵称和回复。</p></div>
          </section>
        </form></div>
        <footer class="foot"><small data-save-state>设置已保存</small><div class="actions"><button data-action="save" hidden>保存设置</button><button class="primary" type="button" data-action="start">开始场控</button><button class="danger" type="button" data-action="stop" hidden>立即暂停</button></div></footer>
      </section>`;
    return container;
  }
  node(selector) { if (!this.cache.has(selector)) this.cache.set(selector, this.root.querySelector(selector)); return this.cache.get(selector); }
  restoreLauncherPosition() {
    let saved;
    try { saved = JSON.parse(window.localStorage.getItem('douyin-live-assistant:launcher') || 'null'); } catch {}
    const rect = this.node('.launcher').getBoundingClientRect();
    const width = rect.width || 150, height = rect.height || 42;
    const left = Number.isFinite(saved?.left) ? saved.left : window.innerWidth - width - 24;
    const top = Number.isFinite(saved?.top) ? saved.top : window.innerHeight - height - 24;
    this.applyLauncherPosition(left, top, false);
    this.onResize = () => { this.applyLauncherPosition(this.launcherPosition.left, this.launcherPosition.top, true); this.positionPanel(); };
    window.addEventListener('resize', this.onResize);
  }
  applyLauncherPosition(left, top, persist = false) {
    const button = this.node('.launcher'), rect = button.getBoundingClientRect();
    const width = rect.width || 150, height = rect.height || 42;
    const margin = window.innerWidth <= 560 ? 8 : 12;
    const x = Math.max(margin, Math.min(Number(left) || 0, window.innerWidth - width - margin));
    const y = Math.max(margin, Math.min(Number(top) || 0, window.innerHeight - height - margin));
    button.style.left = `${x}px`; button.style.top = `${y}px`; button.style.right = 'auto'; button.style.bottom = 'auto';
    this.launcherPosition = { left: x, top: y };
    if (persist) { try { window.localStorage.setItem('douyin-live-assistant:launcher', JSON.stringify(this.launcherPosition)); } catch {} }
  }
  positionPanel() {
    if (!this.open) return;
    const panel = this.node('.panel'), button = this.node('.launcher');
    if (panel.hidden) return;
    const buttonRect = button.getBoundingClientRect(), panelRect = panel.getBoundingClientRect();
    const width = panelRect.width || Math.min(560, window.innerWidth - 32), height = panelRect.height || Math.min(780, window.innerHeight - 24);
    const left = Math.max(10, Math.min(buttonRect.left + buttonRect.width / 2 - width / 2, window.innerWidth - width - 10));
    const above = buttonRect.top - height - 12;
    const top = above >= 10 ? above : Math.max(10, Math.min(buttonRect.bottom + 12, window.innerHeight - height - 10));
    panel.style.left = `${left}px`; panel.style.top = `${top}px`; panel.style.right = 'auto'; panel.style.bottom = 'auto';
  }
  text(selector, value) { const node = this.node(selector); if (node.textContent !== String(value)) node.textContent = String(value); }
  disabled(selector, value) { const node = this.node(selector); if (node.disabled !== value) node.disabled = value; }
  markDirty(value = true) { this.dirty = value; this.syncFooter(); }
  hidden(selector, value) { const node = this.node(selector); if (node.hidden !== value) node.hidden = value; }
  syncFooter() {
    const running = Boolean(this.latest?.[0].running);
    const busy = ['start','save','test-ai'].some(action => this.busyActions.has(action));
    this.text('[data-save-state]', this.busyActions.has('save') ? '正在保存…' : this.busyActions.has('start') ? '正在开始…' : this.dirty ? (running ? '未保存，保存后暂停' : '未保存，开始时保存') : '设置已保存');
    this.node('[data-save-state]').classList.toggle('dirty', this.dirty);
    this.hidden('[data-action=save]', !this.dirty);
    this.text('[data-action=save]', running ? '保存并暂停' : '保存设置');
    this.hidden('[data-action=start]', running); this.hidden('[data-action=stop]', !running);
    this.text('[data-action=start]', this.dirty ? '保存并开始' : '开始场控');
    this.disabled('[data-action=start]', running || busy); this.disabled('[data-action=save]', busy);
    this.disabled('[data-action=stop]', !running);
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
    for (const action of ['identify','test-ai','diagnose']) this.disabled(`[data-action="${action}"]`, this.busyActions.has(action) || (action === 'test-ai' && ['save','start'].some(a=>this.busyActions.has(a))));
    const get = path => this.root.querySelector(`[data-field="${path}"]`);
    const welcomeMode = get('welcome.mode').value;
    this.hidden('[data-qualified]', welcomeMode === 'listed');
    if (welcomeMode === 'listed' && this.welcomeMode !== welcomeMode) this.node('[data-welcome-list]').open = true;
    this.welcomeMode = welcomeMode;
    const listedCount = this.root.querySelectorAll('[data-list="listed"] [data-list-row="listed"]').length;
    const fanRule = get('welcome.requireFan').checked ? `本房粉丝团 ≥ ${get('welcome.minFanLevel').value} 级${get('welcome.requireLit').checked ? '且已点亮' : ''}` : '不限制粉丝团';
    const welcomeRule = welcomeMode === 'listed' ? `仅欢迎指定名单（${listedCount} 人）` : `荣誉 ≥ ${get('welcome.minWealth').value} 级 · ${fanRule}${welcomeMode === 'qualified-or-listed' ? ` · 或名单 ${listedCount} 人` : ''}`;
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
    this.text('[data-summary=gift]', !get('gift.enabled').checked ? '已关闭，不会生成礼物感谢。' : `${get('gift.basis').value === 'total' ? '连击总价' : '单个礼物'} ≥ ${get('gift.minValue').value || 0} 钻 · ${strategy(get('gift.responseMode').value)} · 同一人冷却 ${get('gift.cooldownSec').value} 秒。`);
    this.text('[data-summary=welcome]', !get('welcome.enabled').checked ? '已关闭，不会生成进场欢迎。' : `${welcomeRule} · ${strategy(get('welcome.responseMode').value)}`);
    this.text('[data-feature-note=gift]', !get('gift.enabled').checked ? '已关闭' : `门槛 ≥ ${get('gift.minValue').value || 0} 钻`);
    this.text('[data-feature-note=welcome]', !get('welcome.enabled').checked ? '已关闭' : welcomeMode === 'listed' ? `指定名单 ${listedCount} 人` : `荣誉 ≥ ${get('welcome.minWealth').value} 级${get('welcome.requireFan').checked ? ' · 粉丝团条件已启用' : ''}`);
    this.text('[data-feature-note=like]', !get('like.enabled').checked ? '已关闭' : `${strategy(get('like.responseMode').value)} · 同一人 ${get('like.cooldownSec').value} 秒冷却`);
    this.text('[data-summary=like]', !get('like.enabled').checked ? '已关闭，不会生成点赞感谢。' : `${strategy(get('like.responseMode').value)} · 同一人感谢间隔 ${get('like.cooldownSec').value} 秒。`);
    const keywordCount = this.root.querySelectorAll('[data-list="keywords"] [data-list-row="keywords"]').length;
    this.text('[data-feature-note=keyword]', !get('keyword.enabled').checked ? '已关闭' : `启用 ${keywordCount} 条规则`);
    this.text('[data-feature-note=bot]', get('bot.enabled').checked ? '@当前账号呼出菜单 · 本地即时处理' : '已关闭');
    const botConfig = Object.fromEntries(BOT_COMMANDS.map(item => [item.key, get(`bot.${item.key}`).checked]));
    this.text('[data-bot-menu]', new RoomBot().menu(botConfig, this.config.sending.maxLength || 50));
    const botSelf = this.identity?.self, configuredSelf = get('selfId').value;
    const selfMatches = botSelf && (!configuredSelf || String(botSelf.id) === configuredSelf);
    this.text('[data-bot-address]', `@${selfMatches && botSelf.name ? botSelf.name : '当前昵称'} 菜单`);
    this.text('[data-bot-identity]', selfMatches ? `当前响应账号：${botSelf.name || botSelf.id}。请使用完整 @，并在昵称后留一个空格。` : configuredSelf ? '已配置登录账号 UID；可通过平台的 @ 账号选择器准确呼叫。' : '请先登录并在“连接诊断”识别当前账号，识别后才会响应 @。');
    this.text('[data-bot-session]', this.latest?.[0]?.bot?.sessionSummary?.() || '当前没有进行中的游戏。');
    this.text('[data-bot-ai]', aiReady && get('ai.chatEnabled').checked ? '普通提问交给 AI 问答；AI 忙碌或失败时会提示使用本地菜单。小游戏不调用 AI。' : '小游戏无需 AI；如需回答普通提问，请在功能开关启用 AI 服务与 AI 弹幕问答。');
    this.text('[data-summary=keyword]', !get('keyword.enabled').checked ? '已关闭，不会回复关键词弹幕。' : `${keywordCount} 条规则 · 按顺序命中首条 · ${strategy(get('keyword.responseMode').value)} · 同一用户冷却 ${get('keyword.cooldownSec').value} 秒。`);
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
  updateViewers(viewers) {
    this.viewers = viewers; const picker = this.node('[data-viewer-picker]'), value = picker.value;
    const signature = viewers.map(u=>`${u.key}:${u.name}:${u.wealthLevel}:${u.fanLevel}:${u.fanStatus}`).join('|'); if (signature === this.viewerSignature) return; this.viewerSignature = signature;
    picker.innerHTML = '<option value="">选择最近出现的观众</option>' + viewers.map(u=>`<option value="${esc(u.key)}">${esc(u.name)}${u.wealthLevel == null ? '' : ` · 荣誉${u.wealthLevel}级`}${u.fanLevel == null ? '' : ` · 粉丝团${u.fanLevel}级${u.fanStatus === 1 ? '已点亮' : ''}`}${u.id || u.secUid ? '' : '（按昵称）'}</option>`).join('');
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
  updateIncome(report) {
    if (!report?.summary || !Array.isArray(report.days)) return;
    this.hidden('[data-income-error]', true);
    const summary = report.summary, number = value => new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(value);
    this.text('[data-income-period]',`${report.month} 收入估算`);
    this.text('[data-income-total]',money(summary.estimatedIncome));
    this.text('[data-income-diamonds]',`${number(summary.totalDiamonds)} 钻`);
    this.text('[data-income-count]',number(summary.giftCount));
    this.text('[data-income-days]',String(report.days.length));
    this.text('[data-income-coverage]',summary.unknownCount ? `另有 ${number(summary.unknownCount)} 个礼物单价未知，未计入面值与收入。` : '金额仅包含已识别单价的礼物，不代表平台结算或实际到账。');
    const box = this.node('[data-income-daily]');
    const signature = JSON.stringify(report);
    if (signature !== this.incomeSignature) {
      this.incomeSignature = signature;
      box.innerHTML = report.days.length ? `<div class="income-table-wrap"><table class="income-table"><thead><tr><th scope="col">日期</th><th scope="col">礼物数</th><th scope="col">面值 / 钻</th><th scope="col">收入估算</th></tr></thead><tbody>${report.days.map(day=>`<tr><td>${esc(day.date)}</td><td>${number(day.giftCount)}${day.unknownCount ? ` <span title="单价未知">(未知 ${number(day.unknownCount)})</span>` : ''}</td><td>${number(day.totalDiamonds)}</td><td>${money(day.estimatedIncome)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">这个月份还没有采集到礼物。进入对应直播间后，会自动记录收到的礼物。</p>';
    }
    this.node('[data-action="export-income"]').disabled = false;
  }
  updateGiftSummary(summary, yuanPerDiamond = 0, persisted = false) {
    const diamonds = Math.max(0, Number(summary?.totalDiamonds) || 0);
    const unknownCount = Math.max(0, Number(summary?.unknownCount) || 0);
    const count = Math.max(0, Number(summary?.giftCount) || 0);
    const rate = Math.max(0, Number(yuanPerDiamond) || 0);
    this.text('[data-gift-diamonds]', new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(diamonds));
    this.text('[data-gift-total-title]', persisted ? '今日礼物价值' : '本页礼物价值');
    this.text('[data-gift-income]', persisted ? money(summary.estimatedIncome) : rate > 0
      ? new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 }).format(diamonds * rate)
      : '未设置');
    const coverage = unknownCount ? `另有 ${unknownCount} 个礼物单价未知，未计入面值。` : count ? '所有已采集礼物均有可识别单价。' : '等待礼物事件。';
    const estimate = rate > 0 ? `按 ${rate} 元/钻估算；此数不代表平台结算或到账金额。` : '填写结算单对应的元/钻比例后显示估算收入。';
    this.text('[data-gift-estimate-note]', persisted ? `今日已记录 ${count} 个礼物，已保存到本地账本。按收到礼物时的比例估算。${coverage}` : `本页采集 ${count} 个礼物。${estimate} ${coverage}`);
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
  toggleOpen() { this.open = !this.open; this.node('.panel').hidden = !this.open; this.syncLauncher(); if (this.open) { if (this.latest) this.refresh(...this.latest); this.renderLogs(); this.positionPanel(); } }
  applyFeatureVisibility() {
    const enabled = key => Boolean(this.root.querySelector(`[data-field="${key}.enabled"]`)?.checked);
    for (const key of interactionPages) {
      const visible = ['timers','income'].includes(key) ? Boolean(this.root.querySelector(`[data-field="${key === 'income' ? 'incomeEnabled' : 'timersEnabled'}"]`)?.checked) : enabled(({ gift:'gift', welcome:'welcome', likes:'like', keywords:'keyword', bot:'bot' })[key]);
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
    const visibleCategories = [...this.root.querySelectorAll('[data-category]')].filter(button => !button.hidden).length;
    this.root.querySelector('.primary-nav').style.gridTemplateColumns = `repeat(${Math.max(visibleCategories, 1)}, minmax(0, 1fr))`;
    const activeTab = this.root.querySelector(`[data-tab="${this.activeTab}"]`);
    this.hidden('[data-income-link]', !this.node('[data-field="incomeEnabled"]').checked);
    if (activeTab?.hidden) {
      this.tab('features');
    }
  }
  tab(key) {
    if (this.root.querySelector(`[data-tab="${key}"]`)?.hidden) return;
    this.activeTab = key; this.node('.scroll').scrollTop = 0; if (key === 'diagnostics') this.renderLogs();
    if (['income','profiles'].includes(key)) void this.callbacks.income?.();
    const category = interactionPages.includes(key) ? 'interaction' : 'settings';
    this.activeCategory = category;
    for (const node of this.root.querySelectorAll('[data-category]')) node.setAttribute('aria-pressed', String(node.dataset.category === category));
    for (const node of this.root.querySelectorAll('[data-subnav]')) node.hidden = node.dataset.subnav !== category;
    for (const node of this.root.querySelectorAll('[data-tab]')) { const active = node.dataset.tab === key; node.setAttribute('aria-selected', String(active)); node.tabIndex = active ? 0 : -1; }
    const featureByPage = { gift: 'gift', welcome: 'welcome', likes: 'like', keywords: 'keyword', bot:'bot', timers: 'timersEnabled', income:'incomeEnabled' };
    for (const node of this.root.querySelectorAll('[data-page]')) {
      const feature = featureByPage[node.dataset.page];
      const disabled = feature && !this.root.querySelector(`[data-field="${['timersEnabled','incomeEnabled'].includes(feature) ? feature : `${feature}.enabled`}"]`)?.checked;
      node.hidden = node.dataset.page !== key || Boolean(disabled);
    }
  }
  bind() {
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
    const launcher = this.node('.launcher');
    launcher.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      const rect = launcher.getBoundingClientRect();
      this.drag = { id:e.pointerId, startX:e.clientX, startY:e.clientY, left:rect.left, top:rect.top, moved:false };
      try { launcher.setPointerCapture(e.pointerId); } catch {}
    });
    this.onPointerMove = e => {
      if (!this.drag || (this.drag.id != null && e.pointerId != null && this.drag.id !== e.pointerId)) return;
      const dx=e.clientX-this.drag.startX, dy=e.clientY-this.drag.startY;
      if (!this.drag.moved && Math.hypot(dx,dy)<5) return;
      this.drag.moved=true; launcher.classList.add('dragging'); this.applyLauncherPosition(this.drag.left+dx,this.drag.top+dy); this.positionPanel(); e.preventDefault?.();
    };
    this.onPointerUp = e => {
      if (!this.drag || (this.drag.id != null && e.pointerId != null && this.drag.id !== e.pointerId)) return;
      if (this.drag.moved) {
        const rect=launcher.getBoundingClientRect(), margin=window.innerWidth<=560?8:12;
        const leftEdge=rect.left+rect.width/2 < window.innerWidth/2;
        this.applyLauncherPosition(leftEdge?margin:window.innerWidth-rect.width-margin,rect.top,true);
        launcher.classList.remove('dragging'); this.suppressLauncherClick=true;
        clearTimeout(this.suppressClickTimer); this.suppressClickTimer=setTimeout(()=>{this.suppressLauncherClick=false;},0);
        this.positionPanel();
      }
      this.drag=null;
    };
    window.addEventListener('pointermove',this.onPointerMove,{passive:false}); window.addEventListener('pointerup',this.onPointerUp); window.addEventListener('pointercancel',this.onPointerUp);
    launcher.addEventListener('click', () => { if (this.suppressLauncherClick) { this.suppressLauncherClick=false; return; } this.toggleOpen(); });
    this.node('.nav').addEventListener('keydown', e => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
      const category = interactionPages.includes(this.activeTab) ? 'interaction' : 'settings';
      const tabs = [...this.root.querySelectorAll(`[data-subnav="${category}"] [data-tab]`)].filter(tab => !tab.hidden);
      if (!tabs.length || !tabs.includes(this.root.activeElement)) return;
      e.preventDefault(); const current = tabs.indexOf(this.root.activeElement);
      const i = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (current + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      this.tab(tabs[i].dataset.tab); tabs[i].focus();
    });
    this.root.addEventListener('click', async e => {
      const category=e.target.closest('[data-category]');
      if(category){
        const firstVisibleTab=[...this.root.querySelectorAll(`[data-subnav="${category.dataset.category}"] [data-tab]`)].find(tab=>!tab.hidden);
        if(firstVisibleTab)this.tab(firstVisibleTab.dataset.tab);
        return;
      }
      const giftValue = e.target.closest('[data-gift-value]'); if (giftValue) { const field = this.root.querySelector('[data-field="gift.minValue"]'); field.value = giftValue.dataset.giftValue; this.markDirty(); this.syncControls(); field.focus(); return; }
      const add = e.target.closest('[data-add]'); if (add) return this.addRow(add.dataset.add);
      const remove = e.target.closest('[data-remove]'); if (remove) { remove.closest('[data-list-row]').remove(); this.markDirty(); this.syncControls(); return; }
      const move = e.target.closest('[data-move]');
      if (move) { const row = move.closest('[data-list-row]'), sibling = move.dataset.move === 'up' ? row.previousElementSibling : row.nextElementSibling; if (sibling) { if (move.dataset.move === 'up') row.parentNode.insertBefore(row,sibling); else row.parentNode.insertBefore(sibling,row); this.markDirty(); } return; }
      const go = e.target.closest('[data-go]'); if (go) { this.tab(go.dataset.go); return; }
      const tab = e.target.closest('[data-tab]'); if (tab) this.tab(tab.dataset.tab);
      const button = e.target.closest('[data-action]'); if (!button || button.disabled || button.hidden) return;
      const action = button.dataset.action;
      try {
        if (action === 'export-income') { this.setBusy(action,true); await this.callbacks.exportIncome?.(); return; }
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
    this.root.querySelector('[data-diagnostics]').textContent = [
      `连接观察器：${status.hook ? '已安装' : '未安装'}`, `捕获连接：${status.sockets}；连接${status.connected ? '在线' : '离线'}`,
      `解析消息帧：${status.frames}；结构化事件：${status.events}；解析失败：${status.errors}`,
      `待解码帧：${status.pendingFrames || 0}`,
      `最近消息：${status.lastFrame ? new Date(status.lastFrame).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '尚未收到'}`,
      `发送连接检查：${status.healthy ? '通过' : '未通过；请刷新直播页，确认开播状态'}`,
      `主播 UID：${status.anchorId}`, `输入框：${status.input}`, `发送按钮：${status.send}`,
      '礼物价值与等级来源：结构化直播消息；网页文字不会用于猜测。'
    ].join('\n');
  }
  refresh(engine, network = {}) {
    this.latest = [engine,network];
    const mode = { preview: '仅预览', auto: '自动发送' }[engine.config.mode];
    this.syncLauncher();
    if (!this.open) return;
    this.text('[data-state]', engine.running ? `运行中 · ${mode}` : '已暂停');
    const badge = this.node('[data-network]'); this.text('[data-network]', this.demo ? '模拟数据' : network.connected && network.frames ? '直播数据已连接' : '等待直播数据'); badge.classList.toggle('live', Boolean(network.connected && network.frames));
    for (const key of ['events','filtered','previews','submitted']) this.text(`[data-stat="${key}"]`,engine.stats[key]);
    this.text('[data-delivery-health]', `待发送 ${engine.queue.length} 条 · 等待结算 ${[...engine.gifts.values()].filter(g => g.count > g.credited).length} 组礼物 · 重试 ${engine.stats.retries} 次 · 过期 ${engine.stats.expired} 条 · 队列满 ${engine.stats.overflow} 次`);
    this.text('[data-bot-session]', engine.bot?.sessionSummary?.() || '当前没有进行中的游戏。');
    this.syncFooter(); this.renderLastReply(); this.renderOverview(engine);
    for (const action of ['identify','test-ai','diagnose']) this.disabled(`[data-action="${action}"]`, this.busyActions.has(action) || (action === 'test-ai' && ['save','start'].some(a=>this.busyActions.has(a))));
  }
  destroy() { clearTimeout(this.logTimer); clearTimeout(this.toastTimer); clearTimeout(this.suppressClickTimer); window.removeEventListener('resize',this.onResize); window.removeEventListener('pointermove',this.onPointerMove); window.removeEventListener('pointerup',this.onPointerUp); window.removeEventListener('pointercancel',this.onPointerUp); this.host.remove(); }
}
