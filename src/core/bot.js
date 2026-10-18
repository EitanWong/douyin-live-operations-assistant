import { TRUTH_QUESTIONS, DARE_QUESTIONS, INTERACTION_TOPICS } from '../data/interaction-questions.js';

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
const answerText = text => String(text || '').trim().replace(/^(?:(?:我来回答|我的回答|我的答案|回答|答案)(?:是)?[\s:：，,]*|答[\s:：，,]+)/u, '').trim();
const skipAnswer = text => /^(?:跳过(?:这题|这一题)?|换一题|换个题|换个问题|下一题|不回答|不想回答|不想说|不方便说|保密|退出|算了)(?:吧|了|啦|一下)?[。！!～~]*$/u.test(text);
const casualChat = text => /^(?:是的|是|嗯+|哦+|啊+|好(?:的|了)?|行|可以|收到|知道了|ok(?:了)?|再试一下\/?|有延迟|测试|哈哈+|[哈呵嘿]+|你好|来了|在吗|报名|参加|我来|来|开始|真心话|大冒险|菜单\d*|游戏状态|状态|进度)[\s。！!？?～~]*$/iu.test(text);
// Keep a local lexicon of common idioms so ordinary four-character chat is not treated as a move.
const idioms = new Set(('一心一意 意气风发 发扬光大 大有可为 为所欲为 为人师表 表里如一 一马当先 先声夺人 人山人海 海阔天空 空前绝后 后来居上 上善若水 水到渠成 成千上万 万众一心 心想事成 成人之美 美不胜收 收放自如 如鱼得水 水落石出 出生入死 死里逃生 生龙活虎 虎头蛇尾 尾大不掉 掉以轻心 心花怒放 放任自流 流连忘返 返老还童 童叟无欺 欺人太甚 甚嚣尘上 上下同心 心平气和 和气生财 财源广进 进退两难 难能可贵 贵人多忘 忘乎所以 以德报怨 怨天尤人 人定胜天 天长地久 久别重逢 逢凶化吉 吉星高照 照本宣科 科班出身 身体力行 行云流水 水深火热 热火朝天 天南地北 北雁南飞 飞黄腾达 达官贵人 人才辈出 出人头地 地久天长 长驱直入 入木三分 入不敷出 出谋划策 策马扬鞭 鞭长莫及 及锋而试 拭目以待 待人接物 物极必反 反客为主 主客颠倒 倒背如流 分秒必争 争先恐后 后起之秀 秀外慧中 中流砥柱 新陈代谢 岁月如梭 梭天摸地 地大物博 博大精深 深入浅出 出类拔萃 萃取精华 华而不实 实事求是 是非分明 明哲保身 身经百战 战无不胜 胜券在握 握手言欢 欢天喜地 地久天长 长治久安 安居乐业 业精于勤 勤能补拙 拙嘴笨舌 舌战群儒 儒雅风流 流芳百世 世外桃源 源远流长 长驱直入').split(' '));

// Tone is omitted. Similar initials/finals (for example sh/s and in/ing) are accepted.
const pinyinByChar = new Map(Object.entries({
  一:'yi',万:'wan',上:'shang',中:'zhong',为:'wei',久:'jiu',争:'zheng',人:'ren',以:'yi',先:'xian',入:'ru',出:'chu',分:'fen',北:'bei',发:'fa',吉:'ji',后:'hou',和:'he',地:'di',大:'da',天:'tian',如:'ru',尾:'wei',心:'xin',忘:'wang',怨:'yuan',意:'yi',成:'cheng',掉:'diao',收:'shou',放:'fang',柱:'zhu',欺:'qi',死:'si',水:'shui',流:'liu',海:'hai',热:'re',照:'zhao',甚:'shen',生:'sheng',秀:'xiu',科:'ke',空:'kong',童:'tong',美:'mei',虎:'hu',行:'xing',表:'biao',财:'cai',贵:'gui',身:'shen',达:'da',返:'fan',进:'jin',逢:'feng',长:'chang',难:'nan',飞:'fei',新:'xin',谢:'xie',岁:'sui',月:'yue',梭:'suo',敷:'fu',谋:'mou',策:'ce',扬:'yang',鞭:'bian',及:'ji',锋:'feng',试:'shi',拭:'shi',目:'mu',待:'dai',物:'wu',极:'ji',反:'fan',客:'ke',主:'zhu',倒:'dao',背:'bei',博:'bo',深:'shen',浅:'qian',拔:'ba',萃:'cui',华:'hua',实:'shi',是:'shi',哲:'zhe',保:'bao',经:'jing',战:'zhan',胜:'sheng',券:'quan',握:'wo',欢:'huan',芳:'fang',世:'shi',源:'yuan',治:'zhi',安:'an',居:'ju',乐:'le',勤:'qin',补:'bu',拙:'zhuo',嘴:'zui',舌:'she',儒:'ru',雅:'ya'
}));
const pinyinInitial = value => value.match(/^(zh|ch|sh|[bpmfdtnlgkhjqxrzcswy])?/u)?.[0] || '';
const pinyinFinal = value => value.slice(pinyinInitial(value).length);
const nearPinyin = (left, right) => {
  if (!left || !right) return false;
  if (left === right) return true;
  const initials = value => ({ zh:'z', ch:'c', sh:'s', n:'l' })[pinyinInitial(value)] || pinyinInitial(value);
  const finals = value => ({ ang:'an', eng:'en', ing:'in', ui:'ei' })[pinyinFinal(value)] || pinyinFinal(value);
  return initials(left) === initials(right) && finals(left) === finals(right);
};
const soundsLike = (left, right) => left === right || nearPinyin(pinyinByChar.get(left), pinyinByChar.get(right));
const isFourChinese = value => /^[\u4e00-\u9fff]{4}$/u.test(String(value || ''));
const playableIdioms = [...idioms].filter(word => [...idioms].some(next => next !== word && soundsLike([...next][0], [...word].at(-1))));

export class RoomBot {
  constructor({ now = Date.now, random = Math.random } = {}) { this.now = now; this.random = random; this.questionHistory = {truth:[],dare:[]}; this.reset(); }
  reset() { this.chain = null; this.session = null; }
  sessionSummary() {
    if (!this.session) return '📍当前没有进行中的游戏。';
    const labels = { idiom:'成语接龙', truth:'真心话', dare:'大冒险', guess:'猜数字' };
    const session = this.session;
    if (session.type === 'idiom') return `🔤${labels[session.type]}进行中 · 当前「${session.word}」；无需 @，直接发成语。`;
    if (session.type === 'guess') return `🔢${labels[session.type]}进行中 · ${session.min}～${session.max}；无需 @，直接发数字。`;
    if (session.phase === 'answer') return `${labels[session.type]}：${session.prompt} 主播和观众都可直接接话。`;
    return `🎮${labels[session.type]}进行中 · 等待发送「报名」参加。`;
  }
  expire(now = this.now()) {
    const session = this.session;
    if (!session) return null;
    // 成语接龙是房间级持续玩法，直到主持人明确结束；其他游戏仍使用超时回收。
    if (session.type === 'idiom') return null;
    const limit = session.phase === 'answer' ? 60000 : 300000;
    if (now - session.lastAt < limit) return null;
    const label = { idiom:'成语接龙', truth:'真心话', dare:'大冒险', guess:'猜数字' }[session.type];
    this.reset();
    return `⏱️${label}因${session.phase === 'answer' ? '回答超时' : '长时间无人参与'}结束；发「开始${label}」再开一局。`;
  }
  startSession(type, name = '', userKey = '', idiomSeed = '') {
    const now = this.now();
    if (this.session) return false;
    if (type === 'idiom') {
      const word = idiomSeed || this.randomIdiom();
      this.chain = { word, used:new Set([word]), at:now };
      this.session = { type, word, used:new Set([word]), round:0, errors:0, lastAt:now, startedBy:userKey, startedByName:name };
    } else if (type === 'guess') {
      this.session = { type, min:1, max:20, target:1 + Math.floor(this.random() * 20), attempts:0, maxAttempts:6, lastAt:now, startedBy:userKey, startedByName:name };
    } else this.session = { type, phase:'join', lastAt:now, rounds:0, currentUserKey:'', currentName:'', prompt:'' , startedBy:userKey, startedByName:name };
    return true;
  }
  questionBank(type) { return type === 'truth' ? TRUTH_QUESTIONS : DARE_QUESTIONS; }
  pickQuestion(type, maxLength = 50) {
    const bank = this.questionBank(type).filter(item => botLength(item.prompt) <= maxLength), history = this.questionHistory[type] || [];
    let available = bank.filter(item => !history.includes(item.id));
    if (!available.length) available = bank.filter(item => item.id !== history.at(-1));
    const random = Number(this.random());
    const index = Math.floor(Math.max(0, Math.min(0.999999999, Number.isFinite(random) ? random : 0)) * available.length);
    return available[index] || bank[0];
  }
  questionMessage(prompt, name, maxLength, room = false) {
    const prefix = name ? `${botClip(name, 6)}，` : '';
    const base = botLength(prefix + prompt) <= maxLength ? prefix + prompt : prompt;
    const guide = room ? '（60秒内答，可跳过）' : '（直接回答或说「跳过」）';
    return botLength(base + guide) <= maxLength - 6 ? base + guide : base;
  }
  rememberQuestion(type, question) {
    const bank = this.questionBank(type);
    let history = this.questionHistory[type] || [];
    if (history.length >= bank.length || history.includes(question.id)) history = [];
    this.questionHistory[type] = [...history, question.id];
  }
  questionFor(session) {
    return this.questionBank(session.type).find(item => item.id === session.questionId || item.prompt === session.prompt);
  }
  randomIdiom() {
    const random = Number(this.random());
    const index = Math.floor(Math.max(0, Math.min(0.999999999, Number.isFinite(random) ? random : 0)) * playableIdioms.length);
    return playableIdioms[index] || '一心一意';
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
      if (type === 'idiom') {
        const seed = this.randomIdiom();
        const tail = [...seed].at(-1);
        const candidate = args.join('');
        const valid = Boolean(candidate) && (idioms.has(candidate) || isFourChinese(candidate)) && soundsLike([...candidate][0], tail);
        const body = valid
          ? `✅${candidate}，接得好！下接「${[...candidate].at(-1)}」。`
          : `🔤接龙开始！随机起始「${seed}」，请接「${tail}」开头或近音；之后无需 @。`;
        return {
          text:this.format(body, maxLength, name),
          commit:()=>{
            this.startSession(type, name, userKey, seed);
            if (valid) {
              const advance = this.idiomAttempt(candidate, config, maxLength, name);
              advance.commit?.();
            }
          }
        };
      }
      const body = type === 'guess'
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
    if (!idioms.has(word) && !isFourChinese(word)) { body = `⚠️「${word}」请发四字成语，本局继续。`; }
    else if (session.used.has(word)) { body = `⚠️这个成语已用过，本局继续。`; }
    else if (!soundsLike([...word][0], tail)) { body = `⚠️应接「${tail}」开头或近音，本局继续。`; }
    else {
      body = `✅${word}，接得好！下接「${[...word].at(-1)}」。`;
      commit = () => {
        session.word = word; session.used.add(word); session.round++; session.errors = 0; session.lastAt = this.now();
        this.chain = { word, used:new Set(session.used), at:session.lastAt };
      };
    }
    if (!commit) commit = () => { session.errors = Math.min(3, session.errors + 1); session.lastAt = this.now(); };
    return { text:this.format(body, maxLength, name), commit };
  }
  truthAttempt(text, userKey, name, type, maxLength, addressed = false) {
    const session = this.session;
    const label = type === 'truth' ? '真心话' : '大冒险';
    const join = /^(?:报名|参加|我来|来|开始)(?:一个|一下|吧|啦)?[！!。～~]*$/u.test(text.trim());
    if (session.phase === 'join') {
      if (!join) return { text:null, handled:false };
      const question = this.pickQuestion(type, maxLength), prompt = question.prompt;
      return {
        text:this.questionMessage(prompt, name, maxLength, true),
        commit:()=>{ this.rememberQuestion(type, question); session.questionId=question.id; session.phase='answer'; session.currentUserKey=userKey; session.currentName=name || '观众'; session.prompt=prompt; session.lastAt=this.now(); }
      };
    }
    if (!this.acceptsAnswer(text, userKey, addressed)) return { text:null, handled:false };
    const skipped = skipAnswer(answerText(text));
    const next = session.quick ? `再玩请 @我发「${label}」。` : '下一位发「报名」。';
    const body = skipped ? `↪️${name || session.currentName}跳过，${next}` : this.answerFeedback(text, name || session.currentName, session);
    return { text:this.format(body + (skipped || session.quick ? '' : ` ${next}`), maxLength, '', false),
      ai:skipped ? undefined : { mode:'feedback', question:session.prompt, answer:answerText(text), type:session.type, name:name || session.currentName, next:session.quick ? '' : next }, commit:()=>{
      if (session.quick) { this.reset(); return; }
      session.phase='join'; session.currentUserKey=''; session.currentName=''; session.prompt=''; session.rounds++; session.lastAt=this.now();
    } };
  }
  acceptsAnswer(text, userKey, addressed = false) {
    const session = this.session;
    if (!session || !['truth','dare'].includes(session.type) || session.phase !== 'answer' || this.now() - session.lastAt >= 60000) return false;
    const value = String(text || '').trim();
    if (!value) return false;
    if (skipAnswer(answerText(value))) return userKey === session.currentUserKey;
    // 是非题的「是的/嗯」和挑战的「好了」也是有效回答；开放题仍忽略调试确认。
    const confirmation = /^(?:是的|是|嗯+|有(?:的|过)?|没有(?:过)?|会|不会|对(?:的)?|不是|当然)[。！!～~]*$/u.test(value);
    if (session.type === 'truth' && /(?:吗|过)[？?]$|有没有/u.test(session.prompt) && confirmation) return true;
    if (session.type === 'dare' && /^(?:好了|好啦|可以了|已?完成了?|搞定了?|做完了)[。！!～~]*$/u.test(value)) return true;
    if (casualChat(value) || this.startType(value) || /^(?:结束|停止)(?:游戏|互动)?$/u.test(value) || /^@/u.test(value)) return false;
    const answer = answerText(value);
    if (!answer || !/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(answer)) return false;
    if (userKey === session.currentUserKey || addressed || answer !== value || /^(?:我也|我的(?:梦想|理想|心情)|对我来说)/u.test(value)) return true;
    const topic = INTERACTION_TOPICS[this.questionFor(session)?.category];
    if (topic?.match.test(value)) return true;
    // 当前题目下允许其他人用歌名、地名、表情或简短口语直接接话。
    // 明显在问直播安排/操作问题的消息继续走普通聊天，避免抢答。
    return botLength(answer) <= 24 && !/[?？]|几点|什么时候|下播|开播|卡了|延迟|测试|怎么|如何|在吗|链接|多少钱/u.test(answer);
  }
  answerFeedback(text, name, session) {
    const answer = answerText(text);
    let reaction;
    if (session.type === 'dare') reaction = `收到「${botClip(answer, 10)}」，谢谢你参与挑战👏`;
    else if (this.questionFor(session)?.category === 'dream' && /明星|歌手|演员/u.test(answer)) reaction = '有个舞台梦呀，愿你一直闪闪发光✨';
    else {
      const category = this.questionFor(session)?.category;
      const thanks = category === 'dream' && session.prompt !== '你小时候的梦想是什么？' ? '谢谢你分享心里的愿望✨' : INTERACTION_TOPICS[category]?.feedback || '谢谢你认真分享✨';
      reaction = `收到「${botClip(answer, 10)}」，${thanks}`;
    }
    return `${botClip(String(name || '朋友'), 6)}，${reaction}`;
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
      // Any viewer, including the host, can play without @. Unknown four-character words
      // are accepted when their first character matches the current tail; unrelated chat passes through.
      const tail = [...session.word].at(-1);
      const matchingShape = isFourChinese(candidate) && soundsLike([...candidate][0], tail);
      if (!candidate || (!idioms.has(candidate) && !matchingShape && !explicit)) return { handled:false };
      const result = this.idiomAttempt(candidate, config, maxLength, user?.name || '');
      return { ...result, handled:true };
    }
    if (session.type === 'guess') {
      if (!/^[+-]?\d{1,3}$/u.test(value)) return { handled:false };
      const result = this.guessAttempt(value, maxLength, user?.name || '');
      return { ...result, handled:true };
    }
    const result = this.truthAttempt(value, key, user?.name || '', session.type, maxLength);
    // 报名、自然回答或跳过才算游戏消息；无关弹幕继续流向关键词和 AI。
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
    const help = token.match(/^菜单(\d*)$/u);
    const startType = this.startType(text);
    const explicitStop = /^(?:结束|停止|退出)(?:游戏|互动)?$/u.test(text);
    const status = /^(?:游戏状态|状态|进度)$/u.test(text);
    if (startType) return this.sessionReply(startType, [], config, maxLength, name, userKey);
    if (!explicitStop && !status && !help && this.session?.type === 'idiom' && (idioms.has(text) || isFourChinese(text) || /^接龙[\s:：]/u.test(text))) {
      return this.sessionReply('idiom', [text.replace(/^接龙[\s:：]*/u, '')], config, maxLength, name, userKey);
    }
    if (explicitStop) {
      body = this.session ? `${this.sessionSummary()} 已结束。` : '当前没有进行中的游戏。';
      commit = () => this.endSession();
    } else if (status) body = this.sessionSummary();
    else if (help) body = this.menu(config, maxLength, Number(help[1] || args[0]) || 1);
    else {
      const item = BOT_COMMANDS.find(item => item.aliases.includes(token));
      if (!item) {
        if (this.acceptsAnswer(text, userKey, true) && config[`${this.session.type}Enabled`]) {
          // @ 后的自然回答与免 @ 回答使用同一条反馈路径。
          return this.truthAttempt(text, userKey, name, this.session.type, maxLength, true);
        }
        return null;
      }
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
        const type = item.key === 'truthEnabled' ? 'truth' : 'dare';
        if (this.session?.type === type) {
          if (!args.length) return { text:this.format(this.session.phase === 'answer' ? `${this.session.currentName}，${this.session.prompt}（直接回答即可）` : this.sessionSummary(), maxLength), commit:null };
          const result = this.truthAttempt(args.join(' '), userKey, name, type, maxLength);
          if (result.text === null) return null;
          return result;
        }
        if (this.session) return { text:this.format(this.sessionSummary(), maxLength, name), commit:null };
        const question = this.pickQuestion(type, maxLength), prompt = question.prompt;
        return { text:this.questionMessage(prompt, name, maxLength), commit:()=>{
          this.startSession(type, name, userKey);
          this.rememberQuestion(type, question);
          Object.assign(this.session, {phase:'answer',quick:true,currentUserKey:userKey,currentName:name,prompt,questionId:question.id});
        } };
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
    return { text:botLength(body) <= maxLength ? body : `${botClip(body, maxLength-1)}…`, commit, localOnly:Boolean(help || status || explicitStop || body.includes('此互动已关闭')) };
  }
}
