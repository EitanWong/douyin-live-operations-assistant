// 只使用平台明确给出的资料；昵称、头像、荣誉等级和年龄区间不用于猜测。
export function audienceGender(value) {
  return value === 1 ? 'male' : value === 2 ? 'female' : null;
}

export function audienceAge(user, now = Date.now()) {
  if (user?.birthdayValid !== true) return null;
  const description = String(user.birthdayDescription || '').trim();
  // birthday (int64) 的时间单位未由当前 schema 说明，只换算明确的公历日期。
  const match = description.match(/^(\d{4})(?:-|年)(\d{1,2})(?:-|月)(\d{1,2})日?$/u);
  if (!match) return null;
  const [,year,month,day] = match.map(Number);
  const birth = new Date(Date.UTC(year,month-1,day));
  if (birth.getUTCFullYear() !== year || birth.getUTCMonth() !== month-1 || birth.getUTCDate() !== day) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).map(part=>[part.type,Number(part.value)]));
  const age = parts.year-year-(parts.month < month || parts.month === month && parts.day < day ? 1 : 0);
  return age >= 0 && age <= 120 ? age : null;
}

export function audienceTitle(user, now = Date.now()) {
  const age = audienceAge(user,now);
  // 生日可能因隐私不可见；已知性别时仍可按常用称呼回复。只有明确
  // 识别为未成年时才避免使用成人称谓。
  if (age !== null && age < 18) return '';
  return ({male:'哥',female:'姐'})[audienceGender(user?.gender)] || '';
}

export function audienceAddress(user, now = Date.now(), maxName = 60) {
  const name = [...String(user?.name || '观众')].slice(0,maxName).join('');
  const title = audienceTitle(user,now);
  // 用户昵称已经带有称谓时保持原名，不叠加或擅自更改昵称。
  return /(?:哥哥|姐姐|哥|姐|先生|女士)$/u.test(name) ? name : name + title;
}

export function renderAudienceTemplate(template, user, variables = {}, now = Date.now()) {
  const address = audienceAddress(user,now);
  // 兼容旧模板中写死的「{user} 哥」，避免女性或未知用户被错误称呼。
  const dynamic = String(template)
    .replace(/\{(?:user|nickname|address)\}\s*(?:\{title\}|小哥哥|小姐姐|大哥哥|大姐姐|哥哥|姐姐|大哥|大姐|哥|姐|先生|女士)/gu,'{address}');
  const values = {...variables,user:address,address,nickname:user?.name || '观众',title:audienceTitle(user,now)};
  return dynamic.replace(/\{([a-zA-Z]+)\}/g,(original,key)=>Object.hasOwn(values,key) ? String(values[key]) : original);
}

export function validAudienceAI(text, user, now = Date.now()) {
  // AI 不能另猜称呼；从输出中去掉允许的完整称呼及原昵称后再检查。
  let rest = String(text || '').split(audienceAddress(user,now)).join('');
  if (user?.name) rest = rest.split(user.name).join('');
  return !/(?:哥|姐|弟弟|妹妹|叔叔|阿姨|先生|女士)/u.test(rest);
}

export class AudienceProfiles {
  constructor({now = Date.now, limit = 5000, retention = 86400000} = {}) {
    this.now=now; this.limit=limit; this.retention=retention; this.users=new Map();
  }
  remember(user) {
    if (!user || (!user.id && !user.secUid)) return user;
    const key = user.id ? `uid:${user.id}` : `sec:${user.secUid}`;
    let previous = this.users.get(key);
    // 同一安全 UID 后续补齐 UID 时合并；只使用稳定标识，不按昵称合并。
    if (user.secUid) {
      const entry=[...this.users].find(([,value])=>value.secUid === user.secUid && (!value.id || String(value.id) === String(user.id || '')));
      if (entry) { previous=entry[1]; this.users.delete(entry[0]); }
    }
    if (previous && this.now()-previous.observedAt > this.retention) previous=null;
    const next = {...previous,observedAt:this.now()};
    for (const field of ['id','secUid','name']) if (user[field]) next[field]=String(user[field]);
    for (const field of ['gender','birthdayDescription','birthdayValid','wealthLevel','fanClubs']) if (Object.hasOwn(user,field)) next[field]=user[field];
    this.users.delete(key); this.users.set(key,next);
    while (this.users.size > this.limit) this.users.delete(this.users.keys().next().value);
    return {...user,...Object.fromEntries(['name','gender','birthdayDescription','birthdayValid','wealthLevel','fanClubs'].filter(field=>Object.hasOwn(next,field)).map(field=>[field,next[field]]))};
  }
  findByName(name) {
    const matches=[...this.users.values()].filter(user=>this.now()-user.observedAt <= this.retention && (user.name === name || audienceAddress(user,this.now()) === name));
    return matches.length === 1 ? matches[0] : null;
  }
  snapshot() { return [...this.users].filter(([,user])=>this.now()-user.observedAt <= this.retention).slice(-this.limit); }
  restore(entries) {
    this.users=new Map((Array.isArray(entries) ? entries : []).filter(entry=>Array.isArray(entry) && typeof entry[0] === 'string' && entry[1] && Number.isFinite(entry[1].observedAt) && this.now()-entry[1].observedAt <= this.retention).slice(-this.limit));
  }
}
