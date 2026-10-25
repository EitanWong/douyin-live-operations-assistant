import { IDIOM_GAME_DEFAULTS, normalizeIdiom, lookupIdiom, idiomReading, looksLikeIdiomAnswer, randomIdiomSeed, createIdiomGame, attemptIdiomGame, idiomStandings, idiomGameResult, idiomMessagePages, idiomResultMessages, nextIdiomGame, idiomHintToken, idiomHintCandidate } from './idiom-game.js';
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
  { key:'idiomEnabled', label:'成语接龙', menu:'🔤接龙', example:'开始接龙', description:'全场接续、个人积分与冠军结算', aliases:['接龙','成语接龙','idiom'] },
  { key:'guessEnabled', label:'猜数字', menu:'🔢猜数字', example:'开始猜数字', description:'全场共猜，根据大小提示缩小范围', aliases:['猜数字','数字游戏','guess'] },
  { key:'truthEnabled', label:'真心话', menu:'💬真心话', example:'开始真心话', description:'轮流报名答题，主播与观众都能接话', aliases:['真心话','truth'] },
  { key:'dareEnabled', label:'大冒险', menu:'🎭大冒险', example:'开始大冒险', description:'轮流报名挑战，用文字或表情参与', aliases:['大冒险','dare'] }
];
const answerText = text => String(text || '').trim().replace(/^(?:(?:我来回答|我的回答|我的答案|回答|答案)(?:是)?[\s:：，,]*|答[\s:：，,]+)/u, '').trim();
const skipAnswer = text => /^(?:跳过(?:这题|这一题)?|换一题|换个题|换个问题|下一题|不回答|不想回答|不想说|不方便说|保密|退出|算了)(?:吧|了|啦|一下)?[。！!～~]*$/u.test(text);
const casualChat = text => /^(?:是的|是|嗯+|哦+|啊+|好(?:的|了)?|行|可以|收到|知道了|ok(?:了)?|再试一下\/?|有延迟|测试|哈哈+|[哈呵嘿]+|你好|来了|在吗|报名|参加|我来|来|开始|真心话|大冒险|菜单\d*|游戏状态|状态|进度)[\s。！!？?～~]*$/iu.test(text);
export class RoomBot {
  constructor({ now = Date.now, random = Math.random } = {}) { this.now = now; this.random = random; this.questionHistory = {truth:[],dare:[]}; this.lastIdiomResult = null; this.idiomSerial = 0; this.reset(); }
  reset() { this.chain = null; this.session = null; }
  sessionSummary() {
    if (!this.session) return this.lastIdiomResult ? idiomResultMessages(this.lastIdiomResult).join(' ') : '📍当前没有进行中的游戏。';
    const labels = { idiom:'成语接龙', truth:'真心话', dare:'大冒险', guess:'猜数字' };
    const session = this.session;
    if (session.type === 'idiom') return `🔤第${session.gameNumber}/${session.gamesToPlay}局「${session.word}」，接 ${idiomReading(session.word)}${session.nasalRelaxed ? '（前后鼻音通用）' : ''}；剩${session.maxAttempts-session.attempts}次${session.countCorrectOnly ? '答对' : '作答'}，答对+${session.pointsPerCorrect}分。`;
    if (session.type === 'guess') return `🔢${labels[session.type]}进行中 · ${session.min}～${session.max}；无需 @，直接发数字。`;
    if (session.phase === 'answer') return `${labels[session.type]}：${session.prompt} 主播和观众都可直接接话。`;
    return `🎮${labels[session.type]}进行中 · 等待发送「报名」参加。`;
  }
  expire(now = this.now()) {
    const session = this.session;
    if (!session) return null;
    // 接龙以作答次数或手动结束结算，等待期间不消耗次数。
    if (session.type === 'idiom') return null;
    const limit = session.phase === 'answer' ? 60000 : 300000;
    if (now - session.lastAt < limit) return null;
    const label = { idiom:'成语接龙', truth:'真心话', dare:'大冒险', guess:'猜数字' }[session.type];
    this.reset();
    return `⏱️${label}因${session.phase === 'answer' ? '回答超时' : '长时间无人参与'}结束；发「开始${label}」再开一局。`;
  }
  startSession(type, name = '', userKey = '', idiomSeed = '', config = IDIOM_GAME_DEFAULTS) {
    const now = this.now();
    if (this.session) return false;
    if (type === 'idiom') {
      const game = this.createIdiomSession(idiomSeed || this.randomIdiom(), name, userKey, config, now);
      if (!game) return false;
      this.lastIdiomResult = null;
      this.applyIdiomGame(game);
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
  randomIdiom() { return randomIdiomSeed(this.random); }
  createIdiomSession(word, name, userKey, config, now = this.now()) {
    const game = createIdiomGame(word, name, userKey, config, now);
    if (game) game.sessionId = `${now}:${++this.idiomSerial}`;
    return game;
  }
  isIdiomHintCommand(text) { return /^(?:接龙[\s:：]*)?(?:提示|求提示|给个提示|给我提示|下一条提示|接龙提示)[！!。？?]*$/u.test(String(text || '').trim()); }
  hintToken() { return idiomHintToken(this.session); }
  idiomHint(maxLength, automatic = false) {
    const session=this.session, now=this.now();
    if (session?.type !== 'idiom') return automatic ? null : this.idiomReplyMessages(['当前没有成语接龙，发「开始接龙」开局。'],maxLength);
    if (!session.hintsEnabled) return automatic ? null : this.idiomReplyMessages(['本场接龙未开启提示。'],maxLength);
    if (session.hintLevel>=3) return automatic ? null : {...this.idiomReplyMessages([`已给出完整示例「${session.hintWord}」，直接发送即可接龙。`],maxLength),hintToken:idiomHintToken(session)};
    const lastHint=session.lastHintAt;
    if (automatic && now-(lastHint ?? session.lastProgressAt)<session.hintIntervalSec*1000) return null;
    if (!automatic && lastHint !== null && now-lastHint<5000) return this.idiomReplyMessages(['刚给过提示，5秒后可再求提示；提示不扣分、不计次。'],maxLength);
    const word=idiomHintCandidate(session);
    if (!word) return automatic ? null : this.idiomReplyMessages(['当前暂无未使用的可接成语。'],maxLength);
    const level=session.hintLevel+1, chars=[...word], token=idiomHintToken(session);
    const shown=level>=3 ? word : chars.map((char,index)=>index<(level===1 ? 1 : Math.max(1,Math.min(2,chars.length-1))) ? char : '□').join('');
    const message=level===3 ? `💡提示3：示例「${word}」，直接发出可接龙。` : `💡提示${level}：可接「${shown}」（${chars.length}字）；发「提示」继续。`;
    return {...this.idiomReplyMessages([message],maxLength,()=>{
      if (this.session!==session || idiomHintToken(session)!==token || session.hintLevel!==level-1) return;
      session.hintLevel=level; session.hintWord=word; session.lastHintAt=now;
    }), hintToken:token};
  }
  applyIdiomGame(game) {
    this.session = game;
    this.chain = {word:game.word, used:new Set(game.used), at:game.lastAt};
  }
  restoreIdiomGame(saved, config) {
    const game = this.createIdiomSession(saved.word, saved.startedByName, saved.startedBy, config, saved.lastAt);
    if (!game) { this.reset(); return; }
    Object.assign(game, saved, {used:new Set([...saved.used || []].filter(word => lookupIdiom(word))),
      players:Array.isArray(saved.players) ? saved.players.map(player=>({...player,incorrect:player.incorrect || 0})) : [],
      // Existing games retain their original rules when upgraded mid-game.
      nasalRelaxed:saved.nasalRelaxed ?? false, countCorrectOnly:saved.countCorrectOnly ?? false,
      penalty:saved.penalty ?? 0, gamesToPlay:saved.gamesToPlay ?? 1,
      totalAttempts:saved.totalAttempts ?? saved.attempts ?? (saved.round || 0)+(saved.errors || 0),
      totalCorrect:saved.totalCorrect ?? saved.round ?? 0, lastProgressAt:saved.lastProgressAt ?? saved.lastAt,
      maxAttempts:saved.maxAttempts ?? game.maxAttempts, pointsPerCorrect:saved.pointsPerCorrect ?? game.pointsPerCorrect,
      attempts:saved.attempts ?? Math.min(game.maxAttempts - 1, (saved.round || 0) + (saved.errors || 0))});
    game.used.add(game.word);
    this.applyIdiomGame(game);
  }
  idiomScores() { return idiomStandings(this.session?.type === 'idiom' ? this.session : this.lastIdiomResult); }
  idiomReplyMessages(messages, maxLength, commit = null) {
    const pages = idiomMessagePages(messages, maxLength);
    return {text:pages[0], messages:pages.slice(1), localOnly:true, commit};
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
        const game = this.createIdiomSession(this.randomIdiom(), name, userKey, config);
        const candidate = args.join('');
        if (candidate) return this.idiomAttempt(candidate, config, maxLength, name, userKey, game);
        return this.idiomReplyMessages([
          `🔤接龙开始！1/${game.gamesToPlay}局「${game.word}」接${idiomReading(game.word)}；${game.maxAttempts}次${game.countCorrectOnly ? '答对' : '作答'}，对+${game.pointsPerCorrect}/错-${game.penalty}分${game.hintsEnabled ? '；发「提示」' : ''}。`
        ], maxLength, () => { if (!this.session) { this.lastIdiomResult=null; this.applyIdiomGame(game); } });
      }
      const body = type === 'guess'
        ? '🔢猜数字开始！答案在 1～20；无需 @，直接发数字，猜中即结束。'
        : `${type === 'truth' ? '💬真心话' : '🎭大冒险'}开始！发「报名」参加，回答限时 60 秒。`;
      return { text:this.format(body, maxLength, name), commit:()=>this.startSession(type, name, userKey) };
    }
    if (this.session.type !== type) return { text:this.format(this.sessionSummary(), maxLength, name), commit:null };
    if (type === 'idiom') {
      const word = args.join('');
      if (this.isIdiomHintCommand(word)) return this.idiomHint(maxLength);
      if (!word) return this.idiomReplyMessages([`当前词「${this.session.word}」，接 ${idiomReading(this.session.word)}，剩${this.session.maxAttempts-this.session.attempts}次。`], maxLength);
      return this.idiomAttempt(word, config, maxLength, name, userKey);
    }
    if (type === 'guess') return this.guessAttempt(args.join(''), maxLength, name);
    return this.truthAttempt(args.join(' '), userKey, name, type, maxLength);
  }
  idiomAttempt(input, config, maxLength, name, userKey = `name:${name || ''}`, initialGame = null) {
    const session = initialGame || this.session, previousAttempts = session.totalAttempts;
    const {next, reason, finished, pointsDelta} = attemptIdiomGame(session, input, userKey, name, this.now());
    const left = next.maxAttempts - next.attempts;
    const player = next.players.find(item => item.key === userKey);
    const body = reason === 'unknown' ? '⚠️未在成语词典收录，请换一个成语。'
      : reason === 'repeated' ? '⚠️这个成语已用过，请换一个。'
      : reason === 'mismatch' ? `⚠️应接 ${idiomReading(session.word)}，声调不限。`
      : `✅${next.word}，+${next.pointsPerCorrect}分（共${player.points}分）！接 ${idiomReading(next.word)}。`;
    const continuing=finished && next.gameNumber<next.gamesToPlay;
    const continuation=continuing ? nextIdiomGame(next,this.randomIdiom(),this.now()) : null;
    const result = finished && !continuing ? idiomGameResult(next, finished, this.now()) : null;
    const penaltyText=reason ? (next.penalty ? `扣${-pointsDelta}分，现${player.points}分。` : '不扣分。') : '';
    return {...this.idiomReplyMessages([
      ...(initialGame && reason ? [`🔤起始「${session.word}」，接 ${idiomReading(session.word)}。`] : []),
      `${name ? botClip(name,6)+'，' : ''}${body}${penaltyText}剩${left}次${next.countCorrectOnly ? '答对' : ''}。`,
      ...(continuation ? [`第${next.gameNumber}局结束（${finished}），积分累计；第${continuation.gameNumber}/${continuation.gamesToPlay}局「${continuation.word}」，接 ${idiomReading(continuation.word)}。`] : []),
      ...(result ? idiomResultMessages(result) : [])], maxLength, () => {
      if (initialGame ? Boolean(this.session) : this.session !== session || session.totalAttempts !== previousAttempts) return;
      if (initialGame) this.lastIdiomResult=null;
      if (result) { this.lastIdiomResult=result; this.reset(); }
      else { Object.assign(session, continuation || next); this.applyIdiomGame(session); }
    }), persistent:Boolean(finished)};
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
    // @ 提问可与游戏并行；除显式“回答：”外，不将新的聊天问题当作答题。
    if (addressed && answer === value && /[?？]|怎么|如何|几点|什么时候|多少钱|天气/u.test(value)) return false;
    if (userKey === session.currentUserKey || addressed || answer !== value || /^(?:我也|我的(?:梦想|理想|心情)|对我来说)/u.test(value)) return true;
    const topic = INTERACTION_TOPICS[this.questionFor(session)?.category];
    if (topic?.match.test(value)) return true;
    // 当前题目下允许其他人用歌名、地名、表情或简短口语直接接话。
    // 明显在问直播安排/操作问题的消息继续走普通聊天，避免抢答。
    return botLength(answer) <= 24 && !/[?？]|几点|什么时候|下播|开播|卡了|延迟|测试|怎么|如何|在吗|链接|多少钱/u.test(answer);
  }
  answerFeedback(text, name, session) {
    const answer = answerText(text);
    const category = this.questionFor(session)?.category;
    const topic = INTERACTION_TOPICS[session.type === 'dare' ? 'creative' : category];
    let choices = topic ? [topic.feedback, ...topic.alternatives] : ['收到，想接着聊就说。', '嗯，听你说。', '好，其他人也可以接着聊。'];
    if (session.type === 'truth' && session.prompt === '你小时候的梦想是什么？') choices = ['原来你小时候是这样想的。', '这个梦想，现在还惦记着吗？', '小时候的梦想，长大了想法也可能会变。'];
    if (session.type === 'truth' && category === 'dream' && /明星|歌手|演员/u.test(answer)) choices = ['原来有个舞台梦呀。', '有个舞台梦，你更想唱歌还是演戏？', '舞台梦呀，现在还想试试吗？'];
    // 同类回答也换换说法；只取答案的散列，不影响游戏结果的随机数。
    let hash = 0;
    for (const char of answer) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    const reaction = choices[hash % choices.length];
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
      if (this.isIdiomHintCommand(value)) return {...this.idiomHint(maxLength),handled:true};
      const candidate = value.replace(/^接龙[\s:：]*/u, '');
      const explicit = /^接龙[\s:：]/u.test(value);
      // Known idioms and explicit attempts receive a verdict. Unrelated chat passes through.
      const normalized = normalizeIdiom(candidate);
      if (!candidate || (!lookupIdiom(normalized) && !looksLikeIdiomAnswer(normalized, session.word,session.nasalRelaxed) && !explicit)) return { handled:false };
      const result = this.idiomAttempt(normalized, config, maxLength, user?.name || '', key);
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
    const commands = BOT_COMMANDS.filter(item => config[item.key]);
    const labels = commands.map(item => short ? item.aliases[0] : (item.menu || item.aliases[0]));
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
    const guide = pages.length > 1 ? (index < pages.length - 1 ? `·发菜单${index + 2}看下页` : '·发菜单1回首页') : `·发「${commands[0].example}」`;
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
    if (this.isIdiomHintCommand(text) && config.idiomEnabled) return this.idiomHint(maxLength);
    if (startType) return this.sessionReply(startType, [], config, maxLength, name, userKey);
    if (!explicitStop && !status && !help && this.session?.type === 'idiom' && (lookupIdiom(text) || looksLikeIdiomAnswer(normalizeIdiom(text), this.session.word, this.session.nasalRelaxed) || /^接龙[\s:：]/u.test(text))) {
      return this.sessionReply('idiom', [text.replace(/^接龙[\s:：]*/u, '')], config, maxLength, name, userKey);
    }
    if (explicitStop) {
      if (this.session?.type === 'idiom') {
        const session=this.session, result=idiomGameResult(session, '手动结束', this.now());
        return {...this.idiomReplyMessages(idiomResultMessages(result), maxLength, () => { if (this.session === session) { this.lastIdiomResult=result; this.endSession(); } }), persistent:true};
      }
      body = this.session ? `${this.sessionSummary()} 已结束。` : '当前没有进行中的游戏。';
      commit = () => this.endSession();
    } else if (status) {
      if (this.session?.type === 'idiom' || this.lastIdiomResult) return this.idiomReplyMessages([this.sessionSummary()], maxLength);
      body = this.sessionSummary();
    }
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
      else if (item.key === 'truthEnabled' || item.key === 'dareEnabled') {
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
