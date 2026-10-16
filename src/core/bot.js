const botLength = text => [...text].length;
const botClip = (text, max) => [...text].slice(0, max).join('');
const mentionBoundary = /[\s\u200b:：,，。!！?？]/u;

// 有结构化被 @ 账号时以 UID 为准；纯文本必须完整匹配昵称，不能误回同名前缀。
export function addressedToSelf(event, self, configuredId = '') {
  const text = String(event.text || '').trim();
  const ids = new Set([configuredId || self?.id, self?.secUid].filter(Boolean).map(String));
  const mentions = Array.isArray(event.mentions) ? event.mentions.map(String) : [];
  const structured = mentions.length > 0;
  if (structured && !mentions.some(id => ids.has(id))) return null;
  const name = (!configuredId || !self?.id || String(self.id) === String(configuredId)) && self?.name;
  if (name) {
    const token = `@${name}`;
    let offset = text.indexOf(token);
    while (offset >= 0) {
      const end = offset + token.length;
      if ((!offset || mentionBoundary.test(text[offset - 1])) && (end === text.length || mentionBoundary.test(text[end]))) {
        return `${text.slice(0, offset)} ${text.slice(end)}`.trim().replace(/^[:：,，\s]+/u, '');
      }
      offset = text.indexOf(token, end);
    }
  }
  if (!structured) return null;
  // 手动 UID 也可使用结构化 @；页面未提供昵称时，移除开头的显示昵称。
  return text.replace(/^@[^\s\u200b]+(?:[\s\u200b]+|$)/u, '').trim();
}

export const BOT_COMMANDS = [
  { key:'diceEnabled', label:'掷骰子', menu:'🎲骰子', example:'骰子', aliases:['骰子','掷骰子','roll'] },
  { key:'coinEnabled', label:'抛硬币', menu:'🪙硬币', example:'硬币', aliases:['硬币','抛硬币','coin'] },
  { key:'choiceEnabled', label:'帮我选择', menu:'🎯选择', example:'选择 唱歌/聊天', aliases:['选择','帮我选','choose'] },
  { key:'idiomEnabled', label:'成语接龙', menu:'🔤接龙', example:'接龙', aliases:['接龙','成语接龙','idiom'] },
  { key:'rpsEnabled', label:'猜拳', menu:'✊猜拳', example:'猜拳 石头', aliases:['猜拳','石头剪刀布','rps'] },
  { key:'guessEnabled', label:'猜数字', menu:'🔢猜数字', example:'开始猜数字', aliases:['猜数字','数字游戏','guess'] },
  { key:'truthEnabled', label:'真心话', menu:'💬真心话', example:'开始真心话', aliases:['真心话','truth'] },
  { key:'dareEnabled', label:'大冒险', menu:'🎭大冒险', example:'开始大冒险', aliases:['大冒险','dare'] }
];
const truths = ['最近让你开心的一件小事是什么？','你最想学会的一项技能是什么？','你最喜欢哪首歌？','你最想去哪个城市旅行？','用三个词形容今天的心情。','你小时候的梦想是什么？'];
const dares = ['用三个表情描述今天。','给直播间写一句押韵的祝福。','用一句话夸夸今天的自己。','推荐一首你喜欢的歌。','用四个字描述此刻的心情。','用一句绕口令挑战自己。'];
// 本地小词库：同字接龙，不把任意四个汉字当作成语。仅保存本场游戏，不关联用户画像。
const idioms = new Set(('一心一意 意气风发 发扬光大 大有可为 为所欲为 为人师表 表里如一 一马当先 先声夺人 人山人海 海阔天空 空前绝后 后来居上 上善若水 水到渠成 成千上万 万众一心 心想事成 成人之美 美不胜收 收放自如 如鱼得水 水落石出 出生入死 死里逃生 生龙活虎 虎头蛇尾 尾大不掉 掉以轻心 心花怒放 放任自流 流连忘返 返老还童 童叟无欺 欺人太甚 甚嚣尘上 上下同心 心平气和 和气生财 财源广进 进退两难 难能可贵 贵人多忘 忘乎所以 以德报怨 怨天尤人 人定胜天 天长地久 久别重逢 逢凶化吉 吉星高照 照本宣科 科班出身 身体力行 行云流水 水深火热 热火朝天 天南地北 北雁南飞 飞黄腾达 达官贵人 人才辈出 出人头地 地久天长 长驱直入 入木三分 分秒必争 争先恐后 后起之秀 秀外慧中 中流砥柱').split(' '));

export class RoomBot {
  constructor({ now = Date.now, random = Math.random } = {}) { this.now = now; this.random = random; this.reset(); }
  reset() { this.chain = null; this.session = null; }
  sessionSummary() {
    if (!this.session) return '📍当前没有进行中的游戏。';
    const labels = { idiom:'成语接龙', truth:'真心话', dare:'大冒险', guess:'猜数字' };
    const session = this.session;
    if (session.type === 'idiom') return `🔤${labels[session.type]}进行中 · 当前「${session.word}」；无需 @，直接发成语。`;
    if (session.type === 'guess') return `🔢${labels[session.type]}进行中 · ${session.min}～${session.max}；无需 @，直接发数字。`;
    if (session.phase === 'answer') return `进行中：${labels[session.type]} · ${session.currentName || '参与者'} 正在回答；其他观众可发送「报名」排队。`;
    return `🎮${labels[session.type]}进行中 · 等待发送「报名」参加。`;
  }
  expire(now = this.now()) {
    const session = this.session;
    if (!session) return null;
    const limit = session.phase === 'answer' ? 60000 : 300000;
    if (now - session.lastAt < limit) return null;
    const label = { idiom:'成语接龙', truth:'真心话', dare:'大冒险', guess:'猜数字' }[session.type];
    this.reset();
    return `⏱️${label}因${session.phase === 'answer' ? '回答超时' : '长时间无人参与'}结束；发「开始${label}」再开一局。`;
  }
  startSession(type, name = '', userKey = '') {
    const now = this.now();
    if (this.session) return false;
    if (type === 'idiom') {
      this.chain = { word:'一心一意', used:new Set(['一心一意']), at:now };
      this.session = { type, word:'一心一意', used:new Set(['一心一意']), round:0, errors:0, lastAt:now, startedBy:userKey, startedByName:name };
    } else if (type === 'guess') {
      this.session = { type, min:1, max:20, target:1 + Math.floor(this.random() * 20), attempts:0, maxAttempts:6, lastAt:now, startedBy:userKey, startedByName:name };
    } else this.session = { type, phase:'join', lastAt:now, rounds:0, currentUserKey:'', currentName:'', prompt:'' , startedBy:userKey, startedByName:name };
    return true;
  }
  endSession() { const had = Boolean(this.session); this.reset(); return had; }
  gameType(text) {
    const token = String(text || '').trim().toLocaleLowerCase();
    if (/^(?:成语接龙|接龙|idiom)(?:游戏)?$/u.test(token)) return 'idiom';
    if (/^(?:猜数字|数字游戏|guess)(?:游戏)?$/u.test(token)) return 'guess';
    if (/^(?:真心话|truth)(?:游戏)?$/u.test(token)) return 'truth';
    if (/^(?:大冒险|dare)(?:游戏)?$/u.test(token)) return 'dare';
    return null;
  }
  startType(text) {
    const token = String(text || '').trim().replace(/^[：:、，,\s]+/u, '');
    const match = token.match(/^开始(?:玩|进行)?(?:游戏)?\s*(成语接龙|接龙|猜数字|数字游戏|真心话|大冒险|idiom|guess|truth|dare)(?:游戏)?$/iu);
    return match ? this.gameType(match[1]) : null;
  }
  format(body, maxLength, name = '', withName = true) {
    const prefix = withName && name ? `${botClip(String(name), 6)}，` : '';
    const full = prefix + body;
    return botLength(full) <= maxLength ? full : `${botClip(full, Math.max(1, maxLength - 1))}…`;
  }
  sessionReply(type, args, config, maxLength, name, userKey) {
    if (!config[`${type}Enabled`]) return { text:this.format('此互动已关闭，发「菜单」看可用玩法。', maxLength, name), commit:null };
    if (!this.session) {
      if (type === 'idiom' && args.length) {
        const candidate = args.join(''), tail = '意';
        const valid = idioms.has(candidate) && [...candidate][0] === tail;
        const body = valid
          ? `✅${candidate}，接得好！下接「${[...candidate].at(-1)}」。`
          : `🔤接龙开始！当前「一心一意」，请接「${tail}」开头；之后无需 @。`;
        return {
          text:this.format(body, maxLength, name),
          commit:()=>{
            this.startSession(type, name, userKey);
            if (valid) {
              const advance = this.idiomAttempt(candidate, config, maxLength, name);
              advance.commit?.();
            }
          }
        };
      }
      const body = type === 'idiom'
        ? '🔤接龙开始！当前「一心一意」，请接「意」开头；之后无需 @。'
        : type === 'guess'
          ? '🔢猜数字开始！答案在 1～20；无需 @，直接发数字，猜中即结束。'
          : `${type === 'truth' ? '💬真心话' : '🎭大冒险'}开始！发「报名」参加，回答限时 60 秒。`;
      return { text:this.format(body, maxLength, name), commit:()=>this.startSession(type, name, userKey) };
    }
    if (this.session.type !== type) return { text:this.format(this.sessionSummary(), maxLength, name), commit:null };
    if (type === 'idiom') {
      const word = args.join('');
      if (!word) return { text:this.format(`当前词「${this.session.word}」，请接「${[...this.session.word].at(-1)}」开头。`, maxLength, name), commit:null };
      return this.idiomAttempt(word, config, maxLength, name);
    }
    if (type === 'guess') return this.guessAttempt(args.join(''), maxLength, name);
    return this.truthAttempt(args.join(' '), userKey, name, type, maxLength);
  }
  idiomAttempt(word, config, maxLength, name) {
    const session = this.session;
    const tail = [...session.word].at(-1);
    let body, commit = null;
    const nextErrors = session.errors + 1;
    if (!idioms.has(word)) { body = `⚠️「${word}」未收录在本局词库（${nextErrors}/3）。`; }
    else if (session.used.has(word)) { body = `⚠️这个成语已用过（${nextErrors}/3）。`; }
    else if ([...word][0] !== tail) { body = `⚠️应接「${tail}」开头（${nextErrors}/3）。`; }
    else {
      body = `✅${word}，接得好！下接「${[...word].at(-1)}」。`;
      commit = () => {
        session.word = word; session.used.add(word); session.round++; session.errors = 0; session.lastAt = this.now();
        this.chain = { word, used:new Set(session.used), at:session.lastAt };
      };
    }
    if (!commit && nextErrors >= 3) {
      body += ' 本局结束，发「开始接龙」再来。';
      commit = () => this.reset();
    } else if (!commit) commit = () => { session.errors = nextErrors; session.lastAt = this.now(); };
    return { text:this.format(body, maxLength, name), commit };
  }
  truthAttempt(text, userKey, name, type, maxLength) {
    const session = this.session;
    const label = type === 'truth' ? '真心话' : '大冒险';
    const join = /^(?:报名|参加|我来|来|开始)$/u.test(text.trim());
    if (session.phase === 'join') {
      if (!join) return { text:null, handled:false };
      const list = type === 'truth' ? truths : dares;
      const prompt = list[Math.floor(this.random() * list.length)];
      return {
        text:this.format(`🙋${name || '这位观众'}报名！${label}：${prompt}（60秒内答，发「跳过」换下一位）`, maxLength, '', false),
        commit:()=>{ session.phase='answer'; session.currentUserKey=userKey; session.currentName=name || '观众'; session.prompt=prompt; session.lastAt=this.now(); }
      };
    }
    if (userKey !== session.currentUserKey) return { text:null, handled:false };
    if (!text.trim()) return { text:null, handled:false };
    const skipped = /^跳过|换一题|退出$/u.test(text.trim());
    const body = skipped ? `↪️${session.currentName}跳过，下一位发「报名」。` : `✅${session.currentName}回答收到！下一位发「报名」。`;
    return { text:this.format(body, maxLength, '', false), commit:()=>{ session.phase='join'; session.currentUserKey=''; session.currentName=''; session.prompt=''; session.rounds++; session.lastAt=this.now(); } };
  }
  guessAttempt(value, maxLength, name = '') {
    const session = this.session;
    const guess = Number.parseInt(String(value).trim(), 10);
    if (!Number.isInteger(guess) || guess < session.min || guess > session.max) return { text:this.format(`🔢请输入 ${session.min}～${session.max} 的整数。`, maxLength, name), commit:null };
    const attempts = session.attempts + 1;
    const prefix = name ? `${botClip(String(name), 6)}，` : '';
    if (guess === session.target) return {
      text:this.format(`🎉猜中啦！答案是 ${session.target}，共${attempts}次；发「开始猜数字」再来。`, maxLength, '', false),
      commit:()=>this.reset()
    };
    const left = session.maxAttempts - attempts;
    if (left <= 0) return {
      text:this.format(`💥本局结束，答案是 ${session.target}；发「开始猜数字」再来。`, maxLength, '', false),
      commit:()=>this.reset()
    };
    return {
      text:this.format(`${prefix}${guess > session.target ? '大了' : '小了'}～再猜！还剩${left}次。`, maxLength, '', false),
      commit:()=>{ session.attempts = attempts; session.lastAt = this.now(); }
    };
  }
  participate(text, user, config, maxLength) {
    const expired = this.expire();
    if (expired) return { handled:true, text:expired };
    const session = this.session;
    if (!session || !config[`${session.type}Enabled`]) return { handled:false };
    const value = String(text || '').trim();
    const key = user?.id || user?.secUid || `name:${user?.name || ''}`;
    if (session.type === 'idiom') {
      const candidate = value.replace(/^接龙[\s:：]*/u, '');
      const explicit = /^接龙[\s:：]/u.test(value);
      // 普通四字弹幕也可能是聊天内容；只有词库成语或明确带“接龙”前缀才消费。
      if (!candidate || (!idioms.has(candidate) && !explicit)) return { handled:false };
      const result = this.idiomAttempt(candidate, config, maxLength, user?.name || '');
      return { handled:true, text:result.text, commit:result.commit };
    }
    if (session.type === 'guess') {
      if (!/^[+-]?\d{1,3}$/u.test(value)) return { handled:false };
      const result = this.guessAttempt(value, maxLength, user?.name || '');
      return { handled:true, text:result.text, commit:result.commit };
    }
    const result = this.truthAttempt(value, key, user?.name || '', session.type, maxLength);
    // 只有报名、当前答题人回答或跳过才算游戏消息；无关弹幕必须继续流向关键词和 AI。
    if (result.text === null) return { handled:false };
    return { ...result, handled:true };
  }
  menu(config, maxLength, page = 1) {
    const short = maxLength < 18;
    const labels = BOT_COMMANDS.filter(item => config[item.key]).map(item => short ? item.aliases[0] : (item.menu || item.aliases[0]));
    if (!labels.length) return '📋互动未开启，请在设置打开玩法。';
    const pages = []; let part = '';
    // 给页码、分隔符和“下一页”提示预留空间，避免弹幕平台截掉操作引导。
    const capacity = short ? Math.max(2, maxLength - 10) : Math.max(2, maxLength - 22);
    for (const label of labels) {
      const next = part ? `${part}·${label}` : label;
      if (botLength(next) > capacity && part) { pages.push(part); part = label; } else part = next;
    }
    if (part) pages.push(part);
    const index = Math.min(Math.max(1, page), pages.length) - 1;
    const head = pages.length === 1 ? '🎮菜单：' : `🎮菜单${index+1}/${pages.length}：`;
    const guide = pages.length > 1 ? (index < pages.length - 1 ? `·发菜单${index + 2}看下页` : '·发菜单1回首页') : '·发菜单看用法';
    const full = `${head}${pages[index]}${guide}`;
    return botLength(full) <= maxLength ? full : `${botClip(`${head}${pages[index]}`, Math.max(1, maxLength - 1))}…`;
  }
  reply(command, config, maxLength, name, userKey = `name:${name || ''}`) {
    // @ 指令也要先处理房间会话超时，避免过期会话继续拦截“开始”或“状态”。
    this.expire();
    const text = command.trim().replace(/^\//, '');
    const [head = '', ...args] = text.split(/\s+/u), token = head.toLowerCase();
    let body, commit;
    const help = token.match(/^(?:菜单|帮助|menu|help)(\d*)$/u);
    const startType = this.startType(text);
    const explicitStop = /^(?:结束|停止|退出)(?:游戏|互动)?$/u.test(text);
    const status = /^(?:游戏状态|状态|进度)$/u.test(text);
    if (startType) return this.sessionReply(startType, [], config, maxLength, name, userKey);
    if (explicitStop) {
      body = this.session ? `${this.sessionSummary()} 已结束。` : '当前没有进行中的游戏。';
      commit = () => this.endSession();
    } else if (status) body = this.sessionSummary();
    else if (!head || help) body = this.menu(config, maxLength, Number(help?.[1] || args[0]) || 1);
    else {
      const item = BOT_COMMANDS.find(item => item.aliases.includes(token));
      if (!item) return null; // 普通提问由已启用的 AI 问答处理。
      if (!config[item.key]) body = '此互动已关闭，发「菜单」看可用玩法。';
      else if (item.key === 'diceEnabled') body = `🎲骰子：${1 + Math.floor(this.random() * 6)} 点`;
      else if (item.key === 'coinEnabled') body = `🪙硬币：${this.random() < 0.5 ? '正面' : '反面'}`;
      else if (item.key === 'choiceEnabled') {
        const choices = args.join(' ').split(/[\/|、，,]/u).map(s => s.trim()).filter(Boolean);
        body = choices.length < 2 || choices.length > 8 || choices.some(s => botLength(s) > 24)
          ? '用法：选择 唱歌/聊天（2～8项）'
          : `🎯帮你选：${choices[Math.floor(this.random() * choices.length)]}`;
      } else if (item.key === 'rpsEnabled') {
        const aliases = { '石头':'石头', '剪刀':'剪刀', '布':'布', 'rock':'石头', 'scissors':'剪刀', 'paper':'布' };
        const mine = aliases[String(args[0] || '').toLocaleLowerCase()];
        if (!mine) body = '用法：猜拳 石头/剪刀/布';
        else {
          const options = ['石头','剪刀','布'], bot = options[Math.floor(this.random() * options.length)];
          const result = mine === bot ? '平局' : ((mine === '石头' && bot === '剪刀') || (mine === '剪刀' && bot === '布') || (mine === '布' && bot === '石头') ? '你赢啦' : '我赢啦');
          body = `✊你${mine}｜我${bot}｜${result}`;
        }
      } else if (item.key === 'truthEnabled' || item.key === 'dareEnabled') {
        // 保留单次 @ 真心话/大冒险的快捷用法；明确发送“开始…”才创建房间会话。
        if (this.session?.type === (item.key === 'truthEnabled' ? 'truth' : 'dare')) {
          const result = this.truthAttempt(args.join(' '), userKey, name, item.key === 'truthEnabled' ? 'truth' : 'dare', maxLength);
          if (result.text === null) return null;
          return result;
        }
        body = (item.key === 'truthEnabled' ? truths : dares)[Math.floor(this.random() * (item.key === 'truthEnabled' ? truths : dares).length)];
      } else if (item.key === 'guessEnabled') {
        return this.sessionReply('guess', args, config, maxLength, name, userKey);
      }
      else {
        const result = this.sessionReply('idiom', args, config, maxLength, name, userKey);
        return result;
      }
    }
    const prefix = `${botClip(String(name || ''), 6)}，`;
    if (!help && head && name && botLength(prefix + body) <= maxLength) body = prefix + body;
    return { text:botLength(body) <= maxLength ? body : `${botClip(body, maxLength-1)}…`, commit };
  }
}
