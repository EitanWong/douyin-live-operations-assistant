import { copy, mergeConfig, validateConfig } from './core.js';
import { validateEndpoint } from './ai.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const at = (o, path) => path.split('.').reduce((v, k) => v?.[k], o);
const put = (o, path, value) => { const parts = path.split('.'); const key = parts.pop(); parts.reduce((v, k) => v[k], o)[key] = value; };
const categories = { system: '运行', filter: '过滤', moderation: '内容提醒', queue: '候选', preview: '预览', sent: '提交', ai: 'AI', error: '错误', lab: '自检' };
const timeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
const kinds = { gift: '礼物感谢', welcome: '进场欢迎', keyword: '关键词', ai: 'AI 回复', timer: '定时消息' };
const presets = {
  deepseek: ['https://api.deepseek.com/chat/completions', 'deepseek-flash'],
  qwen: ['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'qwen-plus'],
  doubao: ['https://ark.cn-beijing.volces.com/api/v3/chat/completions', '请填写你的接入点ID'],
  local: ['http://localhost:11434/v1/chat/completions', 'qwen2.5:7b']
};
const CSS_TEXT = `
:host{all:initial;font:14px/1.5 "PingFang SC","Microsoft YaHei",sans-serif;color:#172a2d;--ink:#172a2d;--muted:#53666a;--line:#cbd6d4;--accent:#08796f;--accent-strong:#075b56;--paper:#f4f7f5;--surface:#fff;--wash:#e2f1ed;--signal:#d76048;--amber:#f2c66d;--warning:#fff1d2;--danger:#a62f3f}
*{box-sizing:border-box}button,input,select,textarea{font:inherit}button{cursor:pointer;transition:background-color 120ms,border-color 120ms,color 120ms,transform 120ms}button:disabled{cursor:wait;opacity:.52}button,input,select,textarea{border:1px solid var(--line);border-radius:6px;color:var(--ink)}button{background:var(--surface);padding:8px 12px;min-height:38px}button:hover:not(:disabled){background:var(--wash);border-color:#93bbb3}button:active:not(:disabled){transform:translateY(1px)}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #7ec5b9;outline-offset:2px}.primary{background:var(--accent);color:#fff;border-color:var(--accent)}.primary:hover:not(:disabled){background:var(--accent-strong);color:#fff}.danger{color:var(--danger)}
.launcher{position:fixed;right:24px;bottom:24px;background:#173a3b;color:#fff;border:1px solid #315959;border-radius:7px;padding:11px 16px;box-shadow:0 8px 26px #10292b40;font-weight:650;touch-action:none;user-select:none;cursor:grab}.launcher.dragging{cursor:grabbing;transition:none}.launcher:hover{background:#21494a;color:#fff}.launcher i{display:inline-block;width:8px;height:8px;background:var(--amber);border-radius:50%;margin-right:9px;pointer-events:none}.launcher.running i{background:#67d3a5;box-shadow:0 0 0 3px #67d3a533}.launcher span{white-space:nowrap;pointer-events:none}
.panel{position:fixed;right:24px;bottom:82px;width:min(560px,calc(100vw - 32px));height:min(780px,calc(100vh - 110px));display:flex;flex-direction:column;background:var(--paper);border:1px solid #aebfbb;border-radius:8px;box-shadow:0 22px 66px #142c2d42;overflow:hidden}.panel[hidden]{display:none}
.head{padding:16px 20px;background:#173a3b;color:#fff;display:flex;justify-content:space-between;gap:16px;align-items:center;border-bottom:3px solid var(--accent)}.head h1{font-size:18px;line-height:1.25;margin:0;font-weight:680}.room{color:#d0e3dd;font-size:12px;margin-top:4px}.head button{border:1px solid #62817c;background:transparent;color:white;padding:4px 10px;min-height:32px}.head button:hover{background:#285453;color:white}.banner{margin:0;background:var(--warning);color:#634a19;padding:8px 20px;font-size:12px;border-bottom:1px solid #ecd69e}.nav{background:var(--surface);border-bottom:1px solid var(--line);flex-shrink:0}.primary-nav{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:8px 12px 6px}.primary-nav button{border:0;background:transparent;min-height:34px;padding:5px 8px;color:var(--muted);font-size:13px;font-weight:600}.primary-nav button[aria-pressed=true]{background:#e5f1ed;color:var(--accent-strong)}.subnav{display:flex;gap:5px;padding:0 14px 8px;overflow-x:auto;scrollbar-width:none}.subnav[hidden]{display:none}.subnav button{border:0;border-radius:4px;background:transparent;padding:5px 10px;white-space:nowrap;color:var(--muted);min-height:30px;font-size:12px}.subnav button[aria-selected=true]{background:#f3eae6;color:#983f34;font-weight:700}.subnav button:hover{background:#f1f7f4;color:var(--ink)}
.scroll{overflow-y:auto;flex:1;padding:18px 20px;overscroll-behavior:contain;scrollbar-color:#afc1bd transparent}.page[hidden]{display:none}.page h2{font-size:18px;margin:0 0 6px;line-height:1.35}.intro,.hint{font-size:12px;color:var(--muted);margin:6px 0 14px;line-height:1.6}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.status{display:flex;gap:9px;align-items:center;margin-bottom:12px}.status strong{font-size:13px}.badge{background:#e9eeec;color:#526467;border-radius:4px;padding:3px 8px;font-size:11px;font-weight:600}.badge.live{background:#e2f4eb;color:#17694d}.actions{display:flex;gap:7px;flex-wrap:wrap}.stats{display:flex;margin:14px 0 18px;padding:12px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.stats div{flex:1}.stats b{font-size:22px;display:block;line-height:1.2;font-weight:650}.stats span{font-size:11px;color:var(--muted)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}.field{display:flex;flex-direction:column;gap:5px;margin:0 0 12px;min-width:0}.field span{font-size:12px;font-weight:650}.field small{color:var(--muted);font-size:11px;font-weight:400}.field input,.field select,.field textarea{background:var(--surface);width:100%;padding:8px 10px;min-height:40px}.field textarea{resize:vertical;min-height:76px;line-height:1.5}.toggle{display:flex;align-items:center;gap:9px;min-height:38px;margin:3px 0 10px;font-size:13px}.toggle input{width:18px;height:18px;accent-color:var(--accent)}.section{padding-top:14px;margin-top:14px;border-top:1px solid var(--line)}.section h3,.subhead{font-size:13px;margin:0 0 9px;font-weight:700}.notice{padding:10px 12px;border-left:3px solid var(--amber);background:#fff7e5;font-size:12px;color:#624e27;line-height:1.65;margin:12px 0}
.queue{margin-top:10px}.candidate{border-bottom:1px solid var(--line);padding:12px 0;display:grid;grid-template-columns:74px 1fr;gap:10px}.candidate .kind{font-size:11px;color:var(--accent-strong);font-weight:650}.candidate textarea{display:block;width:100%;padding:8px 10px;background:var(--surface);resize:vertical;min-height:52px;margin-bottom:7px}.candidate p{margin:0 0 6px;word-break:break-word}.candidate button{font-size:12px;padding:4px 9px;min-height:30px}.empty{color:var(--muted);font-size:12px;padding:12px 0}.log-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.log-head select{background:var(--surface);padding:5px 8px;max-width:150px}.logs{max-height:230px;overflow:auto;border-top:1px solid var(--line)}.log{display:grid;grid-template-columns:54px 42px 1fr;gap:8px;font-size:11px;padding:8px 0;border-bottom:1px solid #dce4e1;word-break:break-word}.log time,.log .cat{color:var(--muted)}.log[data-category=error]{color:var(--danger)}.log[data-category=preview] .cat{color:var(--accent-strong)}
.foot{padding:10px 18px;border-top:1px solid #bfcfcb;background:var(--surface);display:flex;justify-content:space-between;gap:12px;align-items:center;flex-shrink:0}.foot small{font-size:11px;color:var(--muted)}.foot .primary{min-width:122px}.foot [hidden]{display:none}.foot [data-action=save]:disabled{cursor:default}.dirty{color:#9b5a12!important}.toast{padding:9px 20px;font-size:12px;background:#e2f1ed;color:#24564f;flex-shrink:0;border-bottom:1px solid #c2d9d2}.toast[hidden]{display:none}.toast.error{background:#fae7e8;color:#8c2336}pre{font:12px/1.65 "SFMono-Regular",Consolas,monospace;white-space:pre-wrap;word-break:break-all;background:#e8efec;padding:12px;border-radius:6px;color:#334b4a}.inline{display:flex;gap:8px;align-items:center}.inline input{flex:1}.file{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}.wide{grid-column:1/-1}
.identity{padding:0 0 10px;border:0;border-bottom:1px solid var(--line);border-radius:0;margin-bottom:13px;background:transparent}.identity strong{font-size:13px}.identity p{margin:3px 0;font-size:12px;color:var(--muted)}.identity .actions{margin-top:8px}.identity details{margin-top:4px}.identity summary{padding:3px 0}.recent-gifts h3{margin:0;font-size:13px}.gift-activity{display:grid;grid-template-columns:minmax(74px,1fr) minmax(90px,1.4fr) auto;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line);font-size:12px}.gift-activity strong,.gift-activity span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gift-activity small{color:var(--muted);text-align:right}.editor-row{padding:12px 0;border-bottom:1px solid var(--line)}.editor-row .row-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.editor-row .row-head b{font-size:12px}.editor-row .row-head button{min-height:30px;padding:4px 9px;font-size:11px}.editor-row .grid{gap:8px 10px}.editor-row .field{margin-bottom:8px}.editor-row textarea{min-height:60px}.list-add{margin-top:9px}.feature-shortcuts{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.feature-shortcuts button{font-size:12px}.feature-shortcuts button[aria-pressed=true]{background:#e4f1eb;color:#28694f;border-color:#bad8ca}summary{cursor:pointer;color:var(--muted);font-size:12px;padding:8px 0}summary:hover{color:var(--accent-strong)}.choice-hint{font-size:11px;color:var(--muted)}[aria-invalid=true]{border-color:var(--danger)!important;box-shadow:0 0 0 2px #a62f3f18}
.mode-note{font-size:12px;color:var(--muted);margin:0 0 10px;padding:7px 9px;border-left:2px solid var(--amber);background:#fff7e5}.feature-list{border-top:1px solid var(--line);margin:9px 0 12px}.feature-row{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--line)}.feature-title{flex:1;text-align:left;padding:0;border:0;background:transparent;font-weight:700;min-width:0;font-size:13px}.feature-title small{display:block;font-size:11px;color:var(--muted);font-weight:400;overflow-wrap:anywhere;margin-top:2px}.feature-title:hover,.text-button:hover{background:transparent;color:var(--accent-strong)}.text-button{border:0;background:transparent;font-size:12px;padding:4px;color:var(--muted);min-height:32px}.switch{position:relative;width:40px;height:26px;min-height:26px;padding:3px;border:0;border-radius:20px;background:#b3c0bd;flex-shrink:0}.switch input{position:absolute;inset:0;z-index:1;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}.switch span{display:block;height:20px;width:34px;border-radius:20px;background:#b3c0bd;transition:background-color 130ms}.switch span:after{content:"";display:block;height:18px;width:18px;border-radius:50%;background:white;transition:transform 130ms}.switch input:checked+span{background:var(--accent)}.switch input:checked+span:after{transform:translateX(14px)}.switch:has(input:focus-visible){outline:3px solid #7ec5b9;outline-offset:2px}.switch:hover span{background:#899f9a}.switch input:checked+span{background:var(--accent)}.reply-section h3{font-size:13px;margin:0 0 7px}.reply-section p{font-size:12px;margin:0;line-height:1.65;overflow-wrap:anywhere}.reply-section [data-queue-section]{margin-top:12px}.rule-summary{padding:9px 11px;margin:0 0 13px;border-left:3px solid var(--accent);background:var(--wash)}.rule-summary strong{font-size:11px;color:var(--muted);font-weight:650}.rule-summary p{margin:2px 0 0;font-size:13px;line-height:1.5;overflow-wrap:anywhere}.presets{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:-3px 0 12px}.presets span{font-size:11px;color:var(--muted);margin-right:2px}.presets button{min-height:32px;padding:4px 10px;font-size:12px}.subhead{margin:16px 0 8px}.foot small{max-width:180px}.subnav button:focus-visible{outline-offset:-3px}
@media(max-width:560px){.panel{width:calc(100vw - 20px);height:calc(100dvh - 24px)}.launcher{right:12px;bottom:12px}.grid{grid-template-columns:1fr}.head,.scroll{padding:14px 15px}.foot{padding:9px 14px}.primary-nav{padding:6px 8px 4px;gap:2px}.primary-nav button{font-size:12px;padding:4px}.subnav{padding:0 9px 6px}.stats b{font-size:19px}.stats span{font-size:10px}.row{gap:7px}.foot small{max-width:130px}.candidate{grid-template-columns:64px 1fr}.gift-activity{grid-template-columns:minmax(65px,1fr) minmax(75px,1.2fr) auto;gap:5px;font-size:11px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto;transition:none!important}}
`;

export class Panel {
  constructor({ config, room, demo = false, callbacks }) {
    this.config = config; this.room = room; this.demo = demo; this.callbacks = callbacks; this.entries = []; this.open = true; this.activeTab = 'runtime'; this.dirty = false; this.rowSerial = 0; this.logDirty = false; this.viewers = [];
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
    return `<label class="field"><span>${label}</span><select data-field="${path}">${choices.map(([v, title]) => `<option value="${v}">${title}</option>`).join('')}</select></label>`;
  }
  build() {
    const container = document.createElement('div');
    const tabGroups = { reply: [['keywords', '关键词'], ['timers', '定时'], ['replies', '回复记录']], interaction: [['gift', '礼物'], ['welcome', '欢迎'], ['likes', '点赞']], settings: [['runtime', '运行'], ['ai', 'AI 设置'], ['diagnostics', '连接']] };
    container.innerHTML = `
      <button class="launcher" aria-expanded="true"><i></i><span>场控 · 已暂停</span></button>
      <section class="panel" aria-label="抖音直播运营助手控制台">
        <header class="head"><div><h1>抖音直播运营助手</h1><div class="room">${this.demo ? '模拟直播间' : `直播间 ${esc(this.room)}`}</div></div><button data-action="close" aria-label="收起面板">收起</button></header>
        ${this.demo ? '<p class="banner">本地演示：弹幕和礼物均为模拟数据，消息不会发到抖音。</p>' : ''}
        <nav class="nav" aria-label="功能导航"><div class="primary-nav" role="group" aria-label="功能分类">${[['reply','回复'],['interaction','互动'],['settings','设置']].map(([key,label])=>`<button type="button" data-category="${key}" aria-pressed="${key==='settings'}">${label}</button>`).join('')}</div>${Object.entries(tabGroups).map(([category,group])=>`<div class="subnav" data-subnav="${category}" role="tablist" aria-label="${{reply:'回复功能',interaction:'互动功能',settings:'设置功能'}[category]}" ${category!=='settings'?'hidden':''}>${group.map(([key,name])=>`<button type="button" role="tab" id="tab-${key}" aria-controls="page-${key}" data-tab="${key}" aria-selected="${key==='runtime'}" tabindex="${key==='runtime'?0:-1}">${name}</button>`).join('')}</div>`).join('')}</nav>
        <div class="toast" role="status" hidden></div>
        <div class="scroll"><form autocomplete="off">
          <section class="page" role="tabpanel" id="page-runtime" aria-labelledby="tab-runtime" data-page="runtime">
            <h2>运行设置</h2><p class="intro">统一设置发送方式、节奏和各项自动互动开关。</p>
            <div class="status"><strong data-state>已暂停</strong><span class="badge" data-network>等待直播数据</span></div>
            <div class="grid">${this.select('mode', '回复方式', [['preview', '仅预览，不发送'], ['review', '逐条审核后发送'], ['auto', '自动发送']])}<label class="field"><span>发言节奏</span><select data-pace><option value="gentle">安静些</option><option value="normal">适中（推荐）</option><option value="lively">活跃些</option><option value="custom">自定义</option></select></label></div>
            <div class="mode-note" data-mode-note>仅预览，不会发送到直播间。</div>
            <section class="section"><h3>自动互动</h3><div class="feature-list">${[['gift','礼物感谢'],['welcome','进场欢迎'],['like','点赞感谢'],['keyword','关键词回复']].map(([key,label]) => `<div class="feature-row"><div class="feature-title">${label}<small data-feature-note="${key}"></small></div><label class="switch" aria-label="${label}"><input type="checkbox" role="switch" data-field="${key}.enabled" aria-label="${label}"><span></span></label></div>`).join('')}</div><p class="hint">定时消息按每组开关；AI 服务及问答开关在 AI 设置中管理。</p></section>
            <details class="section" data-sending-details><summary>发送限制</summary><p class="hint" data-pace-note></p><div class="grid">${this.input('sending.intervalSec', '最少间隔 / 秒', 'number')}${this.input('sending.perMinute', '每分钟最多 / 条', 'number')}${this.input('sending.maxLength', '单条字数上限', 'number')}</div></details>
          </section>
          <section class="page" role="tabpanel" id="page-replies" aria-labelledby="tab-replies" data-page="replies" hidden>
            <h2>回复记录</h2><p class="intro">查看最近生成的回复，并处理需要人工确认的消息。</p>
            <section class="reply-section"><h3 data-reply-title>最近回复</h3><p data-last-reply class="empty">开始后，符合规则的回复会显示在这里。</p><div data-queue-section hidden><h3>待处理消息</h3><div class="queue" data-queue></div></div></section>
          </section>
          <section class="page" role="tabpanel" id="page-gift" aria-labelledby="tab-gift" data-page="gift" hidden>
            <h2>礼物感谢</h2><p class="intro">达到阈值才感谢，连击合并成一条回复。</p>
            <section class="recent-gifts section"><div class="log-head"><h3>近期送礼</h3><span class="choice-hint" data-gift-count>仅保留本次页面数据</span></div><div data-recent-gifts><p class="empty">收到礼物后，送礼用户和已知礼物信息会显示在这里。</p></div></section>
            <div class="rule-summary"><strong>当前规则</strong><p data-summary="gift"></p></div>
            ${this.select('gift.responseMode', '答谢生成方式', [['rules', '使用预设话术'], ['ai', '使用 AI 生成']])}
            ${this.input('gift.minValue', '达到多少钻石才感谢', 'number')}
            <div class="presets" aria-label="常用礼物阈值"><span>快速设为</span>${[[50,'50'],[100,'100'],[500,'500'],[1000,'1000']].map(([value,label])=>`<button type="button" data-gift-value="${value}">${label} 钻</button>`).join('')}</div>
            <details><summary>筛选与防刷屏</summary>${this.select('gift.basis', '按什么计算价值', [['total', '整次连击的总价值（推荐）'], ['unit', '单个礼物的价值']])}<div class="grid">${this.input('gift.cooldownSec', '同一人感谢间隔 / 秒', 'number')}${this.input('gift.mergeSec', '连击等待 / 秒', 'number')}</div></details>
            ${this.area('gift.templates', '感谢话术（每行一条，轮流使用）', 'lines', '变量：{user} 昵称、{gift} 礼物名、{count} 数量、{value} 总钻石、{unit} 单价。')}
            <div class="notice">单价未知的礼物会跳过并记录原因。钻石是接口价值单位，不自动折算人民币。</div>
            <details><summary>补充未知礼物的单价</summary><div data-list="prices"></div><button type="button" class="list-add" data-add="prices">添加礼物单价</button><p class="hint">填礼物名称或 ID，仅在直播消息缺少单价时使用。</p></details>
          </section>
          <section class="page" role="tabpanel" id="page-welcome" aria-labelledby="tab-welcome" data-page="welcome" hidden>
            <h2>进场欢迎</h2><p class="intro">按等级和本房粉丝牌筛选，也可指定要欢迎的人。</p>
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
            <div class="notice">点赞感谢也遵守全局发送节奏和预览/审核模式。</div>
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
            <h2>AI 设置</h2><p class="intro">选服务、填密钥，再测试连接。</p>
            <div class="rule-summary"><strong>当前规则</strong><p data-summary="ai"></p></div>
            ${this.toggle('ai.enabled', '启用 AI 服务（供各模块调用）')}
            ${this.toggle('ai.chatEnabled', '启用弹幕 AI 问答')}
            <label class="field"><span>服务预设</span><select data-preset><option value="custom">自定义兼容接口</option><option value="deepseek">DeepSeek</option><option value="qwen">通义千问 / DashScope</option><option value="doubao">豆包 / 火山方舟</option><option value="local">本地 Ollama</option></select></label>
            <details data-ai-connection><summary>接口与模型</summary>${this.input('ai.endpoint', 'API 接口地址')}${this.input('ai.model', '模型名称 / 接入点 ID')}</details>
            <label class="field"><span>API Key</span><input type="password" data-api-key autocomplete="new-password" placeholder="留空保留此服务已有密钥"><small data-key-status>密钥按服务域名隔离，不随配置导出。</small></label>
            <label class="toggle"><input type="checkbox" data-remember-key>记住新密钥（仅此设备）</label>
            <div class="actions"><button type="button" data-action="test-ai">测试 AI 连接</button><button type="button" class="danger" data-action="forget-key">清除此服务密钥</button></div>
            <div class="section">${this.select('ai.trigger', '自动回复触发条件', [['question', '提问弹幕'], ['mention', '呼叫场控'], ['all', '所有弹幕（受调用限额约束）']])}<details><summary>AI 频率与上下文</summary><div class="grid">${this.input('ai.intervalSec', '两次 AI 调用间隔 / 秒', 'number')}${this.input('ai.userCooldownSec', '同一用户 AI 冷却 / 秒', 'number')}${this.input('ai.maxPerHour', '每小时最多调用 / 次', 'number')}${this.input('ai.contextSize', '最近弹幕条数', 'number')}${this.input('ai.contextAgeSec', '弹幕保留时长 / 秒', 'number')}</div></details>
            <div data-ai-mentions>${this.area('ai.mentions', '场控呼叫词（每行一个）')}</div>${this.area('ai.persona', '场控风格', 'text')}${this.area('ai.knowledge', '主播与本场直播资料', 'text', '填写已核实的直播主题、开播时间、商品事实；建议先审核 AI 回复。')}
            <details><summary>冷场互动</summary>${this.toggle('ai.idleEnabled', '冷场时生成互动邀请')}${this.input('ai.idleSec', '没有新互动多久算冷场 / 秒', 'number')}</details>
            <div class="notice">各模块可分别选择规则话术或 AI 生成。AI 服务需在此启用；最近弹幕、昵称和你填写的资料会发往所配置的服务，不发送 Cookies 或观众 UID。预览模式仍会调用 AI。</div></div>
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
            <h3 class="subhead">账号身份</h3>
            <details data-manual-identity><summary>主播与账号识别</summary>${this.toggle('identity.autoAnchor', '自动识别主播')}${this.input('anchorId', '主播 UID（自动识别不到时填写）')}${this.toggle('identity.autoSelf', '自动识别登录账号')}${this.input('selfId', '登录账号 UID（自动识别不到时填写）')}</details>
            <h3 class="subhead">互动过滤</h3>
            ${this.area('ignored', '忽略用户（每行一位）', 'lines', '支持 uid:、sec:、name: 前缀。')}${this.area('blockedWords', '禁止发送的词（每行一个）')}
            <details class="section"><summary>辱骂与恶意弹幕提醒</summary>${this.toggle('moderation.enabled', '识别疑似辱骂并记录提醒')}${this.area('moderation.terms', '识别词（每行一个）', 'lines', '本地匹配，不把原始弹幕发给第三方；请按直播间语境调整。')}${this.input('moderation.threshold', '达到多少次提醒管理员', 'number')}${this.input('moderation.windowSec', '统计时长 / 秒', 'number')}<p class="hint">房间响应提供管理员 UID 名单时才确认身份。当前封禁操作未经验证，所以只提醒和计数，不会自动封禁。</p></details>
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
    const input = choices ? `<select data-item="${field}">${choices.map(([key,name]) => `<option value="${esc(key)}" ${String(value) === key ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>` : type === 'lines' ? `<textarea data-item="${field}" rows="2">${esc(Array.isArray(value) ? value.join('\n') : value)}</textarea>` : `<input data-item="${field}" type="${type}" value="${esc(value)}" ${type === 'number' ? 'min="0" step="any"' : ''}>`;
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
    const pace = [[20,3,'gentle'],[10,4,'normal'],[5,8,'lively']].find(([s,n])=>Number(get('sending.intervalSec').value)===s && Number(get('sending.perMinute').value)===n)?.[2] || 'custom';
    this.node('[data-pace]').value = pace;
    this.text('[data-feature-note=gift]', !get('gift.enabled').checked ? '已关闭' : `${get('gift.basis').value === 'total' ? '连击总价' : '单个礼物'} ≥ ${get('gift.minValue').value} 钻石`);
    const welcomeMode = get('welcome.mode').value;
    this.text('[data-feature-note=welcome]', !get('welcome.enabled').checked ? '已关闭' : welcomeMode === 'listed' ? '只欢迎指定名单' : `荣誉 ≥ ${get('welcome.minWealth').value} 级${get('welcome.requireFan').checked ? ` · 本房粉丝团${get('welcome.requireLit').checked ? '已点亮' : ''}` : ''}${welcomeMode === 'qualified-or-listed' ? '，另含指定名单' : ''}`);
    this.hidden('[data-qualified]', welcomeMode === 'listed');
    if (welcomeMode === 'listed' && this.welcomeMode !== welcomeMode) this.node('[data-welcome-list]').open = true;
    this.welcomeMode = welcomeMode;
    const listedCount = this.root.querySelectorAll('[data-list="listed"] [data-list-row="listed"]').length;
    const fanRule = get('welcome.requireFan').checked ? `本房粉丝团 ≥ ${get('welcome.minFanLevel').value} 级${get('welcome.requireLit').checked ? '且已点亮' : ''}` : '不限制粉丝团';
    const welcomeRule = welcomeMode === 'listed' ? `仅欢迎指定名单（${listedCount} 人）` : `荣誉 ≥ ${get('welcome.minWealth').value} 级 · ${fanRule}${welcomeMode === 'qualified-or-listed' ? ` · 或名单 ${listedCount} 人` : ''}`;
    const aiReady = get('ai.enabled').checked;
    const strategy = mode => mode === 'ai' ? (aiReady ? 'AI 优先，规则兜底' : '规则话术（AI 服务关闭）') : '预设话术';
    this.text('[data-summary=gift]', !get('gift.enabled').checked ? '已关闭，不会生成礼物感谢。' : `${get('gift.basis').value === 'total' ? '连击总价' : '单个礼物'} ≥ ${get('gift.minValue').value || 0} 钻 · ${strategy(get('gift.responseMode').value)} · 同一人冷却 ${get('gift.cooldownSec').value} 秒。`);
    this.text('[data-summary=welcome]', !get('welcome.enabled').checked ? '已关闭，不会生成进场欢迎。' : `${welcomeRule} · ${strategy(get('welcome.responseMode').value)}`);
    this.text('[data-feature-note=like]', !get('like.enabled').checked ? '已关闭' : `${strategy(get('like.responseMode').value)} · 同一人 ${get('like.cooldownSec').value} 秒冷却`);
    this.text('[data-summary=like]', !get('like.enabled').checked ? '已关闭，不会生成点赞感谢。' : `${strategy(get('like.responseMode').value)} · 同一人感谢间隔 ${get('like.cooldownSec').value} 秒 · 全局限速生效。`);
    const keywordCount = this.root.querySelectorAll('[data-list="keywords"] [data-list-row="keywords"]').length;
    this.text('[data-feature-note=keyword]', !get('keyword.enabled').checked ? '已关闭' : `启用 ${keywordCount} 条规则`);
    this.text('[data-summary=keyword]', !get('keyword.enabled').checked ? '已关闭，不会回复关键词弹幕。' : `${keywordCount} 条规则 · 按顺序命中首条 · ${strategy(get('keyword.responseMode').value)} · 同一用户冷却 ${get('keyword.cooldownSec').value} 秒。`);
    this.hidden('[data-ai-mentions]', get('ai.trigger').value !== 'mention');
    const triggerName = { question: '提问弹幕', mention: '呼叫词', all: '所有弹幕' }[get('ai.trigger').value];
    this.text('[data-summary=ai]', !aiReady ? 'AI 服务已关闭；所有模块继续使用规则话术。' : `AI 服务已开启 · 弹幕问答${get('ai.chatEnabled').checked ? `：${triggerName}` : '：关闭'} · 每小时最多 ${get('ai.maxPerHour').value} 次 · ${get('mode').value === 'preview' ? '当前仅预览' : get('mode').value === 'review' ? '逐条审核' : '自动发送'}`);
    const timerRows = [...this.root.querySelectorAll('[data-list=timers] [data-list-row=timers]')];
    const activeTimerRows = timerRows.filter(row=>row.querySelector('[data-item=enabled]')?.checked);
    const timers = activeTimerRows.length;
    const intervals = [...new Set(activeTimerRows.map(row=>row.querySelector('[data-item=intervalSec]')?.value).filter(Boolean))];
    this.text('[data-summary=timers]', timers ? `已开启 ${timers} 组 · 间隔 ${intervals.map(value=>`${value} 秒`).join(' / ')} · ${activeTimerRows.some(row=>row.querySelector('[data-item=responseMode]')?.value === 'ai') ? '含 AI 生成组' : '预设话术'}。` : `${timerRows.length ? `共 ${timerRows.length} 组，` : ''}当前没有启用定时消息。`);
    this.text('[data-pace-note]', `所有回复合计：间隔至少 ${get('sending.intervalSec').value} 秒，每分钟最多 ${get('sending.perMinute').value} 条。`);
    this.text('[data-mode-note]', {preview:'仅预览，不会发送到直播间。AI 开启后仍会调用模型。',review:'逐条批准后发送，可修改回复内容。',auto:'符合规则的回复会自动发送。'}[get('mode').value]);
    const fan = get('welcome.requireFan').checked;
    get('welcome.requireLit').disabled = !fan; get('welcome.minFanLevel').disabled = !fan;
    get('anchorId').readOnly = get('identity.autoAnchor').checked && Boolean(this.identity?.anchor);
    get('selfId').readOnly = get('identity.autoSelf').checked && Boolean(this.identity?.self);
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
  toast(message, error = false) {
    const node = this.root.querySelector('.toast'); node.textContent = message; node.classList.toggle('error', error); node.hidden = false;
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { node.hidden = true; }, 8000);
  }
  toggleOpen() { this.open = !this.open; this.node('.panel').hidden = !this.open; this.node('.launcher').setAttribute('aria-expanded', String(this.open)); if (this.open) { if (this.latest) this.refresh(...this.latest); this.renderLogs(); this.positionPanel(); } }
  tab(key) {
    this.activeTab = key; this.node('.scroll').scrollTop = 0; if (key === 'diagnostics') this.renderLogs();
    const category = ['keywords','timers','replies'].includes(key) ? 'reply' : ['gift','welcome','likes'].includes(key) ? 'interaction' : 'settings';
    for (const node of this.root.querySelectorAll('[data-category]')) node.setAttribute('aria-pressed', String(node.dataset.category === category));
    for (const node of this.root.querySelectorAll('[data-subnav]')) node.hidden = node.dataset.subnav !== category;
    for (const node of this.root.querySelectorAll('[data-tab]')) { const active = node.dataset.tab === key; node.setAttribute('aria-selected', String(active)); node.tabIndex = active ? 0 : -1; }
    for (const node of this.root.querySelectorAll('[data-page]')) node.hidden = node.dataset.page !== key;
  }
  bind() {
    this.root.querySelector('form').addEventListener('submit', e => e.preventDefault());
    const edited = e => {
      if (!e.target.closest('[data-field],[data-item],[data-api-key],[data-remember-key],[data-preset],[data-pace]')) return;
      this.markDirty(); e.target.removeAttribute('aria-invalid'); this.syncControls();
      if (e.target.dataset.field?.startsWith('identity.') && this.identity) this.updateIdentity(this.identity);
    };
    this.root.addEventListener('input', edited); this.root.addEventListener('change', edited);
    this.node('[data-pace]').addEventListener('change', e => {
      const pace = { gentle:[20,3], normal:[10,4], lively:[5,8] }[e.target.value];
      if (pace) { this.root.querySelector('[data-field="sending.intervalSec"]').value = pace[0]; this.root.querySelector('[data-field="sending.perMinute"]').value = pace[1]; }
      else this.node('[data-sending-details]').open = true;
      this.markDirty(); this.syncControls();
    });
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
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
      const category = ['keywords','timers','replies'].includes(this.activeTab) ? 'reply' : ['gift','welcome','likes'].includes(this.activeTab) ? 'interaction' : 'settings';
      const tabs = [...this.root.querySelectorAll(`[data-subnav="${category}"] [data-tab]`)];
      if (!tabs.length || !tabs.includes(this.root.activeElement)) return;
      e.preventDefault(); const current = tabs.indexOf(this.root.activeElement);
      const i = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (current + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      this.tab(tabs[i].dataset.tab); tabs[i].focus();
    });
    this.root.addEventListener('click', async e => {
      const category=e.target.closest('[data-category]');
      if(category){const defaults={reply:'keywords',interaction:'gift',settings:'runtime'};this.tab(defaults[category.dataset.category]);return;}
      const giftValue = e.target.closest('[data-gift-value]'); if (giftValue) { const field = this.root.querySelector('[data-field="gift.minValue"]'); field.value = giftValue.dataset.giftValue; this.markDirty(); this.syncControls(); field.focus(); return; }
      const add = e.target.closest('[data-add]'); if (add) return this.addRow(add.dataset.add);
      const remove = e.target.closest('[data-remove]'); if (remove) { remove.closest('[data-list-row]').remove(); this.markDirty(); this.syncControls(); return; }
      const move = e.target.closest('[data-move]');
      if (move) { const row = move.closest('[data-list-row]'), sibling = move.dataset.move === 'up' ? row.previousElementSibling : row.nextElementSibling; if (sibling) { if (move.dataset.move === 'up') row.parentNode.insertBefore(row,sibling); else row.parentNode.insertBefore(sibling,row); this.markDirty(); } return; }
      const go = e.target.closest('[data-go]'); if (go) { this.tab(go.dataset.go); return; }
      const tab = e.target.closest('[data-tab]'); if (tab) this.tab(tab.dataset.tab);
      const button = e.target.closest('[data-action]'); if (!button || button.disabled) return;
      const action = button.dataset.action;
      try {
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
        } else if (action === 'approve') {
          const card = button.closest('[data-candidate]'); this.callbacks.approve(Number(card.dataset.candidate), card.querySelector('textarea').value);
        } else if (action === 'discard') this.callbacks.discard(Number(button.closest('[data-candidate]').dataset.candidate));
        else if (action === 'export') this.callbacks.exportConfig();
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
      `最近消息：${status.lastFrame ? new Date(status.lastFrame).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '尚未收到'}`,
      `发送连接检查：${status.healthy ? '通过' : '未通过；请刷新直播页，确认开播状态'}`,
      `主播 UID：${status.anchorId}`, `输入框：${status.input}`, `发送按钮：${status.send}`,
      '礼物价值与等级来源：结构化直播消息；网页文字不会用于猜测。'
    ].join('\n');
  }
  refresh(engine, network = {}) {
    this.latest = [engine,network];
    const mode = { preview: '仅预览', review: '人工审核', auto: '自动发送' }[engine.config.mode];
    const launcher = this.node('.launcher'); launcher.classList.toggle('running', engine.running); this.text('.launcher span', `场控 · ${engine.running ? mode : '已暂停'}`);
    if (!this.open) return;
    this.text('[data-state]', engine.running ? `运行中 · ${mode}` : '已暂停');
    const badge = this.node('[data-network]'); this.text('[data-network]', this.demo ? '模拟数据' : network.connected && network.frames ? '直播数据已连接' : '等待直播数据'); badge.classList.toggle('live', Boolean(network.connected && network.frames));
    for (const key of ['events','filtered','previews','submitted']) this.text(`[data-stat="${key}"]`,engine.stats[key]);
    this.syncFooter(); this.renderLastReply();
    for (const action of ['identify','test-ai','diagnose']) this.disabled(`[data-action="${action}"]`, this.busyActions.has(action) || (action === 'test-ai' && ['save','start'].some(a=>this.busyActions.has(a))));
    const box = this.root.querySelector('[data-queue]');
    this.hidden('[data-queue-section]', !engine.queue.length);
    // 保留正在编辑的审核文本，不随每秒状态刷新重建。
    const ids = `${engine.config.mode}:` + engine.queue.map(q => `${q.id}:${q.approved}:${q.text}`).join(',');
    if (ids === this.queueIds) return; this.queueIds = ids;
    const drafts = new Map([...box.querySelectorAll('[data-candidate]')].map(el => [Number(el.dataset.candidate), el.querySelector('textarea')?.value]));
    box.innerHTML = engine.queue.length ? engine.queue.map(q => `<div class="candidate" data-candidate="${q.id}"><div class="kind">${esc(kinds[q.kind] || q.kind)}</div><div>${engine.config.mode === 'review' && !q.approved ? `<textarea aria-label="修改候选回复">${esc(drafts.get(q.id) ?? q.text)}</textarea><button type="button" class="primary" data-action="approve">批准发送</button> ` : `<p>${esc(q.text)}</p><span class="hint">${q.approved ? '等待发送间隔' : '等待审核'}</span> `}<button type="button" data-action="discard">丢弃</button></div></div>`).join('') : '<p class="empty">暂无候选消息。已预览和已提交的内容可在运行记录查看。</p>';
  }
  destroy() { clearTimeout(this.logTimer); clearTimeout(this.toastTimer); clearTimeout(this.suppressClickTimer); window.removeEventListener('resize',this.onResize); window.removeEventListener('pointermove',this.onPointerMove); window.removeEventListener('pointerup',this.onPointerUp); window.removeEventListener('pointercancel',this.onPointerUp); this.host.remove(); }
}
