import { IDIOM_DATA } from '../data/idioms.js';

// O(1) dictionary lookup; pronunciation belongs to the idiom, not an isolated character.
const idiomLexicon = new Map();
const idiomStarts = new Map();
const idiomNasalStarts = new Map();
const idiomInitialReadings = new Map();
const idiomNasalKey = value => value.replace(/ang$/u,'an').replace(/eng$/u,'en').replace(/ing$/u,'in');
for (const row of IDIOM_DATA.split('\n')) {
  const [word, first, last] = row.split(' ');
  idiomLexicon.set(word, { first, last });
  if (!idiomStarts.has(first)) idiomStarts.set(first, []);
  idiomStarts.get(first).push(word);
  const nasal = idiomNasalKey(first);
  if (!idiomNasalStarts.has(nasal)) idiomNasalStarts.set(nasal, []);
  idiomNasalStarts.get(nasal).push(word);
  const char = [...word][0];
  if (!idiomInitialReadings.has(char)) idiomInitialReadings.set(char, new Set());
  idiomInitialReadings.get(char).add(first);
}

export const IDIOM_GAME_DEFAULTS = {
  idiomMaxAttempts:20, idiomGames:1, idiomPoints:10, idiomPenalty:2,
  idiomNasalRelaxed:true, idiomCountCorrectOnly:true, idiomHintsEnabled:true, idiomHintIntervalSec:30
};
export const normalizeIdiom = value => String(value || '').trim().replace(/[，,、；;。！!？?·\s]/gu, '');
export const lookupIdiom = value => idiomLexicon.get(normalizeIdiom(value));
export const idiomReading = word => lookupIdiom(word)?.last || '';
const idiomSoundsEqual = (left, right, relaxed) => relaxed ? idiomNasalKey(left) === idiomNasalKey(right) : left === right;
export const idiomConnects = (previous, next, relaxed = true) => Boolean(lookupIdiom(previous) && lookupIdiom(next) && idiomSoundsEqual(lookupIdiom(previous).last, lookupIdiom(next).first, relaxed));
const idiomSuccessors = (word, relaxed) => relaxed ? idiomNasalStarts.get(idiomNasalKey(idiomReading(word))) || [] : idiomStarts.get(idiomReading(word)) || [];
export const hasIdiomSuccessor = (word, used = new Set([word]), relaxed = true) => idiomSuccessors(word, relaxed).some(next => !used.has(next));
export const looksLikeIdiomAnswer = (word, previous, relaxed = true) => /^[\u4e00-\u9fff]{4}$/u.test(word) && [...idiomInitialReadings.get([...word][0]) || []].some(reading => idiomSoundsEqual(reading,idiomReading(previous),relaxed));
const idiomSeeds = '一心一意 一马当先 人山人海 海阔天空 水到渠成 生龙活虎 心想事成 万众一心 身体力行 行云流水 出类拔萃 博大精深 安居乐业 欢天喜地 源远流长 长驱直入'.split(' ').filter(word => lookupIdiom(word) && hasIdiomSuccessor(word));
export function randomIdiomSeed(random) {
  const number = Number(random());
  return idiomSeeds[Math.floor(Math.max(0, Math.min(0.999999999, Number.isFinite(number) ? number : 0)) * idiomSeeds.length)];
}

export function createIdiomGame(word, name, userKey, config, now) {
  if (!lookupIdiom(word)) return null;
  return { type:'idiom', word:normalizeIdiom(word), used:new Set([normalizeIdiom(word)]), round:0, errors:0,
    attempts:0, maxAttempts:config.idiomMaxAttempts ?? IDIOM_GAME_DEFAULTS.idiomMaxAttempts,
    pointsPerCorrect:config.idiomPoints ?? IDIOM_GAME_DEFAULTS.idiomPoints,
    penalty:config.idiomPenalty ?? IDIOM_GAME_DEFAULTS.idiomPenalty,
    nasalRelaxed:config.idiomNasalRelaxed ?? IDIOM_GAME_DEFAULTS.idiomNasalRelaxed,
    countCorrectOnly:config.idiomCountCorrectOnly ?? IDIOM_GAME_DEFAULTS.idiomCountCorrectOnly,
    hintsEnabled:config.idiomHintsEnabled ?? IDIOM_GAME_DEFAULTS.idiomHintsEnabled,
    hintIntervalSec:config.idiomHintIntervalSec ?? IDIOM_GAME_DEFAULTS.idiomHintIntervalSec,
    gamesToPlay:config.idiomGames ?? IDIOM_GAME_DEFAULTS.idiomGames, gameNumber:1,
    totalAttempts:0, totalCorrect:0, players:[], hintLevel:0, hintWord:'', lastHintAt:null,
    lastProgressAt:now, lastAt:now, startedBy:userKey, startedByName:name };
}

export function attemptIdiomGame(session, input, key, name, now) {
  const word = normalizeIdiom(input), playerName = [...String(name || '观众')].slice(0,40).join('');
  const reason = !lookupIdiom(word) ? 'unknown' : session.used.has(word) ? 'repeated' : !idiomConnects(session.word, word,session.nasalRelaxed) ? 'mismatch' : '';
  const next = { ...session, used:new Set(session.used), players:session.players.map(player => ({...player})),
    attempts:session.attempts + (!reason || !session.countCorrectOnly ? 1 : 0), totalAttempts:session.totalAttempts+1, lastAt:now };
  let player = next.players.find(item => item.key === key);
  if (!player) { player = {key, name:playerName, points:0, correct:0, incorrect:0}; next.players.push(player); }
  player.name = name ? playerName : player.name;
  const previousPoints = player.points;
  if (!reason) {
    next.word = word; next.used.add(word); next.round++; next.totalCorrect++; next.errors = 0;
    player.points += next.pointsPerCorrect; player.correct++;
    Object.assign(next,{hintLevel:0,hintWord:'',lastHintAt:null,lastProgressAt:now});
  } else { next.errors++; player.incorrect=(player.incorrect || 0)+1; player.points=Math.max(0,player.points-next.penalty); }
  const finished = next.attempts >= next.maxAttempts ? next.countCorrectOnly ? '目标达成' : '次数用尽' : !hasIdiomSuccessor(next.word, next.used,next.nasalRelaxed) ? '无可用后继' : '';
  return { next, reason, finished, pointsDelta:player.points-previousPoints };
}

export function nextIdiomGame(session, word, now) {
  return {...session, word, used:new Set([word]), gameNumber:session.gameNumber+1,
    attempts:0, round:0, errors:0, hintLevel:0, hintWord:'', lastHintAt:null,lastProgressAt:now,lastAt:now};
}
export const idiomHintToken = session => session?.type === 'idiom' ? `${session.sessionId}:${session.gameNumber}:${session.round}:${session.word}` : '';
const idiomCommonHints = '意气风发 以德报怨 发扬光大 大有可为 为所欲为 一马当先 先声夺人 人山人海 海阔天空 空前绝后 后来居上 上善若水 水到渠成 成千上万 万众一心 心花怒放 新陈代谢 身体力行 行云流水 深入浅出 出生入死 生龙活虎 虎头蛇尾 一心一意 心平气和 和气生财 财大气粗 入不敷出 出谋划策 策无遗算 算无遗策'.split(' ');
export function idiomHintCandidate(session) {
  const valid = word => !session.used.has(word) && idiomConnects(session.word,word,session.nasalRelaxed);
  if (session.hintWord && valid(session.hintWord)) return session.hintWord;
  return idiomCommonHints.find(valid) || idiomSuccessors(session.word,session.nasalRelaxed).find(word=>word.length===4 && valid(word)) || idiomSuccessors(session.word,session.nasalRelaxed).find(valid);
}

export function idiomStandings(session) {
  return [...(session?.players || [])].sort((a,b) => b.points - a.points || b.correct - a.correct);
}
export function idiomGameResult(session, reason, now) {
  const players = idiomStandings(session);
  const eligible=players.filter(player=>player.correct>0), highest=eligible[0]?.points;
  return { players, winners:eligible.filter(player => player.points === highest),
    attempts:session.totalAttempts, round:session.totalCorrect, games:session.gameNumber, reason, endedAt:now };
}

// Split announcements rather than truncating a winner or silently omitting tied players.
export function idiomMessagePages(messages, maxLength) {
  return messages.flatMap(message => {
    const chars = [...message], pages = [];
    for (let offset = 0; offset < chars.length; offset += maxLength) pages.push(chars.slice(offset, offset + maxLength).join(''));
    return pages;
  });
}
export function idiomResultMessages(result) {
  return [`🏁接龙已结束（${result.reason}），答对${result.round}次。`,
    ...(result.winners.length ? result.winners.map(player => `🏆${result.winners.length > 1 ? '并列冠军' : '冠军'}：${player.name}，${player.points}分！`) : ['本局无人答对，暂无获胜玩家。'])];
}
